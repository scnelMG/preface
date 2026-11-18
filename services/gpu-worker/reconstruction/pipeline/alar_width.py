"""Alar (콧볼) width from the frontal PHOTOS (2026-10-21, option --alar-width photo, off by default).

Problem (me01): in frontal photos the model's alar wings sit ~5 % IOD (both sides together) inside the photo's alar
creases; the photo nose is painted onto the cheek beside the model nose (jagged texture at the wings). The alar width
comes from the statistical shape prior (GNM): the 468 MediaPipe points carry it only weakly and nothing in the fit looks
at the alar edge itself. Scaling to the MediaPipe alar points closed only half of the gap (prototype, 10/21).

Measurement (same rule on the photo and on the model, near-frontal frames |yaw| <= 8, |pitch| <= 12, hold-out excluded):
  rows from 0.12 IOD above the nose tip to 15 % of the way to the subnasale (alar wing above the nostrils), each side
  model: depth image of the fitted mesh with the frame's pose -> the alar crease = most CONCAVE point of the depth
         profile (largest second difference) between 0.10 and 0.45 IOD from the tip column
  photo: the darkest VALLEY (local intensity minimum against +-0.025 IOD neighbours) within +-0.10 IOD of the model
         crease of that row (the crease is a shadow groove; cheek shading gradients are not valleys)
  per frame: median over rows of photo / model half-width per side -> median over frames
Correction: the alar region (within 0.06 IOD of the MediaPipe alar points, fading over 0.16 IOD; fading out 0.15-0.30
IOD above the tip so the bridge is not widened) is scaled about the midline per side and per height bin (lower / middle /
upper wing, linear between the bins), 3 rounds of measure -> scale.
v2 (10/21, user check "the wings are still inside the photo"): v1 used one scale per side limited to 1.15 (reached on
both sides) and faded out from 0.05 IOD above the tip, i.e. inside the measured rows -> the upper wing lagged.
v3 (10/21): beyond the crease (largest distance of the alar points from the midline) the cheek takes only the crease's
shift (fading), not the scale - the scale moved the cheek more than the wing and raised the crease score there.
v4 (10/21): fade over the cheek 0.16 -> 0.32 IOD (me01 crease score p95 0.103 -> 0.087, default 0.085) and a fade
below the subnasale down to the mouth-corner height so the wider fade does not move the mouth corners (1.3 % IOD
without it; a short 0.09 IOD fade raised the crease score again).
Safeguards: >= 5 frames per bin, frame spread (IQR) of the ratio <= 0.08, scale limited to 0.85 .. 1.40 per side and bin.
usage: python alar_width.py <fit.ply> <fit.json> <sparse> <images> <frame_poses.json> <prepare.json> <out.ply>
       [--exclude holdout.txt] [--debug check.jpg] [--rounds 2]   -> prints JSON stats
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa
from template_fit import head_axes  # noqa
from frame_check import intrinsics  # noqa

ALAR = {+1: [278, 294, 327, 358], -1: [48, 64, 98, 129]}    # MediaPipe alar points per image side (sign of x - tip)
CORE, FADE = 0.06, 0.32                                      # x eye distance (wide: the cheek follows gently)
BINS = [-1.0, 0.02, 0.06, 1.0]          # row height above the nose tip (x IOD): lower / middle / upper alar wing
UP_FADE = (0.15, 0.30)                  # x IOD above the tip: full effect below, none above (bridge not widened)
DOWN_START = 0.02                       # x IOD below the subnasale the effect starts to fade, gone at the mouth corners
LIMITS = (0.85, 1.40)                   # per side and bin, total scale
PHOTO_EDGE = "drop"                     # v10: photo wing edge = "drop" (where the lit wing starts to darken) | "valley" (v1-v9)
TARGET = "groove"                       # measurement in use: "groove" (darkest valley) | "outline" (visible wing edge)
OUTLINE_LIMITS = (0.95, 1.10)           # v7 second stage: extra scale from the outline, on top of the groove fit
ANG_BINS = [(-10, 15), (15, 40), (40, 65)]   # v8 lower curve: ray angle from the nostril centre (0 = outward, 90 = down);
                                             # the first bin is the reference (the wing side the rows above already fit)
LOW_LIMITS = (0.90, 1.06)
LOW_H = None                            # v9: lowest measured row height above the tip (x IOD), set in main
# v9 fade below the lowest measured row: 40 % of the lowest bin's scale kept, fade ending 0.08 IOD below the subnasale.
# Sweep 10/22 on the no-option fits (p2 / me2 / me1): a fade to 1.0 AT the subnasale folded the lower wing (crease p95
# 0.15 / 0.34 / 0.34); this one 0.08 / 0.09 / 0.14 with lower-wing widths 46.3 / 49.0 / 49.8 % IOD (v8: 52.4 / 50.0 / 50.9)
LOW_KEEP = 0.4
LOW_END = 0.08
RESPOND = 0.3                           # v9: a bin whose ratio moved < 30 % of what its scale change should do is reset


def render_depth(V, F, R, t, f, cx, cy, shape, near):
    """camera-space depth image of the triangles near the nose (painter's order, far -> near)"""
    import cv2
    X = V @ R.T + t; z = X[:, 2]
    uv = np.c_[f * X[:, 0] / z + cx, f * X[:, 1] / z + cy]
    T = F[near[F].all(1)]
    depth = np.full(shape, np.inf, np.float32); facing = np.zeros(shape, np.float32)
    Xt = X[T]; nt = np.cross(Xt[:, 1] - Xt[:, 0], Xt[:, 2] - Xt[:, 0]); nt /= np.linalg.norm(nt, axis=1, keepdims=True) + 1e-12
    ct = Xt.mean(1); fac = np.abs((nt * (-ct / np.linalg.norm(ct, axis=1, keepdims=True))).sum(1))   # 1 = faces the camera
    pts = np.round(uv[T] * 4).astype(np.int32)
    for k in np.argsort(-z[T].mean(1)):
        x0, y0 = pts[k].min(0) // 4; x1, y1 = pts[k].max(0) // 4 + 2
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, shape[1]), min(y1, shape[0])
        if x1 <= x0 or y1 <= y0: continue
        sub = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.fillPoly(sub, [pts[k] - [x0 * 4, y0 * 4]], 1, shift=2)
        # depth of the triangle plane at the pixels (flat per triangle is enough for a 1-2 px crease position)
        depth[y0:y1, x0:x1][sub > 0] = z[T[k]].mean(); facing[y0:y1, x0:x1][sub > 0] = fac[k]
    return depth, uv, facing


