"""Nose observations from the photos (2026-11-11): one module, one rule per structure, used by the joint nose fit
(nose_fit.py) and by the nostril fit (nostril_fit.py imports photo_blobs from here).

Why: the default model has no direct photo observation of the nose. The statistical fit (gnm_fit --sil) sees the nose
profile only as a few pixels of the whole face outline (one weight per frame) and, under the nose, only one-sided (a
person mask fills concave parts), so the tip, the columella and the subnasale stay the average shape: 4 test recordings,
side frames, model - photo: nasolabial angle +6 .. +12 deg in 3/4 (upturned), subnasale 1.8-2.8 % IOD high in 3/4, tip
1.2-3.1 % IOD behind in 2/4. Each later nose step (nostril_fit, alar_width, nose_profile, profile90) found its own
evidence and moved the mesh in turn.

profile   side frames (head >= PROFILE_YAW deg from facing the camera): per level below the model tip (face down direction
          in the image), the front-most photo pixel along the face forward direction, kept only where the segmentation edge
          (class map != background, outline_obs.class_masks) and the strongest Lab edge along that direction agree within
          AGREE x IOD. The masks fill concave parts (10/24 gnm_fit --profile-fit failure) - there the two disagree and the
          level is dropped instead of pulling the model into the filled outline.
nostrils  frontal / chin-up frames: per side the dark blob (photo_blobs, team v6) where SAM 2.1 agrees (nostril_agree,
          the PoC judge rule set with 만두 10/24) -> its outline.
alar      frontal frames: the alar groove per row above the nostrils (alar_width.crease_rows: the darkest valley next to the
          model's crease, its inner drop edge), re-searched next to the current model in every round of the fit.
Points are image pixels with unit normals (profile: forward, nostril: out of the nostril).
"""
import os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)

PROFILE_YAW = 62.0                       # deg; below it the cheek / far brow is the outline in front of the nose base
LEVELS = np.arange(-0.20, 0.36, 0.004)   # x IOD below the model tip: lower dorsum .. upper lip
FRONT, BACK = 0.35, 0.45                 # x IOD in front of / behind the model tip searched along the forward direction
REFINE, AGREE = 0.04, 0.02               # x IOD: Lab-edge search around the mask edge, and the agreement needed
EDGE_MIN = 25.0                          # Lab gradient (3 channels) below which there is no edge
NOSTRIL_DARK, NOSTRIL_AGREE = 0.20, 0.5  # visible if the darkest point <= this x box median; blob vs SAM IoU per side
_SAM_IMAGE = {}


# ------------------------------------------------------------------------------------------------------------- frames
def head_yaw(R, ax):
    """deg between the face forward axis and the direction to the camera (0 = frontal, 90 = profile)"""
    return float(np.degrees(np.arccos(np.clip(-ax[2] @ R[2], -1, 1))))


def project(X, R, t, cam):
    f, cx, cy = cam; Q = np.atleast_2d(X) @ R.T + t
    return np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]


def iod_px(L, R, t, cam):
    """pixels per IOD at the face's depth (view independent: the eye corners overlap in a profile)"""
    z = float((L[[33, 263, 1]] @ R.T + t)[:, 2].mean()); return cam[0] * float(np.linalg.norm(L[33] - L[263])) / z


def face_dirs(L, ax, R, t, cam):
    """image origin (model tip), unit forward and down directions of the face at the tip"""
    iod = float(np.linalg.norm(L[33] - L[263])); o = project(L[1], R, t, cam)[0]
    fw = project(L[1] + ax[2] * 0.3 * iod, R, t, cam)[0] - o; fw /= np.linalg.norm(fw)
    dn = project(L[1] - ax[1] * 0.3 * iod, R, t, cam)[0] - o; dn -= (dn @ fw) * fw; dn /= np.linalg.norm(dn)
    return o, fw, dn


# ------------------------------------------------------------------------------------------------------------- profile
def _front(mask, o, fw, dn, ip, grad=None):
    """per level: forward offset (x IOD) of the front-most mask pixel; with grad, the Lab edge where it agrees, else nan"""
    H, W = mask.shape; s = np.arange(FRONT, -BACK, -0.25 / ip); out = np.full(len(LEVELS), np.nan)
    for i, h in enumerate(LEVELS):
        p = o[None] + (s[:, None] * fw[None] + h * dn[None]) * ip
        x = np.round(p[:, 0]).astype(int); y = np.round(p[:, 1]).astype(int); ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
        v = np.zeros(len(s), bool); v[ok] = mask[y[ok], x[ok]] > 0
        k = np.flatnonzero(v)
        if not len(k) or k[0] == 0: continue                         # nothing, or the search started inside
        out[i] = s[k[0]]
        if grad is None: continue
        ss = np.arange(out[i] + REFINE, out[i] - REFINE, -0.25 / ip)
        p = o[None] + (ss[:, None] * fw[None] + h * dn[None]) * ip
        x = np.clip(np.round(p[:, 0]).astype(int), 0, W - 1); y = np.clip(np.round(p[:, 1]).astype(int), 0, H - 1)
        # gradient MAGNITUDE: below the tip the profile runs nearly along the forward direction, and its forward component
        # (|grad| cos 70-80 deg) fell under EDGE_MIN there, dropping the columella levels the fit needs most
        g = sum(np.hypot(grad[0][c][y, x], grad[1][c][y, x]) for c in range(3))
        j = int(np.argmax(g))
        out[i] = ss[j] if g[j] > EDGE_MIN and abs(ss[j] - out[i]) < AGREE else np.nan
    return out


