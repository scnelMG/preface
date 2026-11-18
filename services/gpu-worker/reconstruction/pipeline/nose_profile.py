"""Nose PROFILE (tip / infratip / columella) from the true-profile photos (2026-10-22, option --nose-profile, off).

Problem (user, IMG_6006 and IMG_5996): from the side the model's nose sticks out below the tip - the columella ("비주")
hangs lower / further forward than the photo, and from the front its bottom curve sits lower and wider. Measured on the
true-profile frames (|yaw| >= 72 deg, nose on the silhouette) against the photo's nose / background edge, the model
stuck out 4.6 % (IMG_6006) and 7.3 % IOD (IMG_5996) at 0.03-0.10 IOD below the tip, 2.3-2.4 % at the tip / subnasale.
Nothing in the fit looked at the profile there: the selfie person masks cut through the nose in some profiles (00439),
and the 50-65 deg frames have the cheek, not the nose, on their silhouette.
Measurement (per true-profile frame, hold-out excluded): the model is rendered with the frame's pose; per image row from
0.20 IOD above to 0.18 IOD below the nose tip, the model's outermost silhouette pixel in the facing direction vs the
strongest colour edge (Lab, horizontal gradient) of the photo within -0.15 .. +0.08 IOD of it -> (model - photo) in
% IOD, per height bin the median over rows, then over frames.
Correction: the front of the nose moves back (head forward axis) by the bin's offset, linear in height between the bin
centres, fading out above 0.15-0.25 IOD over the tip (dorsum: nose_depth's job), 0.20-0.28 IOD below it (lip), beyond the
wings and behind the subnasale depth; 3 rounds of measure -> move (gain 0.8).
Safeguards: >= 3 frames per bin, frame spread (IQR) <= 3 % IOD, move limited to 8 % IOD per bin, fold guard; nothing
is applied unless the mean absolute offset over the bins gets smaller.
usage: python nose_profile.py <fit.ply> <fit.json> <sparse> <images> <frame_poses.json> <out.ply>
       [--exclude holdout.txt] [--debug check.jpg]   -> prints JSON stats
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa
from template_fit import head_axes  # noqa
from frame_check import intrinsics  # noqa

BINS = [-0.20, -0.10, -0.03, 0.03, 0.10, 0.18]   # height below the nose tip, x IOD (negative = above the tip)
MIN_YAW = 72.0
LIM = 0.08                                       # x IOD per bin
STEP = 0.035                                     # x IOD, largest difference between neighbouring bins (a sharp step
                                                 # between the tip and the infratip folded the surface on IMG_5996)
UP_FADE, DOWN_FADE = (0.15, 0.25), (0.20, 0.28)  # x IOD above / below the tip: full effect inside, none beyond
SIDE_FADE, BACK_FADE = 0.08, 0.10                # beyond the alar half-width / behind the subnasale depth, x IOD


def sm(u):
    u = np.clip(u, 0, 1); return u * u * (3 - 2 * u)


def measure(V, F, lid, frames, cam, ax, vis=None, photo=None):
    """{bin: [per-frame median offset, % IOD (+ = model sticks out)]}. `photo` (dict, filled on the first call): the
    photo edge per frame and row, found once next to the INPUT model and then kept - the photo does not change, and
    searching next to the moved model found the wing's inner line instead in some frames (spread 1 -> 7 % IOD)"""
    import cv2
    f, cx, cy = cam; out = {k: [] for k in range(len(BINS) - 1)}
    first = photo is not None and not photo
    for name, (R, t, img) in frames.items():
        X = V @ R.T + t; z = X[:, 2]; uv = X[:, :2] / X[:, 2:] * f + [cx, cy]
        m = np.zeros(img.shape[:2], np.uint8); pts = np.round(uv[F] * 4).astype(np.int32)
        for tri in pts[(z[F] > 0).all(1)]: cv2.fillPoly(m, [tri], 1, shift=2)
        tip = uv[lid[1]]; iod = np.linalg.norm(V[lid[33]] - V[lid[263]]) * f / np.median(z[lid])
        sg = 1 if tip[0] > 0.5 * (uv[lid[234]][0] + uv[lid[454]][0]) else -1
        if photo is None or first:
            lab = cv2.cvtColor(cv2.GaussianBlur(img, (0, 0), 1.0), cv2.COLOR_BGR2LAB).astype(np.float32)
            gx = sum(np.abs(cv2.Sobel(lab[..., c], cv2.CV_32F, 1, 0, ksize=3)) for c in range(3))
        if first: photo[name] = {}
        rows = []
        for y in range(max(0, int(tip[1] + BINS[0] * iod)), min(img.shape[0], int(tip[1] + BINS[-1] * iod))):
            xs = np.where(m[y])[0]
            if not len(xs): continue
            xm = xs.max() if sg > 0 else xs.min()
            if photo is not None and not first:
                xp = photo.get(name, {}).get(y)
                if xp is None: continue
            else:
                xr = np.arange(int(xm - sg * 0.15 * iod), int(xm + sg * 0.08 * iod), sg); xr = xr[(xr > 1) & (xr < img.shape[1] - 2)]
                if not len(xr): continue
                g = gx[y, xr]
                if g.max() < 25: continue
                xp = int(xr[np.argmax(g)])
                if first: photo[name][y] = xp
            rows.append(((y - tip[1]) / iod, sg * (xm - xp) / iod * 100, y, xm, xp))
        if len(rows) < 10: continue
        a = np.array(rows)
        for k in range(len(BINS) - 1):
            sel = (a[:, 0] >= BINS[k]) & (a[:, 0] < BINS[k + 1])
            if sel.sum() >= 3: out[k].append(float(np.median(a[sel, 1])))
        if vis is not None and len(vis) < 6:
            c = img.copy()
            for (_, _, y, xm, xp) in rows:
                c[int(y), int(xm)] = (0, 0, 255); c[int(y), int(xp)] = (0, 255, 0)
            r = int(0.45 * iod); cr = c[max(0, int(tip[1] - r)):int(tip[1] + 0.8 * r), max(0, int(tip[0] - 1.2 * r)):int(tip[0] + 0.6 * r)]
            if cr.size: vis.append(cv2.resize(cr, (240, 240)))
    return out