def crease_rows(gray, depth, tip, sn, iod, facing=None):
    """per row and side: (model crease x, photo crease x) in px; rows above the nostrils"""
    import cv2
    out = {+1: [], -1: []}
    y0, y1 = int(tip[1] - 0.12 * iod), int(tip[1] + 0.15 * (sn[1] - tip[1]))   # alar wing above the nostrils
    if y1 <= y0 + 2: return out
    g = cv2.GaussianBlur(gray, (0, 0), max(1.0, 0.006 * iod))
    d = cv2.GaussianBlur(np.where(np.isfinite(depth), depth, 0).astype(np.float32), (0, 0), max(1.0, 0.006 * iod))
    ok = np.isfinite(depth)
    h = max(2, int(0.025 * iod)); w10 = int(0.10 * iod)
    if facing is not None:
        # v7 (10/22, user on frame 00574 in the gray view: one wing's OUTLINE inside the photo while its groove matched):
        # compare the VISIBLE outline instead of the groove. Model: where the facing (|n . view|) drops fastest going
        # outward (lighting-free); photo: where the brightness drops fastest going outward, within +-0.08 IOD of it.
        fb = cv2.GaussianBlur(facing, (0, 0), max(1.0, 0.006 * iod)); e2 = max(2, int(0.01 * iod)); w8 = int(0.08 * iod)
        for y in range(y0, y1):
            for s in (+1, -1):
                xs = np.arange(int(tip[0] + s * 0.12 * iod), int(tip[0] + s * 0.42 * iod), s)
                xs = xs[(xs - e2 >= 0) & (xs + e2 < gray.shape[1])]
                xs = xs[ok[y, xs]]
                if len(xs) < 5: continue
                dm = fb[y, xs + s * e2] - fb[y, xs - s * e2]
                if dm.min() >= -0.02: continue
                xm = xs[np.argmin(dm)]
                xp = np.arange(xm - w8, xm + w8 + 1); xp = xp[(xp - e2 >= 0) & (xp + e2 < gray.shape[1])]
                dp = g[y, xp + s * e2] - g[y, xp - s * e2]
                if dp.min() >= -0.004: continue
                out[s].append((y, xm, xp[np.argmin(dp)]))
        return out
    for y in range(y0, y1):
        for s in (+1, -1):
            xs = np.arange(int(tip[0] + s * 0.10 * iod), int(tip[0] + s * 0.45 * iod), s)
            xs = xs[(xs - h >= 0) & (xs + h < gray.shape[1])]
            xs = xs[ok[y, xs] & ok[y, xs - h] & ok[y, xs + h]]
            if len(xs) < 5: continue
            conc = d[y, xs] - 0.5 * (d[y, xs - h] + d[y, xs + h])          # + = concave (behind its neighbours)
            xm = xs[np.argmax(conc)]
            if conc.max() <= 0: continue
            xp = np.arange(xm - w10, xm + w10 + 1)
            xp = xp[(xp - h >= 0) & (xp + h < gray.shape[1])]
            val = 0.5 * (g[y, xp - h] + g[y, xp + h]) - g[y, xp]            # + = darker than its neighbours
            if val.max() <= 0.004: continue
            xv = int(xp[np.argmax(val)])
            if PHOTO_EDGE == "drop":
                # v10 (10/22, user on p2: "the model takes the shadow beside the wing too"): the wing ends where the lit
                # wing skin starts to darken, i.e. the steepest outward drop on the INNER side of the darkest valley;
                # with a wide shadow on the cheek the valley lies 1-2 % IOD further out than that edge
                e2 = max(2, int(0.01 * iod)); xi = np.arange(xv - s * int(0.06 * iod), xv + s, s)
                xi = xi[(xi - e2 >= 0) & (xi + e2 < gray.shape[1])]
                if len(xi):
                    dp = g[y, xi + s * e2] - g[y, xi - s * e2]
                    if dp.min() < -0.004: xv = int(xi[np.argmin(dp)])
            out[s].append((y, xm, xv))
    return out


