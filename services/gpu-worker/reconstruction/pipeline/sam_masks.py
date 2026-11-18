"""Full-resolution PERSON / background boundary with SAM 2.1 (2026-10-19, optional: run_all --person-masks sam).

Why: the outline fit (gnm_fit --sil, line_check) reads the person / background edge from MediaPipe selfie segmentation,
a 256 x 256 model -> ~7.5 px per mask pixel on a 1080 x 1920 frame; hair edges, the nape and the side profile are
blocky. SAM 2.1 (Meta, Apache-2.0 code + weights) is run on a HEAD + NECK crop (~3 px per mask pixel), prompted with
points the existing masks already give (face skin / hair = inside, far background = outside), and its soft mask is
upsampled edge-aware (guided filter on the photo). Outside the crop the selfie mask is kept.
Safety: if SAM disagrees strongly with the selfie mask in the crop (IoU < --min-iou) the selfie mask is kept for that
frame and counted in the report - SAM can lock onto the wrong object.

setup (PC, once):  powershell -ExecutionPolicy Bypass -File tools/torch_setup.ps1     (PyTorch CUDA + sam2 + checkpoint)
check:  python pipeline/sam_masks.py work/<id> --check 6    -> work/<id>/prep/person_masks_sam_check.jpg (red selfie, green SAM)
PERSONAL DATA: masks stay under work/<id>/prep.
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
CKPT_DIR = os.path.join(ROOT, "assets", "sam2")
MODELS = {"tiny": ("sam2.1_hiera_tiny.pt", "configs/sam2.1/sam2.1_hiera_t.yaml"),
          "small": ("sam2.1_hiera_small.pt", "configs/sam2.1/sam2.1_hiera_s.yaml"),
          "base_plus": ("sam2.1_hiera_base_plus.pt", "configs/sam2.1/sam2.1_hiera_b+.yaml"),
          "large": ("sam2.1_hiera_large.pt", "configs/sam2.1/sam2.1_hiera_l.yaml")}
_PRED = {}


def available(size=None):
    """(ok, reason): torch + sam2 importable and a checkpoint present"""
    try:
        import torch  # noqa
        import sam2  # noqa
    except Exception as ex:
        return False, f"torch/sam2 not installed ({ex.__class__.__name__}): tools/torch_setup.ps1"
    size = size or os.environ.get("LM_SAM_SIZE", "small")
    if not os.path.exists(os.path.join(CKPT_DIR, MODELS[size][0])):
        return False, f"checkpoint missing: assets/sam2/{MODELS[size][0]} (tools/torch_setup.ps1)"
    return True, size


def predictor(size):
    if size in _PRED: return _PRED[size]
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ck, cfg = MODELS[size]
    p = SAM2ImagePredictor(build_sam2(cfg, os.path.join(CKPT_DIR, ck), device=dev))
    _PRED[size] = (p, dev)
    return _PRED[size]


def _far_background_points(bg, k=3):
    """k background pixels far from the person and from each other (distance transform maxima)"""
    import cv2
    d = cv2.distanceTransform(bg.astype(np.uint8), cv2.DIST_L2, 5)
    pts = []
    for _ in range(k):
        y, x = np.unravel_index(int(np.argmax(d)), d.shape)
        if d[y, x] < 4: break
        pts.append((x, y))
        cv2.circle(d, (int(x), int(y)), int(max(8, 0.25 * min(d.shape))), 0, -1)
    return pts


def head_crop(pm, cm, H, W):
    """square crop (x0, y0, x1, y1) on head + neck: the hair + face-skin blob if a class map exists, else the top of
    the person mask"""
    import cv2
    blob = None
    if cm is not None:
        head = np.isin(cm, (1, 3)).astype(np.uint8)
        nb, lab, st, _ = cv2.connectedComponentsWithStats(head)
        if nb > 1:
            k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
            if st[k, 4] > 0.002 * H * W: blob = st[k, :4]
    if blob is None:
        ys, xs = np.nonzero(pm > 127)
        if len(ys) == 0: return None
        y0 = ys.min(); top = pm[y0:y0 + int(0.35 * H)] > 127
        cols = np.nonzero(top.any(0))[0]
        blob = (cols.min(), y0, cols.max() - cols.min() + 1, int(0.3 * H))
    bx, by, bw, bh = [int(v) for v in blob]
    side = int(1.7 * max(bw, bh)); cx = bx + bw / 2; cy = by + 0.6 * bh
    x0 = int(max(0, cx - side / 2)); y0 = int(max(0, cy - 0.45 * side))
    x1 = int(min(W, x0 + side)); y1 = int(min(H, y0 + side))
    return (x0, y0, x1, y1) if (x1 - x0 > 96 and y1 - y0 > 96) else None


def refine_one(img, pm, cm, size, min_iou=0.75):
    """-> (mask uint8 0/255, info dict)"""
    import cv2, torch
    from outline_obs import _guided
    H, W = img.shape[:2]
    cr = head_crop(pm, cm, H, W)
    if cr is None: return pm, {"used": False, "why": "no head crop"}
    x0, y0, x1, y1 = cr
    crop = img[y0:y1, x0:x1]; pmc = pm[y0:y1, x0:x1] > 127
    cmc = None if cm is None else cm[y0:y1, x0:x1]
    pos = []
    if cmc is not None:
        # 2026-10-19 (eun02-sam: SAM kept for 9 / 78 frames, IoU 0.2-0.8): with face + hair points only SAM segments the
        # HEAD, while the reference is the whole PERSON in the crop (neck, shoulders, clothes) -> low IoU, and a head-only
        # mask would invent a background edge at the collar. Points on every person class + the person box as prompt.
        for cls in (3, 1, 2, 4):                              # face skin, hair, body skin (neck), clothes
            ys, xs = np.nonzero((cmc == cls) & pmc)
            if len(ys) > 200:
                i = np.argmin((ys - np.median(ys)) ** 2 + (xs - np.median(xs)) ** 2); pos.append((xs[i], ys[i]))
    if not pos:
        ys, xs = np.nonzero(cv2.erode(pmc.astype(np.uint8), np.ones((15, 15), np.uint8)))
        if len(ys) == 0: return pm, {"used": False, "why": "empty person mask"}
        i = np.argmin((ys - np.median(ys)) ** 2 + (xs - np.median(xs)) ** 2); pos.append((xs[i], ys[i]))
    neg = _far_background_points(~cv2.dilate(pmc.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool))
    pts = np.array(pos + neg, np.float32); lab = np.array([1] * len(pos) + [0] * len(neg), np.int32)
    ys_, xs_ = np.nonzero(pmc)
    box = np.array([xs_.min(), ys_.min(), xs_.max(), ys_.max()], np.float32) if len(ys_) else None
    p, dev = predictor(size)
    ctx = torch.autocast("cuda", dtype=torch.bfloat16) if dev == "cuda" else torch.autocast("cpu", enabled=False)
    with torch.inference_mode(), ctx:
        p.set_image(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        logits, scores, _ = p.predict(point_coords=pts, point_labels=lab, box=box, multimask_output=False, return_logits=True)
    lg = np.asarray(logits[0], np.float32)
    if lg.shape != crop.shape[:2]: lg = cv2.resize(lg, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_LINEAR)
    soft = 1.0 / (1.0 + np.exp(-lg))
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    soft = _guided(g, soft.astype(np.float32), max(2, int(0.004 * (y1 - y0))), 1e-3)
    sm = soft > 0.5
    iou = float((sm & pmc).sum()) / max(1, int((sm | pmc).sum()))
    info = {"used": iou >= min_iou, "iou_vs_selfie": round(iou, 3), "score": round(float(np.ravel(scores)[0]), 3), "crop": [x0, y0, x1, y1]}
    if iou < min_iou: return pm, info
    out = pm.copy()
    # keep the selfie mask in a thin band along the crop border (no seam where the person leaves the crop)
    b = max(4, int(0.03 * (y1 - y0)))
    inner = np.zeros(sm.shape, bool); inner[b:-b, b:-b] = True
    if y0 == 0: inner[:b] = True
    if x0 == 0: inner[:, :b] = True
    if x1 == W: inner[:, -b:] = True
    reg = out[y0:y1, x0:x1]
    reg[inner] = np.where(sm[inner], 255, 0).astype(np.uint8)
    return out, info


def refine(images, names, selfie, cache, size=None, class_cache=None):
    """{frame: mask} SAM-refined (cached as PNGs in `cache`); falls back to the selfie masks when SAM is unavailable"""
    import cv2
    ok, why = available(size)
    if not ok:
        print("person masks: SAM not used -", why, flush=True); return selfie
    size = why
    os.makedirs(cache, exist_ok=True)
    rp = os.path.join(cache, "sam_masks.json")
    rep = json.load(open(rp)) if os.path.exists(rp) else {"model": size, "frames": {}}
    CM = {}
    if class_cache:
        try:
            from outline_obs import class_masks
            CM = class_masks(images, names, class_cache)
        except Exception:
            CM = {}
    out = {}
    for n in names:
        p = os.path.join(cache, n + ".png")
        if os.path.exists(p):
            out[n] = cv2.imread(p, 0); continue
        pm = selfie.get(n); img = cv2.imread(os.path.join(images, n))
        if pm is None or img is None: continue
        try:
            m, info = refine_one(img, pm, CM.get(n), size)
        except Exception as ex:
            m, info = pm, {"used": False, "why": f"error {ex.__class__.__name__}: {str(ex)[:120]}"}
        cv2.imwrite(p, m); out[n] = m; rep["frames"][n] = info
    fr = rep["frames"].values()
    rep["summary"] = {"frames": len(rep["frames"]), "sam_used": sum(1 for v in fr if v.get("used")),
                      "kept_selfie": sum(1 for v in fr if not v.get("used"))}
    json.dump(rep, open(rp, "w"), indent=1)
    print("person masks (SAM 2.1):", json.dumps(rep["summary"]), flush=True)
    return out


def check(work, n_frames=6, size=None):
    """overlay for a visual check: red = selfie boundary, green = SAM boundary, on a few frames incl. profiles"""
    import cv2
    from cranium_fit import person_masks
    prep = os.path.join(work, "prep"); images = os.path.join(prep, "images")
    names = sorted(f for f in os.listdir(images) if f.lower().endswith((".jpg", ".jpeg", ".png")))
    pj = os.path.join(prep, "prepare.json")
    noface = set()
    if os.path.exists(pj):
        noface = {i["file"] for i in json.load(open(pj)).get("images", []) if i.get("yaw") is None}
    pick = [n for n in names if n in noface][:max(1, n_frames // 2)]
    rest = [n for n in names if n not in noface]
    pick += rest[::max(1, len(rest) // max(1, n_frames - len(pick)))][:n_frames - len(pick)]
    os.environ["LM_PERSON_MASKS"] = "selfie"
    S = person_masks(images, pick, os.path.join(prep, "person_masks"))
    M = refine(images, pick, S, os.path.join(prep, "person_masks_sam"), size, os.path.join(prep, "class_masks"))
    tiles = []
    for n in pick:
        im = cv2.imread(os.path.join(images, n))
        for mk, col in ((S.get(n), (0, 0, 255)), (M.get(n), (0, 255, 0))):
            if mk is None: continue
            cs, _ = cv2.findContours((mk > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            cv2.drawContours(im, cs, -1, col, max(2, im.shape[0] // 400))
        tiles.append(cv2.resize(im, (360, int(360 * im.shape[0] / im.shape[1]))))
    h = min(t.shape[0] for t in tiles)
    out = os.path.join(prep, "person_masks_sam_check.jpg")
    cv2.imwrite(out, np.hstack([t[:h] for t in tiles]))
    print("check image:", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("work"); ap.add_argument("--check", type=int, default=6, help="frames in the check image")
    ap.add_argument("--size", choices=list(MODELS), help="model size (default small, or LM_SAM_SIZE)")
    a = ap.parse_args()
    ok, why = available(a.size)
    if not ok: raise SystemExit(why)
    check(a.work, a.check, a.size)