def main():
    import cv2, pycolmap
    ap = argparse.ArgumentParser()
    for k in ("fit", "fit_json", "sparse", "images", "poses", "out"): ap.add_argument(k)
    ap.add_argument("--exclude"); ap.add_argument("--debug"); ap.add_argument("--rounds", type=int, default=3)
    a = ap.parse_args()
    m = meshio.read_any(a.fit); V0 = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"]).astype(np.int64)
    lid = np.asarray(json.load(open(a.fit_json, encoding="utf-8"))["landmark_vertex_ids"])
    L = V0[lid]; ax = head_axes(L); iod = np.linalg.norm(L[33] - L[263])
    rec = pycolmap.Reconstruction(a.sparse); cam = intrinsics(list(rec.cameras.values())[0])
    poses = json.load(open(a.poses, encoding="utf-8"))["frames"]
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    frames = {}
    for n, p in sorted(poses.items()):
        if p["status"] == "dropped" or n in excl: continue
        R, t = np.array(p["R"]), np.array(p["t"]); fc = R @ ax[2]
        if abs(np.degrees(np.arctan2(fc[0], -fc[2]))) < MIN_YAW: continue
        img = cv2.imread(os.path.join(a.images, n))
        if img is not None: frames[n] = (R, t, img)
    rep = {"frames": len(frames)}
    if len(frames) < 3:
        rep.update(status="skipped", reason="true-profile frames < 3"); meshio.write_ply(a.out, V0, F, colors=m.get("colors")); print(json.dumps(rep)); return
    # weights: height (fade over the dorsum / the lip), side (beyond the wings), depth (behind the subnasale)
    rel = V0 - L[1]; hb = -(rel @ ax[1]) / iod; fw = (rel @ ax[2]) / iod
    mid = L[[1, 2, 4, 5, 195, 197]].mean(0) @ ax[0]; xx = np.abs(V0 @ ax[0] - mid) / iod
    aw = 0.5 * np.linalg.norm(L[64] - L[294]) / iod; fs = (L[2] - L[1]) @ ax[2] / iod
    w = ((1 - sm((-hb - UP_FADE[0]) / (UP_FADE[1] - UP_FADE[0]))) * (1 - sm((hb - DOWN_FADE[0]) / (DOWN_FADE[1] - DOWN_FADE[0])))
         * (1 - sm((xx - aw) / SIDE_FADE)) * sm((fw - (fs - BACK_FADE)) / BACK_FADE))
    cen = np.array([(BINS[k] + BINS[k + 1]) / 2 for k in range(len(BINS) - 1)])
    def move(shift):                                     # shift per bin, x IOD (+ = back)
        s = np.interp(hb, cen, shift)
        return V0 - (w * s)[:, None] * ax[2][None, :] * iod
    n0 = np.cross(V0[F[:, 1]] - V0[F[:, 0]], V0[F[:, 2]] - V0[F[:, 0]])
    def flips(V):
        n1 = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); return int(((n0 * n1).sum(1) <= 0).sum())
    def stats(r):
        return [(float(np.median(v)), float(np.subtract(*np.percentile(v, [75, 25]))), len(v)) if len(v) >= 3 else (None, None, len(v)) for v in r.values()]
    shift = np.zeros(len(cen)); hist = []; V = V0; photo = {}
    for rd in range(a.rounds + 1):
        st = stats(measure(V, F, lid, frames, cam, ax, photo=photo))
        hist.append([None if s_[0] is None else round(s_[0], 2) for s_ in st])
        if os.environ.get("NP_DEBUG"): print("round", rd, [(None if s_[0] is None else round(s_[0], 2), None if s_[1] is None else round(s_[1], 2), s_[2]) for s_ in st], file=sys.stderr)
        if rd == a.rounds: break
        for k, (med, iqr, nf) in enumerate(st):
            if med is None or iqr > 3.0: continue
            shift[k] = float(np.clip(shift[k] + 0.8 * med / 100, -LIM, LIM))
        for _ in range(len(shift)):                      # neighbouring bins within STEP of each other
            for k in range(1, len(shift)):
                d_ = shift[k] - shift[k - 1]
                if abs(d_) > STEP: shift[k] -= 0.5 * (d_ - np.sign(d_) * STEP); shift[k - 1] += 0.5 * (d_ - np.sign(d_) * STEP)
        V = move(shift)
    gain = 1.0
    for gain in (1.0, 0.8, 0.6, 0.45, 0.3):              # fold guard: shrink the whole move until nothing turns over
        if not flips(move(shift * gain)): break
    if gain < 1.0:
        shift = shift * gain; V = move(shift); hist.append([None if s_[0] is None else round(s_[0], 2) for s_ in stats(measure(V, F, lid, frames, cam, ax, photo=photo))])
    b0 = [abs(v) for v in hist[0] if v is not None]; b1 = [abs(v) for v in hist[-1] if v is not None]
    nflip = flips(V)
    ok = bool(b0) and bool(b1) and np.mean(b1) < np.mean(b0) and nflip == 0
    rep["fold_guard_gain"] = gain
    rep.update(status="applied" if ok else ("kept (folds)" if nflip else "kept (no gain)"), bins_below_tip_iod=BINS,
               model_minus_photo_pct_iod_per_round=hist, shift_back_pct_iod=[round(v * 100, 2) for v in shift],
               max_move_pct_iod=round(float(np.linalg.norm(V - V0, axis=1).max() / iod * 100), 2), frames_used=sorted(frames))
    meshio.write_ply(a.out, V if ok else V0, F, colors=m.get("colors"))
    if a.debug:
        vis = []; measure(V if ok else V0, F, lid, frames, cam, ax, vis, photo=photo)
        if vis: cv2.imwrite(a.debug, np.hstack(vis), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