def measure(V, F, lid, frames, cam, vis=None):
    """{side: {bin: [per-frame photo/model half-width ratio]}}, {bin: [row heights above the tip, x IOD]}"""
    import cv2
    f, cx, cy = cam
    L = V[lid]; iod3 = np.linalg.norm(L[33] - L[263])
    near = np.linalg.norm(V - L[1], axis=1) < 0.7 * iod3
    ratios = {s: {b: [] for b in range(len(BINS) - 1)} for s in (+1, -1)}; heights = {b: [] for b in range(len(BINS) - 1)}
    for name, (R, t, img) in frames.items():
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        depth, uv, facing = render_depth(V, F, R, t, f, cx, cy, gray.shape, near)
        tip, sn = uv[lid[1]], uv[lid[2]]; iod = np.linalg.norm(uv[lid[33]] - uv[lid[263]])
        rows = crease_rows(gray, depth, tip, sn, iod, facing if TARGET == "outline" else None)
        for s in (+1, -1):
            if not rows[s]: continue
            a = np.array(rows[s], float); hb = (tip[1] - a[:, 0]) / iod; b = np.digitize(hb, BINS) - 1
            for k in range(len(BINS) - 1):
                sel = b == k
                if sel.sum() >= 3:
                    ratios[s][k].append(np.median(np.abs(a[sel, 2] - tip[0])) / np.median(np.abs(a[sel, 1] - tip[0])))
                    heights[k].extend(hb[sel].tolist())
        if vis is not None and len(vis) < 4:
            c = img.copy()
            for s in (+1, -1):
                for (y, xm, xp) in rows[s]:
                    cv2.circle(c, (int(xm), y), 1, (0, 255, 255), -1); cv2.circle(c, (int(xp), y), 1, (255, 0, 255), -1)
            r = int(0.4 * iod); x0, y0 = int(tip[0] - r), int(tip[1] - r)
            vis.append(cv2.resize(c[max(0, y0):y0 + 2 * r, max(0, x0):x0 + 2 * r], (320, 320)))
    return ratios, heights


