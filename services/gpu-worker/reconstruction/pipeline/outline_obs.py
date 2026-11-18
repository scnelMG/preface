"""Photo SKIN outline per frame (face + neck + ear skin, holes for eyes / brows / lips filled), shared by the line check
(tools/line_check.py) and the silhouette fit (gnm_fit.py --sil).

Skin = pixels on the person (selfie segmentation, cached in prep/person_masks) whose colour (YCrCb) is close to the
cheek colour of that frame (sampled at the projected cheek landmarks). Hanging hair over the cheeks (woo01) and the
background are outside; the outline therefore follows the real face edge where it is visible.
"""
import os
import numpy as np

CHEEK_LM = [50, 280, 205, 425, 101, 330, 151]
EDGE_MARGIN = float(os.environ.get("LM_EDGE_MARGIN", "0") or 0)   # px; 0 = off (option, run_all --edge-margin)
SEG_MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "selfie_multiclass_256x256.tflite")
# MediaPipe multiclass selfie segmentation (npm.cmd run seg:fetch): 0 background 1 hair 2 body skin 3 face skin 4 clothes 5 other


def _guided(I, p, r, eps):
    """He et al. guided filter (grey guide): edge-aware smoothing / upsampling of p along the image edges of I"""
    return _guided_channels(I, [p], r, eps)[0]


def _guided_channels(I, ps, r, eps):
    """_guided for several inputs p on the same guide I: the guide's mean and variance are computed once instead of once
    per input (the class map filters 6 class confidences on one photo). Same expressions per input -> same values"""
    import cv2
    k = (2 * r + 1, 2 * r + 1)
    mI = cv2.boxFilter(I, -1, k); vI = cv2.boxFilter(I * I, -1, k) - mI * mI
    out = []
    for p in ps:
        mp_ = cv2.boxFilter(p, -1, k)
        cIp = cv2.boxFilter(I * p, -1, k) - mI * mp_
        a = cIp / (vI + eps); b = mp_ - a * mI
        out.append(cv2.boxFilter(a, -1, k) * I + cv2.boxFilter(b, -1, k))
    return out


