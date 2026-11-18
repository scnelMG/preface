"""Side-view PROFILE silhouettes (forehead-nose-lips-chin edge against the background) from the photos.

Why: at 35-70 deg head turns the face profile is a silhouette. MediaPipe puts its midline points on the visible skin a bit
inside the real edge, and the template fit had no constraint on the profile depth at all (outline points only from
near-frontal views), so the nose / lips / chin depth was free -> on p01-s1 the + side profile stuck out ~10 px (nose) while
the - side matched. The photo edge itself is the most reliable cue there.

profile_obs(...) -> list of dicts per side frame: R, t, f, cx, cy, edge (N,2 photo profile edge pixels), y-range, fwd2d.
Segmentation: GrabCut initialised from the current model's projected mask (sure fg = eroded, sure bg = far outside).
CLI: measure the signed model-vs-photo profile offset per side frame (+ = model sticks out further than the photo).
  python profile_sil.py <model.ply> <fit.json> <sparse> <images> <poses.json> [--debug out.jpg]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)

MID_TOP, MID_BOT = 151, 152   # profile range: mid-forehead .. chin (far-side brow / eye / cheekbone line included)


def project(P, R, t, f, cx, cy):
    Pc = P @ R.T + t
    return np.c_[f * Pc[:, 0] / Pc[:, 2] + cx, f * Pc[:, 1] / Pc[:, 2] + cy], Pc[:, 2]


def model_mask(V, F, R, t, f, cx, cy, H, W, off=(0, 0)):
    import cv2
    uv, z = project(V, R, t, f, cx, cy)
    m = np.zeros((H, W), np.uint8)
    pts = np.round(uv[F] - np.asarray(off, float)).astype(np.int32)
    ok = (z[F] > 0).all(1)
    cv2.fillPoly(m, list(pts[ok]), 255)
    return m, uv


def profile_edge(mask, lm2d, fwd2d):
    """outer contour pixels of mask between the eye-line and the chin rows, on the FRONT side of the face."""
    import cv2
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts: return np.zeros((0, 2))
    c = max(cnts, key=cv2.contourArea)[:, 0, :].astype(float)
    y0, y1 = lm2d[MID_TOP, 1], lm2d[MID_BOT, 1] + 0.03 * abs(lm2d[MID_BOT, 1] - lm2d[MID_TOP, 1])
    mid = lm2d[[151, 9, 168, 6, 197, 195, 5, 4, 1, 2, 0, 17, 152]].mean(0)
    sel = (c[:, 1] >= y0) & (c[:, 1] <= y1) & ((c - mid) @ fwd2d > 0)
    # per row keep the most forward contour pixel (the profile, not the neck / jaw underside)
    c = c[sel]
    if not len(c): return c
    out = {}
    for p in c:
        k = int(p[1]); s = p @ fwd2d
        if k not in out or s > out[k][0]: out[k] = (s, p)
    return np.array([v[1] for _, v in sorted(out.items())])


def profile_obs(sparse, poses_json, images, V, F, lm_ids, exclude=(), yaw_min=20.0, yaw_max=75.0, debug=None):
    import cv2, pycolmap
    from frame_check import load_poses, intrinsics
    import face_lm
    rec = pycolmap.Reconstruction(sparse); poses = load_poses(poses_json)
    L = V[lm_ids]
    hc = (L[234] + L[454]) / 2
    out = []; tiles = []
    for im in sorted(rec.images.values(), key=lambda i: i.name):
        if im.name not in poses or im.name in exclude: continue
        img = cv2.imread(os.path.join(images, im.name))
        if img is None: continue
        lm, M4 = face_lm.landmarks(images, im.name, img)
        if lm is None: continue
        M = np.array(M4)[:3, :3]; yaw = float(np.degrees(np.arctan2(M[0, 2], M[2, 2])))
        if not (yaw_min <= abs(yaw) <= yaw_max): continue
        H, W = img.shape[:2]
        R, t = poses[im.name]; f, cx, cy = intrinsics(rec.cameras[im.camera_id])
        mm, uvV = model_mask(V, F, R, t, f, cx, cy, H, W)
        lm2d = uvV[lm_ids]
        a2, _ = project(np.array([hc, L[1]]), R, t, f, cx, cy); fwd2d = a2[1] - a2[0]; fwd2d /= np.linalg.norm(fwd2d) + 1e-9
        iod = np.linalg.norm(lm2d[33] - lm2d[263]); k = max(5, int(0.35 * iod))
        # GrabCut on a crop around the model
        ys, xs = np.where(mm > 0)
        if not len(xs): continue
        x0, x1 = max(0, xs.min() - 3 * k), min(W, xs.max() + 3 * k); y0, y1 = max(0, ys.min() - 3 * k), min(H, ys.max() + 3 * k)
        sub = img[y0:y1, x0:x1]; m0 = mm[y0:y1, x0:x1]
        gc = np.full(m0.shape, cv2.GC_BGD, np.uint8)
        dil = cv2.dilate(m0, np.ones((2 * k + 1, 2 * k + 1), np.uint8)); ero = cv2.erode(m0, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
        gc[dil > 0] = cv2.GC_PR_BGD; gc[m0 > 0] = cv2.GC_PR_FGD; gc[ero > 0] = cv2.GC_FGD
        bgd = np.zeros((1, 65)); fgd = np.zeros((1, 65))
        sc = min(1.0, 400.0 / max(sub.shape[:2]))     # GrabCut on a <=400 px crop (speed), mask scaled back up
        sub_s = cv2.resize(sub, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA) if sc < 1 else sub
        gc_s = cv2.resize(gc, (sub_s.shape[1], sub_s.shape[0]), interpolation=cv2.INTER_NEAREST) if sc < 1 else gc
        try:
            cv2.grabCut(sub_s, gc_s, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
        except cv2.error:
            continue
        fg = np.where((gc_s == cv2.GC_FGD) | (gc_s == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        if sc < 1: fg = (cv2.resize(fg, (sub.shape[1], sub.shape[0]), interpolation=cv2.INTER_LINEAR) > 127).astype(np.uint8) * 255
        seg = np.zeros((H, W), np.uint8); seg[y0:y1, x0:x1] = fg
        seg = cv2.morphologyEx(seg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        edge = profile_edge(seg, lm2d, fwd2d)
        medge = profile_edge(mm, lm2d, fwd2d)
        if len(edge) < 20: continue
        # sanity: the photo edge must stay near the model edge (segmentation failures leak into the background)
        from scipy.spatial import cKDTree
        d, _ = cKDTree(edge).query(medge)
        if np.median(d) > 0.6 * iod: continue
        out.append(dict(name=im.name, yaw=yaw, R=R, t=t, f=f, cx=cx, cy=cy, edge=edge, fwd2d=fwd2d, iod=iod))
        if debug is not None:
            vis = img.copy()
            for p in medge.astype(int): cv2.circle(vis, tuple(p), 1, (0, 0, 255), -1)
            for p in edge.astype(int): cv2.circle(vis, tuple(p), 1, (0, 255, 0), -1)
            c0 = vis[int(lm2d[MID_TOP, 1] - iod):int(lm2d[MID_BOT, 1] + iod * 0.6), int(lm2d[:, 0].min() - iod * 0.3):int(lm2d[:, 0].max() + iod * 0.5)]
            if c0.size:
                c0 = cv2.resize(c0, (int(c0.shape[1] * 360 / c0.shape[0]), 360)); cv2.putText(c0, f"{yaw:.0f}", (4, 18), 0, 0.6, (255, 255, 0), 2)
                tiles.append(c0)
    if debug is not None and tiles:
        import cv2
        rows = [np.hstack(tiles[i:i + 8]) for i in range(0, len(tiles), 8)]
        wmax = max(r.shape[1] for r in rows); rows = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0))) for r in rows]
        cv2.imwrite(debug, np.vstack(rows))
    return out


def signed_offset(V, F, ob):
    """median signed distance (model edge - photo edge) along the face-forward image direction, % of eye distance."""
    import cv2
    H = int(max(ob["edge"][:, 1].max(), 10) + 400); W = int(ob["edge"][:, 0].max() + 800)
    mm, _ = model_mask(V, F, ob["R"], ob["t"], ob["f"], ob["cx"], ob["cy"], H, W)
    rows = {int(p[1]): p for p in ob["edge"]}
    vals = []
    for y, p in rows.items():
        if y >= H: continue
        xs = np.where(mm[y] > 0)[0]
        if not len(xs): continue
        cand = np.c_[xs, np.full(len(xs), y)].astype(float)
        q = cand[np.argmax(cand @ ob["fwd2d"])]
        vals.append((q - p) @ ob["fwd2d"])
    return 100 * np.median(vals) / ob["iod"] if vals else np.nan


def main():
    import meshio
    ap = argparse.ArgumentParser()
    ap.add_argument("model"); ap.add_argument("fit_json"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("poses")
    ap.add_argument("--debug"); ap.add_argument("--exclude"); ap.add_argument("--save", help="cache the side-view observations (pickle) for template_fit --profile-obs")
    ap.add_argument("--only", help="holdout list: measure only these frames")
    a = ap.parse_args()
    m = meshio.read_any(a.model); V = np.asarray(m["vertices"], float); F = np.asarray(m["faces"])
    fj = json.load(open(a.fit_json)); lid = np.array(fj["landmark_vertex_ids"])
    mat = np.asarray(fj.get("material_ids", [])) if "material_ids" in fj else None
    obs = profile_obs(a.sparse, a.poses, a.images, V, F, lid, set(open(a.exclude).read().split()) if a.exclude else set(), debug=a.debug)
    if a.save: save_obs(obs, a.save)
    only = set(open(a.only).read().split()) if a.only else None
    res = [(o["yaw"], signed_offset(V, F, o), o["name"]) for o in obs if only is None or o["name"] in only]
    for side, sgn in (("+", 1), ("-", -1)):
        v = [r[1] for r in res if np.sign(r[0]) == sgn and np.isfinite(r[1])]
        print(f"side {side}: frames {len(v)}  profile offset median {np.median(v) if v else float('nan'):+.2f} %  "
              f"(abs median {np.median(np.abs(v)) if v else float('nan'):.2f} %)")
    print(json.dumps([[round(y, 1), round(float(o), 2), n] for y, o, n in res]))



def sil_targets(X, Fl, ob, Vfull, Ffull):
    """per side frame: skin vertices that form the model's front profile edge -> 3D targets moving them onto the photo
    edge in the same image row (back-projected at the vertex depth). returns (local vertex ids, targets)."""
    R, t, f, cx, cy = ob["R"], ob["t"], ob["f"], ob["cx"], ob["cy"]
    e = ob["edge"]; pad = int(0.8 * ob["iod"])
    x0, y0 = int(e[:, 0].min()) - 3 * pad, int(e[:, 1].min()) - pad
    Wc, Hc = int(e[:, 0].max()) + 3 * pad - x0, int(e[:, 1].max()) + pad - y0
    mm, _ = model_mask(Vfull, Ffull, R, t, f, cx, cy, Hc, Wc, (x0, y0))
    uv, z = project(X, R, t, f, cx, cy)
    fn = np.cross(X[Fl[:, 1]] - X[Fl[:, 0]], X[Fl[:, 2]] - X[Fl[:, 0]]); vn = np.zeros_like(X)
    for k in range(3): np.add.at(vn, Fl[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    cc = -R.T @ t; vd = cc - X; vd /= np.linalg.norm(vd, axis=1, keepdims=True)
    graz = np.where(np.abs((vn * vd).sum(1)) < 0.35)[0]
    if not len(graz): return np.zeros(0, int), np.zeros((0, 3))
    from scipy.spatial import cKDTree
    tr = cKDTree(uv[graz])
    # model profile edge (most forward mask pixel per row) and its 2D normal; each model edge point moves along that
    # normal onto the nearest photo edge point (not the same row: under the nose / chin the edge is nearly horizontal)
    qs = []
    for yy in range(Hc):
        xs = np.where(mm[yy] > 0)[0]
        if not len(xs): continue
        cand = np.c_[xs + x0, np.full(len(xs), yy + y0)].astype(float)
        qs.append(cand[np.argmax(cand @ ob["fwd2d"])])
    qs = np.array(qs)
    lo, hi = e[:, 1].min(), e[:, 1].max()
    qs = qs[(qs[:, 1] >= lo) & (qs[:, 1] <= hi)] if len(qs) else qs
    if len(qs) < 10: return np.zeros(0, int), np.zeros((0, 3))
    tg = np.gradient(qs, axis=0); tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
    nrm = np.c_[tg[:, 1], -tg[:, 0]]
    nrm *= np.sign((nrm @ ob["fwd2d"]) + 1e-9)[:, None]          # outward = face-forward side
    etree = cKDTree(e)
    acc = {}; n_rows = n_ok = 0
    for q, nq in zip(qs, nrm):
        dist, k = etree.query(q); n_rows += 1
        if dist > 0.25 * ob["iod"]: continue      # segmentation leak (hair strand, wall edge)
        n_ok += 1
        dlt = ((e[k] - q) @ nq) * nq
        d, j = tr.query(q)
        if d > 0.04 * ob["iod"]: continue
        acc.setdefault(int(graz[j]), []).append(dlt)
    if not acc or n_ok < 0.6 * max(n_rows, 1): return np.zeros(0, int), np.zeros((0, 3))   # unreliable frame
    ids = np.array(list(acc)); T = np.zeros((len(ids), 3))
    for i, k in enumerate(ids):
        u = uv[k] + np.mean(acc[k], 0)
        ray = np.array([(u[0] - cx) / f, (u[1] - cy) / f, 1.0]) * z[k]
        T[i] = (ray - t) @ R
    return ids, T


def save_obs(obs, path):
    import pickle
    pickle.dump(obs, open(path, "wb"))


def load_obs(path):
    import pickle
    return pickle.load(open(path, "rb"))


if __name__ == "__main__":
    main()