def radial_ratios(V, F, lid, frames, cam, ncen3):
    """v8: per image side and angle bin, per frame: photo / model distance of the alar GROOVE from the nostril centre
    along rays (model: most concave depth point, photo: darkest valley within +-0.06 IOD of it)"""
    import cv2
    f, cx, cy = cam; L = V[lid]; near = np.linalg.norm(V - L[1], axis=1) < 1.2 * np.linalg.norm(L[33] - L[263])
    out = {s: {b: [] for b in range(len(ANG_BINS))} for s in (+1, -1)}
    samp = lambda im, Q: cv2.remap(im, Q[:, 0].astype(np.float32).reshape(-1, 1), Q[:, 1].astype(np.float32).reshape(-1, 1), cv2.INTER_LINEAR).ravel()
    for name, (R, t, img) in frames.items():
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        depth, uv, _ = render_depth(V, F, R, t, f, cx, cy, gray.shape, near)
        tip = uv[lid[1]]; iod = np.linalg.norm(uv[lid[33]] - uv[lid[263]]); h = max(2.0, 0.025 * iod)
        g = cv2.GaussianBlur(gray, (0, 0), max(1.0, 0.006 * iod)); ok = np.isfinite(depth); okf = ok.astype(np.float32)
        dd = cv2.GaussianBlur(np.where(ok, depth, 0).astype(np.float32), (0, 0), max(1.0, 0.006 * iod))
        for c3 in ncen3:
            X3 = c3 @ R.T + t; c = X3[:2] / X3[2] * f + [cx, cy]; s = int(np.sign(c[0] - tip[0]))
            if s == 0: continue
            for b, (a0, a1) in enumerate(ANG_BINS):
                rat = []
                for a_ in range(a0, a1, 5):
                    dv = np.array([s * np.cos(np.radians(a_)), np.sin(np.radians(a_))])
                    rr = np.arange(0.06 * iod, 0.24 * iod, 0.5); P = c + rr[:, None] * dv
                    okp = (samp(okf, P) > 0.99) & (samp(okf, P + h * dv) > 0.99) & (samp(okf, P - h * dv) > 0.99)
                    conc = samp(dd, P) - 0.5 * (samp(dd, P + h * dv) + samp(dd, P - h * dv)); conc[~okp] = -9
                    if conc.max() <= 0: continue
                    im_ = int(np.argmax(conc)); sel = np.abs(rr - rr[im_]) <= 0.06 * iod
                    val = 0.5 * (samp(g, P + h * dv) + samp(g, P - h * dv)) - samp(g, P); val[~sel] = -9
                    ip = int(np.argmax(val))
                    if val[ip] <= 0.004: continue
                    rat.append(rr[ip] / rr[im_])
                if len(rat) >= 2: out[s][b].append(float(np.median(rat)))
    return out