def profile_frame(img, cmap, L, ax, R, t, cam):
    """photo profile of one side frame: (points (N, 2) px, normals (N, 2), levels (N,)) or None"""
    import cv2
    o, fw, dn = face_dirs(L, ax, R, t, cam); ip = iod_px(L, R, t, cam)
    lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_BGR2LAB).astype(np.float32)
    grad = ([cv2.Sobel(lab[..., c], cv2.CV_32F, 1, 0, ksize=3) for c in range(3)],
            [cv2.Sobel(lab[..., c], cv2.CV_32F, 0, 1, ksize=3) for c in range(3)])
    s = _front((cmap != 0).astype(np.uint8), o, fw, dn, ip, grad)
    ok = np.isfinite(s)
    if ok.sum() < 20: return None
    P = o[None] + (s[:, None] * fw[None] + LEVELS[:, None] * dn[None]) * ip
    # normal from the neighbouring kept levels (a gap of more than two levels breaks the curve)
    N = np.full(P.shape, np.nan)
    idx = np.flatnonzero(ok)
    for a_, i in enumerate(idx):
        nb = [j for j in idx[max(0, a_ - 2):a_ + 3] if abs(j - i) <= 3]
        if len(nb) < 2: continue
        tg = P[max(nb)] - P[min(nb)]; n = np.array([tg[1], -tg[0]]); n /= np.linalg.norm(n) + 1e-12
        N[i] = n if n @ fw > 0 else -n
    ok &= np.isfinite(N[:, 0])
    return (P[ok], N[ok], LEVELS[ok]) if ok.sum() >= 20 else None