def class_masks(images, names, cache):
    """{frame: (H, W) uint8 class map} from the multiclass segmentation, cached as PNGs; {} when the model is missing.
    Resolution (2026-10-16): the model sees 256 x 256 - on a whole 1080 x 1920 frame that is ~7.5 px per class pixel,
    so thin hair strands and the ear / collar borders were lost. Now (1) the HEAD + NECK is cropped (square around the
    face found by MediaPipe, 2.6 x face height) and segmented on its own (~2-3 px per class pixel), and (2) the six
    class confidences are upsampled EDGE-AWARE (guided filter on the photo) before taking the most likely class, so the
    borders follow the real hair / skin / collar edges. Outside the crop: the whole-frame result."""
    import cv2
    if not os.path.exists(SEG_MODEL): return {}
    cache = cache.rstrip("/\\") + "_v3"     # v3 (10-19): profiles without a face get the head crop too
    os.makedirs(cache, exist_ok=True)
    import threading, mediapipe as mp
    from concurrent.futures import ThreadPoolExecutor
    tl = threading.local(); out = {}
    def models():
        """segmenter + face detector, one pair per thread (MediaPipe tasks are not thread safe)"""
        if getattr(tl, "seg", None) is None:
            from mediapipe.tasks.python import vision, BaseOptions
            tl.seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
                base_options=BaseOptions(model_asset_buffer=open(SEG_MODEL, "rb").read()), output_confidence_masks=True, output_category_mask=False))
            tl.det = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_buffer=open(os.path.join(os.path.dirname(SEG_MODEL), "face_landmarker.task"), "rb").read()), num_faces=1))
        return tl.seg, tl.det

    def one(n):
        p = os.path.join(cache, n + ".png")
        if os.path.exists(p): return n, cv2.imread(p, 0)
        seg, det = models()
        im = cv2.imread(os.path.join(images, n))
        if im is None: return n, None
        H, W = im.shape[:2]
        rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
        def conf(img_rgb):
            r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(img_rgb)))
            return np.stack([m.numpy_view() for m in r.confidence_masks], -1).astype(np.float32)
        C = conf(rgb)                                          # (H, W, 6) whole frame
        if C.shape[:2] != (H, W): C = cv2.resize(C, (W, H), interpolation=cv2.INTER_LINEAR)
        fr = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
        crop = None
        if fr.face_landmarks:
            L = np.array([[q.x * W, q.y * H] for q in fr.face_landmarks[0]])
            c = L.mean(0); fh = np.ptp(L[:, 1]); side = int(2.6 * fh)
            crop = (c, side)
        else:
            # no face found (60-90 deg profile, 2026-10-19): the crop is placed on the head found by the whole-frame
            # pass (largest hair + face-skin blob) - the profiles carry the side outline, so they need the detail most
            head = np.isin(C.argmax(-1), (1, 3)).astype(np.uint8)
            nb, _, st, _ = cv2.connectedComponentsWithStats(head)
            if nb > 1:
                k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
                bx, by, bw, bh, ba = st[k]
                if ba > 0.002 * H * W:
                    crop = (np.array([bx + bw / 2, by + 0.55 * bh]), int(1.5 * max(bw, bh)))
        if crop is not None:
            c, side = crop
            x0 = int(max(0, c[0] - side / 2)); y0 = int(max(0, c[1] - 0.45 * side))
            x1 = int(min(W, x0 + side)); y1 = int(min(H, y0 + side))
            if x1 - x0 > 64 and y1 - y0 > 64:
                Cc = conf(rgb[y0:y1, x0:x1])
                if Cc.shape[:2] != (y1 - y0, x1 - x0): Cc = cv2.resize(Cc, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
                # feathered paste (no seam where the crop ends)
                wy = np.minimum(np.arange(y1 - y0), np.arange(y1 - y0)[::-1]); wx = np.minimum(np.arange(x1 - x0), np.arange(x1 - x0)[::-1])
                fw_ = np.clip(np.minimum(wy[:, None], wx[None]) / (0.06 * side), 0, 1)[..., None]
                C[y0:y1, x0:x1] = Cc * fw_ + C[y0:y1, x0:x1] * (1 - fw_)
        g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        r_ = max(2, int(0.003 * H))
        Cg = np.stack(_guided_channels(g, [C[..., k] for k in range(C.shape[-1])], r_, 1e-3), -1)
        cm = Cg.argmax(-1).astype(np.uint8)
        cv2.imwrite(p, cm); return n, cm

    # frames are independent: a thread pool (2026-10-19, first run of a capture spent ~60 s here)
    todo = [n for n in names if not os.path.exists(os.path.join(cache, n + ".png"))]
    try:
        from parallel import workers
        with ThreadPoolExecutor(workers(len(todo) or 1)) as pool:
            for n, cm in pool.map(one, names):
                if cm is not None: out[n] = cm
    except Exception as ex:                       # never break the pipeline on the optional model
        print("class mask skipped:", ex); return {}
    return out


def gate_skin(sk, classes, person=None):
    """colour skin test x multiclass segmentation (2026-10-16): pixels the segmentation calls HAIR or CLOTHES are not
    skin (eun02's pink / white shirt stripes passed the colour test), and skin the colour test missed in shadow (under
    the jaw) is added where the segmentation is sure (eroded). The class map is 256 x 256 upscaled: its border is coarse,
    so near its border the colour test decides. Frames whose class map disagrees wildly fall back to the colour test."""
    import cv2
    if classes is None: return sk
    cs = np.isin(classes, [2, 3]).astype(np.uint8)
    if cs.sum() < 0.2 * max(int(sk.sum()), 1): return sk          # implausible map for this frame: keep colour only
    H = sk.shape[0]; k = max(3, int(0.008 * H)) | 1
    allow = cv2.dilate(cs, np.ones((k, k), np.uint8))
    sure = cv2.erode(cs, np.ones((k, k), np.uint8))
    out = (sk.astype(bool) & (allow > 0)) | (sure > 0)
    if person is not None: out &= person > 127
    return out.astype(np.uint8)


def skin_mask(img, person, ref_uv, min_area=0, classes=None):
    """img BGR, person mask (uint8, 255 = person), ref_uv: (k,2) pixel points on cheek skin -> filled skin mask (0/1)"""
    import cv2
    H, W = img.shape[:2]
    ycc = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    ref_uv = np.asarray(ref_uv).astype(int)
    ref_uv = ref_uv[(ref_uv[:, 0] >= 0) & (ref_uv[:, 0] < W) & (ref_uv[:, 1] >= 0) & (ref_uv[:, 1] < H)]
    if len(ref_uv) < 3: return None
    smp = np.vstack([ycc[max(0, v - 4):v + 5, max(0, u - 4):u + 5].reshape(-1, 3) for u, v in ref_uv])
    y0, cr0, cb0 = np.median(smp, 0)
    sk = ((np.abs(ycc[..., 1] - cr0) < 16) & (np.abs(ycc[..., 2] - cb0) < 16) & (ycc[..., 0] > 0.4 * y0) & (person > 127)).astype(np.uint8)
    sk = gate_skin(sk, classes, person)
    sk = cv2.morphologyEx(sk, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)); sk = cv2.morphologyEx(sk, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cs, _ = cv2.findContours(sk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cs = [c for c in cs if cv2.contourArea(c) > min_area]
    if not cs: return None
    filled = np.zeros_like(sk); cv2.drawContours(filled, cs, -1, 1, -1)
    return filled


def outline_points(mask):
    import cv2
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return np.vstack([c[:, 0, :] for c in cs]).astype(np.float64) if cs else np.zeros((0, 2))


def background_edge(points, person, tol_frac=0.008):
    """True where a skin-outline point is a REAL silhouette: the person ends right there (background beyond).
    False = hair / clothes / hands continue beyond it: the skin edge there is the HAIRLINE or where hanging hair covers
    the face - the head itself goes on under it (woo01 2026-10-16: the forehead / temples were pulled in to the hairline).
    Such points only say "the head is at least this big" (one-sided)."""
    import cv2
    if len(points) == 0: return np.zeros(0, bool)
    dist = cv2.distanceTransform((person > 127).astype(np.uint8), cv2.DIST_L2, 3)   # person pixel -> nearest background
    H, W = person.shape[:2]
    x = np.clip(points[:, 0].astype(int), 0, W - 1); y = np.clip(points[:, 1].astype(int), 0, H - 1)
    return dist[y, x] < tol_frac * H


def frame_observations(work, sparse, poses_json, landmark_world, names=None, every=2, exclude=()):
    """[(name, R, t, f, cx, cy, filled skin mask, skin outline points, background-edge flag per point, person outline, gray image, class map or None)]"""
    import cv2, pycolmap
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from frame_check import load_poses, intrinsics
    from cranium_fit import person_masks
    rec = pycolmap.Reconstruction(sparse); P = load_poses(poses_json)
    images = os.path.join(work, "prep", "images")
    names = sorted(n for n in (names or P) if n in P and n not in exclude)[::max(1, every)]
    PM = person_masks(images, names, os.path.join(work, "prep", "person_masks"))
    CM = class_masks(images, names, os.path.join(work, "prep", "class_masks"))
    cam = list(rec.cameras.values())[0]; f, cx, cy = intrinsics(cam)

    def one(n):
        pm = PM.get(n); img = cv2.imread(os.path.join(images, n))
        if pm is None or img is None: return None
        R, t = P[n]; R = np.asarray(R); t = np.asarray(t, np.float64)
        Q = landmark_world[CHEEK_LM] @ R.T + t
        ref = np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]
        m = skin_mask(img, pm, ref, min_area=2000, classes=CM.get(n))
        if m is None: return None
        qp = outline_points(m)
        # person outline (head + hair + body): on top of the head the hair is a thin layer -> the crown follows it
        pp = outline_points((pm > 127).astype(np.uint8))
        if EDGE_MARGIN > 0 and len(pp):
            # OPTION (2026-10-22, run_all --edge-margin): where the person runs off the image (close-up: head top / chin cut
            # by the frame) the contour follows the IMAGE BORDER - "the photo ends here", not "the head ends here". The
            # crown term treats person-outline points as an upper bound and would pull the skull inside the frame.
            Hp, Wp = pm.shape[:2]
            pp = pp[(pp[:, 0] >= EDGE_MARGIN) & (pp[:, 0] <= Wp - 1 - EDGE_MARGIN) & (pp[:, 1] >= EDGE_MARGIN) & (pp[:, 1] <= Hp - 1 - EDGE_MARGIN)]
        return (n, R, t, f, cx, cy, m, qp, background_edge(qp, pm), pp, cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), CM.get(n))

    # frames are independent (S15P31B204-702): side by side, kept in frame order
    from concurrent.futures import ThreadPoolExecutor
    from parallel import workers
    with ThreadPoolExecutor(workers(len(names)) if names else 1) as pool:
        return [o for o in pool.map(one, names) if o is not None]