def scale_alar(V, lid, side_scale, sign_of, centers):
    """side_scale[side] = per-bin scale; between bin centres (height above the tip, x IOD) linear, constant outside"""
    L = V[lid]; ax = head_axes(L); x, up = ax[0], ax[1]; iod = np.linalg.norm(L[33] - L[263])
    mid = L[1] @ x; s = V @ x - mid
    hgt = (V - L[1]) @ up
    t_up = np.clip((hgt - UP_FADE[0] * iod) / ((UP_FADE[1] - UP_FADE[0]) * iod), 0, 1); w_up = 1 - t_up * t_up * (3 - 2 * t_up)
    hsn = (L[2] - L[1]) @ up
    h0, h1 = hsn - DOWN_START * iod, 0.5 * ((L[61] - L[1]) @ up + (L[291] - L[1]) @ up)
    t_dn = np.clip((h0 - hgt) / max(h0 - h1, 0.05 * iod), 0, 1); w_up *= 1 - t_dn * t_dn * (3 - 2 * t_dn)
    order = np.argsort(centers)
    out = V.copy(); W = np.zeros(len(V))
    for side, ids in ALAR.items():
        d = np.min(np.linalg.norm(V[:, None, :] - L[ids][None], axis=2), axis=1)
        tt = np.clip((d - CORE * iod) / (FADE * iod), 0, 1); w = (1 - tt * tt * (3 - 2 * tt)) * w_up
        w *= (np.sign(s) == sign_of[side])                     # each side only on its own half of the face
        k = np.interp(hgt / iod, np.asarray(centers)[order], np.asarray(side_scale[side])[order])
        if LOW_H is not None and LOW_H > hsn / iod:
            # v9 (10/22, user on p2: the round lower wing, which no row measures, came out wider than the photo): below the
            # lowest measured row the scale returns to 1 at the subnasale height instead of carrying the lowest bin's
            h_end = hsn / iod - LOW_END                       # fade end below the subnasale (longer = smoother)
            tl = np.clip((LOW_H - hgt / iod) / (LOW_H - h_end), 0, 1); k = 1 + (k - 1) * (1 - (1 - LOW_KEEP) * tl * tl * (3 - 2 * tl))
        # v3: scaled up to the alar crease, beyond it (cheek) only the crease's own shift, fading with w - a pure scale
        # pushed the cheek further out than the wing (me01: cheek crease score 0.06 -> 0.14 % IOD)
        sc = np.max(np.abs(L[ids] @ x - mid))
        out += (w * (k - 1) * np.sign(s) * np.minimum(np.abs(s), sc))[:, None] * x
        W = np.maximum(W, w)
    return out, W