# ------------------------------------------------------------------------------------------------------------- nostrils
def photo_blobs(img, Lm):
    """(mask in the box, box) of the two darkest blobs between the nose wings, or None (nostril_fit v6, unchanged)"""
    import cv2
    x0, x1 = sorted([Lm[98, 0], Lm[327, 0]]); w_ = x1 - x0; y0 = Lm[1, 1]; y1 = Lm[2, 1] + 0.35 * abs(Lm[2, 1] - Lm[1, 1])
    X0, X1, Y0, Y1 = int(x0 - 0.15 * w_), int(x1 + 0.15 * w_), int(min(y0, y1) - 0.1 * w_), int(max(y0, y1) + 0.1 * w_)
    if X1 - X0 < 20 or Y1 - Y0 < 10: return None
    roi = cv2.cvtColor(img[Y0:Y1, X0:X1], cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
    # v3: 0.45 x median (parts_measure v0 used 0.62, which took the shadow under the nose in frontal views as nostril)
    # v6 (10/22, second video IMG_6006: brighter light, the frontal nostrils' darkest 2 % are only 0.52-0.55 x the median,
    # so 0.45 x median found NOTHING in any frontal frame and the nostril height went unchecked (user: model nostrils too
    # high). Also accept pixels in the darkest 15 % of the range between the 2nd percentile and the median; on me01
    # (darkest 2 % = 0.35 x median) and in chin-up views (near black) the 0.45 x median term still decides.
    med = np.median(roi); p2 = np.percentile(roi, 2)
    thr = min(np.percentile(roi, 18), max(0.45 * med, p2 + 0.15 * (med - p2)))
    dark = (roi < thr).astype(np.uint8); dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    nb, lab_, st, _ = cv2.connectedComponentsWithStats(dark)
    keep = np.zeros_like(dark)
    for k in ((1 + np.argsort(-st[1:, cv2.CC_STAT_AREA]))[:2] if nb > 1 else []):
        if st[k, cv2.CC_STAT_AREA] > 0.002 * dark.size: keep[lab_ == k] = 1
    if keep.sum() < 20: return None
    return keep, (X0, Y0, X1, Y1)


def sam_regions(img, box, pos, neg):
    """SAM 2.1 point prompt in the box (pos inside, neg outside): its proposals as regions that contain pos, none of neg and
    stay under a quarter of the box; None without SAM (pipeline/sam_masks.py)"""
    import cv2, torch
    from sam_masks import available, predictor
    ok, size = available()
    if not ok: return None
    pr, dev = predictor(size); X0, Y0, X1, Y1 = box
    ctx = torch.autocast("cuda", dtype=torch.bfloat16) if dev == "cuda" else torch.autocast("cpu", enabled=False)
    with torch.inference_mode(), ctx:
        # both sides of a frame share one image embedding; the image itself is kept as the key (an id() key could be
        # reused by the next frame's array once the previous one was freed, and SAM would predict on the old crop)
        if _SAM_IMAGE.get("img") is not img or _SAM_IMAGE.get("box") != box:
            pr.set_image(cv2.cvtColor(img[Y0:Y1, X0:X1], cv2.COLOR_BGR2RGB)); _SAM_IMAGE.update(img=img, box=box)
        pts = np.array([pos] + list(neg), np.float32) - [X0, Y0]; lab = np.array([1] + [0] * len(neg), np.int32)
        ms, _, _ = pr.predict(point_coords=pts, point_labels=lab, multimask_output=True)
    q = (int(pos[1] - Y0), int(pos[0] - X0)); negq = [(int(v[1] - Y0), int(v[0] - X0)) for v in neg]; out = []
    for m in ms:
        nb, lb = cv2.connectedComponents((np.asarray(m) > 0.5).astype(np.uint8))
        if not (0 <= q[0] < lb.shape[0] and 0 <= q[1] < lb.shape[1]) or lb[q] == 0: continue
        r = lb == lb[q]
        if r.sum() > 0.25 * r.size or any(0 <= y < r.shape[0] and 0 <= x < r.shape[1] and r[y, x] for y, x in negq): continue
        out.append(r)
    return out


def nostril_agree(img, Lm, blob, box):
    """(mask in the box or None, {image side: ok | not_visible | disagree | sam_failed | sam_unavailable}).
    Per side the darkest point must be clearly dark (else not visible) and SAM 2.1 prompted there must overlap the blob.
    만두 kept 310 / 354 of these points on the 11/10-11 dots (moved ones 0.011 IOD)"""
    import cv2
    X0, Y0, X1, Y1 = box
    Lb = cv2.GaussianBlur(cv2.cvtColor(img[Y0:Y1, X0:X1], cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32), (0, 0), 1.5)
    med = float(np.median(Lb)); colx = Lm[2, 0] - X0
    xs = np.arange(Lb.shape[1])[None, :]; ys = np.arange(Lb.shape[0])[:, None]
    out = np.zeros(blob.shape, bool); info = {}
    neg = [q for q in Lm[[1, 129, 358, 0, 2]] if X0 <= q[0] < X1 and Y0 <= q[1] < Y1]
    for s, name in ((-1, "img_left"), (1, "img_right")):
        half = (np.sign(xs - colx) == s) & (ys > 0.25 * Lb.shape[0])
        v = np.where(half, Lb, np.inf); y, x = np.unravel_index(int(np.argmin(v)), v.shape)
        if not np.isfinite(v[y, x]) or v[y, x] > NOSTRIL_DARK * med: info[name] = "not_visible"; continue
        cands = sam_regions(img, box, (x + X0, y + Y0), neg)
        if cands is None: info[name] = "sam_unavailable"; continue
        if not cands: info[name] = "sam_failed"; continue
        side = blob & half; ious = [(side & c).sum() / max((side | c).sum(), 1) for c in cands]
        if max(ious) < NOSTRIL_AGREE: info[name] = "disagree"; continue
        out |= cands[int(np.argmax(ious))]; info[name] = "ok"
    return (out if out.any() else None), info


def outline(mask):
    """(points (N, 2) px on the region's border, outward unit normals) of the largest region of a boolean mask, or None.
    The contour pixels are the region's outermost pixel CENTRES; the border lies half a pixel further out"""
    import cv2
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    if len(c) < 8: return None
    tg = np.roll(c, -2, 0) - np.roll(c, 2, 0); n = np.c_[tg[:, 1], -tg[:, 0]]; n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    probe = np.round(c + 2 * n).astype(int); H, W = mask.shape
    inside = mask[np.clip(probe[:, 1], 0, H - 1), np.clip(probe[:, 0], 0, W - 1)]
    if inside.mean() > 0.5: n = -n                                   # contour orientation: make the normals point out
    return c + 0.5 * n, n


def nostril_frame(img, Lm, img_side_of_head_right):
    """photo nostril outlines of one frontal / chin-up frame: ({head side +1 / -1: (points px, normals)}, info) or (None, info)"""
    pb = photo_blobs(img, Lm)
    if pb is None: return None, {"frame": "no_dark_blob"}
    blob, box = pb
    m, info = nostril_agree(img, Lm, blob.astype(bool), box)
    if m is None: return None, info
    X0, Y0 = box[:2]; xs = np.arange(m.shape[1])[None, :] + X0; out = {}
    for s_img, name in ((-1, "img_left"), (1, "img_right")):
        if info.get(name) != "ok": continue
        o = outline(m & (np.sign(xs - Lm[2, 0]) == s_img))
        if o is not None: out[int(s_img * img_side_of_head_right)] = (o[0] + [X0, Y0], o[1])
    return (out or None), info