def main():
    import cv2, pycolmap
    ap = argparse.ArgumentParser()
    for k in ("fit", "fit_json", "sparse", "images", "poses", "prepare", "out"): ap.add_argument(k)
    ap.add_argument("--exclude"); ap.add_argument("--debug"); ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--max-yaw", type=float, default=8.0); ap.add_argument("--max-pitch", type=float, default=12.0)
    # v10: default "groove" - the outline stage (v7) widened the wing to the visible-outline rule of the gray view
    # BEFORE the gray view showed the ambient occlusion; now the gray view shows the model's crease as the wing edge
    ap.add_argument("--photo-edge", default="drop", choices=["drop", "valley"])
    ap.add_argument("--target", default="groove", choices=["both", "groove"],
                    help="both (v7) = groove fit, then a small outline correction; groove = v1-v6")
    ap.add_argument("--outline-rounds", type=int, default=2)
    ap.add_argument("--max-frames", type=int, default=0, help="--fast: use at most this many frontal frames (evenly spaced)")
    ap.add_argument("--max-change", type=float, default=0.0, help="v9: limit every bin's total scale to 1 +- this "
                    "(the pass after the nostril fit: only undo what that fit moved, 0.05)")
    # off (10/22): on IMG_6006 / IMG_5996 the ray measurement of the lower curve was too unsteady (lower bins 0.62-1.16,
    # a 10 % scale moved it by 0.04) and the shape barely changed - kept as an experiment
    ap.add_argument("--lower-curve", action="store_true", help="v8 lower-curve stage (experimental)")
    a = ap.parse_args()
    global TARGET, LIMITS, OUTLINE_LIMITS, LOW_H, PHOTO_EDGE
    PHOTO_EDGE = a.photo_edge
    if a.max_change > 0:
        LIMITS = (1 - a.max_change, 1 + a.max_change); OUTLINE_LIMITS = LIMITS
    m = meshio.read_any(a.fit); V = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"])
    lid = np.asarray(json.load(open(a.fit_json, encoding="utf-8"))["landmark_vertex_ids"])
    rec = pycolmap.Reconstruction(a.sparse); cam = intrinsics(list(rec.cameras.values())[0])
    poses = json.load(open(a.poses, encoding="utf-8"))["frames"]
    pitch = {i["file"]: i.get("pitch") for i in json.load(open(a.prepare, encoding="utf-8"))["images"]}
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    frames = {}
    for name, p in sorted(poses.items()):
        if p["status"] == "dropped" or name in excl or p.get("yaw") is None or abs(p["yaw"]) > a.max_yaw: continue
        if pitch.get(name) is None or abs(pitch[name]) > a.max_pitch: continue
        frames[name] = (np.array(p["R"]), np.array(p["t"]), cv2.imread(os.path.join(a.images, name)))
    if a.max_frames > 0 and len(frames) > a.max_frames:
        ks = sorted(frames); ks = [ks[int(round(i))] for i in np.linspace(0, len(ks) - 1, a.max_frames)]
        frames = {k: frames[k] for k in ks}
    rep = {"frames": len(frames)}
    if len(frames) < 5:
        rep.update(status="skipped", reason="frontal frames < 5"); print(json.dumps(rep)); return
    # image side (+1 = right in the image) -> which half of the head (sign along head x): from one frame
    R0, t0, _ = next(iter(frames.values())); ax = head_axes(V[lid])
    xc = (R0 @ ax[0])[0]                                                       # head x seen in the image
    sign_of = {+1: 1 if xc > 0 else -1, -1: -1 if xc > 0 else 1}
    nb = len(BINS) - 1; scale = {+1: [1.0] * nb, -1: [1.0] * nb}; hist = []; centers = None
    W0 = V.copy(); vis0, vis1 = [], []
    # v9 runaway guard (p2, lowest bin after the nostril fit: the ratio stayed ~1.05 while the scale went 1.00 -> 1.155,
    # the row's crease / valley were the nostril rim's shadow, which does not move with the scale)
    last = {+1: [None] * nb, -1: [None] * nb}; frozen = {+1: [False] * nb, -1: [False] * nb}; reset = []
    def responds(s_, k, ratio):
        lr = last[s_][k]
        if lr is None: return True
        r0, ch, sc0 = lr
        if abs(ch - 1) < 0.01: return True
        want = r0 - r0 / ch                                  # ratio change the scale change should have produced
        return (r0 - ratio) / want >= RESPOND if abs(want) > 1e-6 else True
    for rd in range(a.rounds + 1):
        vis = vis0 if rd == 0 else (vis1 if rd == a.rounds else None)
        r, hts = measure(V, F, lid, frames, cam, vis if a.debug else None)
        if centers is None:
            centers = [float(np.median(hts[k])) if hts[k] else (BINS[k] + BINS[k + 1]) / 2 for k in range(nb)]
            allh = [h_ for k in range(nb) for h_ in hts[k]]
            LOW_H = float(np.percentile(allh, 5)) if allh else None
        st = {s: [(float(np.median(r[s][k])), float(np.subtract(*np.percentile(r[s][k], [75, 25]))), len(r[s][k]))
                  if len(r[s][k]) >= 5 else (None, None, len(r[s][k])) for k in range(nb)] for s in r}
        hist.append({("img_right" if s > 0 else "img_left"): [None if v[0] is None else round(v[0], 3) for v in st[s]] for s in st})
        if rd == a.rounds: break
        for s in st:
            for k, v in enumerate(st[s]):
                if frozen[s][k] or v[0] is None or v[1] > 0.08: continue   # too few / unstable / reset: keeps its scale
                if not responds(s, k, v[0]):
                    scale[s][k] = last[s][k][2]; frozen[s][k] = True
                    reset.append({"side": "img_right" if s > 0 else "img_left", "bin": k, "stage": "groove", "round": rd}); continue
                new = float(np.clip(scale[s][k] * v[0], *LIMITS))
                last[s][k] = (v[0], new / scale[s][k], scale[s][k]); scale[s][k] = new
        V, Wt = scale_alar(W0, lid, scale, sign_of, centers)
    # v7 (10/22): second stage on the VISIBLE OUTLINE. The groove fit matched the darkest valley, but the user saw one wing's
    # outline still inside the photo (gray view, frame 00574: outline 1.85 % IOD inside, groove matched). The outline
    # measurement is unsteady at the wing top, so: only bins whose frames agree (IQR <= 0.06), and at most -5 / +10 %
    # on top of the groove result.
    outline_hist = []
    if a.target == "both" and a.outline_rounds > 0:
        TARGET = "outline"; extra = {+1: [1.0] * nb, -1: [1.0] * nb}; base_scale = {k_: list(v_) for k_, v_ in scale.items()}
        olast = {+1: [None] * nb, -1: [None] * nb}; ofrozen = {+1: [False] * nb, -1: [False] * nb}
        for rd in range(a.outline_rounds + 1):
            r, _ = measure(V, F, lid, frames, cam)
            st = {s: [(float(np.median(r[s][k])), float(np.subtract(*np.percentile(r[s][k], [75, 25]))), len(r[s][k]))
                      if len(r[s][k]) >= 5 else (None, None, len(r[s][k])) for k in range(nb)] for s in r}
            outline_hist.append({("img_right" if s > 0 else "img_left"): [None if v[0] is None else round(v[0], 3) for v in st[s]] for s in st})
            if rd == a.outline_rounds: break
            for s in st:
                for k, v in enumerate(st[s]):
                    if ofrozen[s][k] or v[0] is None or v[1] > 0.06: continue
                    lr = olast[s][k]
                    if lr is not None and abs(lr[1] - 1) >= 0.01:
                        want = lr[0] - lr[0] / lr[1]
                        if abs(want) > 1e-6 and (lr[0] - v[0]) / want < RESPOND:
                            extra[s][k] = lr[2]; ofrozen[s][k] = True
                            reset.append({"side": "img_right" if s > 0 else "img_left", "bin": k, "stage": "outline", "round": rd}); continue
                    new = float(np.clip(extra[s][k] * v[0], *OUTLINE_LIMITS))
                    olast[s][k] = (v[0], new / extra[s][k], extra[s][k]); extra[s][k] = new
            scale = {s: [float(np.clip(base_scale[s][k] * extra[s][k], *LIMITS)) for k in range(nb)] for s in base_scale}
            V, Wt = scale_alar(W0, lid, scale, sign_of, centers)
        TARGET = "groove"
        rep["outline_stage"] = {"photo_over_model_per_round": outline_hist,
                                "extra_scale": {"img_right": [round(v, 3) for v in extra[+1]], "img_left": [round(v, 3) for v in extra[-1]]}}
    # v8 (10/22, user on IMG_6006 front view: one wing's LOWER curve sits lower / further out than the photo while the
    # other matched): the rows above only see the wing above the nostrils, the lower curve (down to where the wing meets
    # the lip) followed whatever the rows' scale did there. Rays from each nostril centre: the lower-lateral (15-40 deg)
    # and lower (40-65 deg) parts are brought to the SAME photo / model ratio as the lateral part (-10..15 deg), per side,
    # by scaling about the nostril centre in the head's right / up plane (keeps whatever rule fit the wing side).
    low_rep = {}
    if a.lower_curve:
        from gnm_model import GNM, template_map
        Gm = GNM(); o2g = template_map()[0]; gq = lambda nm: (Gm.groups[Gm.group_names.index(nm)] > 0.5)[o2g]
        mat = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz"))["materials"]
        Lv = V[lid]; iod0 = np.linalg.norm(Lv[33] - Lv[263]); midx = Lv[[1, 2, 4, 5, 195, 197]].mean(0) @ ax[0]
        cav = gq("skin") & ~gq("skin_exterior") & ~gq("mouth_sock") & ~gq("eye_sockets") & (mat == 0) & (np.linalg.norm(V - Lv[1], axis=1) < 0.3 * iod0)
        hside = {hs: cav & (np.sign(V @ ax[0] - midx) == hs) for hs in (-1, 1)}
        if all(hside[hs].sum() >= 10 for hs in (-1, 1)):
            ncen = {hs: V[hside[hs]].mean(0) for hs in (-1, 1)}
            img_of_head = {sign_of[s_]: s_ for s_ in (-1, 1)}                 # head side -> image side
            cum = {+1: [1.0] * len(ANG_BINS), -1: [1.0] * len(ANG_BINS)}; Vb = V.copy(); lh = []
            angc = [0.5 * (b0 + b1) for b0, b1 in ANG_BINS]
            def apply_low(cumv):
                Vn = Vb.copy()
                for hs in (-1, 1):
                    s_ = img_of_head[hs]; pr = Vb - ncen[hs]
                    o = (pr @ ax[0]) * hs; dn = -(pr @ ax[1]); rho = np.hypot(o, dn) / iod0
                    ang = np.degrees(np.arctan2(dn, o))
                    sc = np.interp(ang, angc, cumv[s_]); sc = 1 + (sc - 1) * (1 - np.clip((ang - 80) / 20, 0, 1))
                    tr = np.clip((rho - 0.22) / 0.10, 0, 1)
                    wv = (1 - tr * tr * (3 - 2 * tr)) * ((Vb @ ax[0] - midx) * hs > 0) * (mat == 0)
                    Vn = Vn + ((sc - 1) * wv)[:, None] * (o[:, None] * hs * ax[0][None, :] - dn[:, None] * ax[1][None, :])
                return Vn
            for rd in range(3):
                rr_ = radial_ratios(V, F, lid, frames, cam, [ncen[-1], ncen[1]])
                st = {s_: [(float(np.median(rr_[s_][b])), float(np.subtract(*np.percentile(rr_[s_][b], [75, 25]))), len(rr_[s_][b]))
                           if len(rr_[s_][b]) >= 5 else (None, None, len(rr_[s_][b])) for b in range(len(ANG_BINS))] for s_ in rr_}
                lh.append({("img_right" if s_ > 0 else "img_left"): [None if v[0] is None else round(v[0], 3) for v in st[s_]] for s_ in st})
                if rd == 2: break
                for s_ in st:
                    ref = st[s_][0]
                    if ref[0] is None or ref[1] > 0.08: continue
                    for b in range(1, len(ANG_BINS)):
                        v = st[s_][b]
                        if v[0] is None or v[1] > 0.08: continue
                        cum[s_][b] = float(np.clip(cum[s_][b] * v[0] / ref[0], *LOW_LIMITS))
                V = apply_low(cum)
            low_rep = {"photo_over_model_per_round": lh, "angle_bins_deg": ANG_BINS,
                       "scale": {"img_right": [round(v, 3) for v in cum[+1]], "img_left": [round(v, 3) for v in cum[-1]]}}
    rep["lower_curve"] = low_rep
    rep["v9"] = {"reset_bins": reset, "lowest_row_pct_iod": None if LOW_H is None else round(LOW_H * 100, 1), "max_change": a.max_change}
    if a.debug and vis0:
        import cv2
        cv2.imwrite(a.debug, np.vstack([np.hstack(vis0), np.hstack(vis1)]) if len(vis1) == len(vis0) else np.hstack(vis0),
                    [cv2.IMWRITE_JPEG_QUALITY, 88])
    iod = np.linalg.norm(W0[lid[33]] - W0[lid[263]])
    L0, L1 = W0[lid], V[lid]
    rep.update(status="ok", bin_heights_pct_iod=[round(c * 100, 1) for c in centers],
               photo_over_model_per_round=hist, scale={"img_right": [round(v, 3) for v in scale[+1]], "img_left": [round(v, 3) for v in scale[-1]]},
               alar_width_pct_iod={"before": round(float(np.linalg.norm(L0[64] - L0[294]) / iod * 100), 2),
                                   "after": round(float(np.linalg.norm(L1[64] - L1[294]) / iod * 100), 2)},
               max_move_pct_iod=round(float(np.linalg.norm(V - W0, axis=1).max() / iod * 100), 2))
    meshio.write_ply(a.out, V, F, colors=m.get("colors"))
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
