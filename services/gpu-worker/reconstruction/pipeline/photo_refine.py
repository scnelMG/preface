"""Photo-consistency surface refinement: move the fitted face surface so that ALL capture photos agree on its colour.

Why: the template fit is driven by 468 landmarks only, so the surface between landmarks follows the template and the
photo colour is "pasted" on a shape that is a few mm off (blur, ghosting). Here every skin vertex is tested along its
normal: a small patch on the surface is projected into a reference photo (most frontal for that vertex) and into
neighbouring photos; where the surface is right, the patches look the same (high NCC). The best offset per vertex,
weighted by how distinct the match is, becomes a soft target of a bi-Laplacian (smooth) deformation, 2-3 rounds.
The same score is the geometry quality map: low agreement = the shape is wrong there (or no texture to judge).

usage: python photo_refine.py <fit.ply> <fit.json> <sparse> <images> <out.ply> [--poses frame_poses.json]
       [--exclude holdout.txt] [--rounds 3] [--search-mm 4] [--w-smooth 20]
writes <out.ply>, <out>.fit.json (same landmark ids), <out>.refine.json (per-round stats), <out>.consistency.npy
(per-vertex NCC after refinement, NaN = not judged).
Scale: offsets are given in 'mm' assuming an outer eye-corner distance of 62 mm when the model has no metric scale
(NOTE: the adult average is ~90 mm, so these 'mm' are ~1.45x real mm; defaults were tuned with this convention).
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa: E402
from template_fit import laplacian  # noqa: E402

TPL = os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")


def vnormals(V, F):
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); n = np.zeros_like(V)
    for k in range(3): np.add.at(n, F[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def bilinear(img, u, v):
    H, W = img.shape
    u = np.clip(u, 0, W - 1.001); v = np.clip(v, 0, H - 1.001)
    x0 = u.astype(np.int32); y0 = v.astype(np.int32); fx = u - x0; fy = v - y0
    I = img
    return (I[y0, x0] * (1 - fx) * (1 - fy) + I[y0, x0 + 1] * fx * (1 - fy) + I[y0 + 1, x0] * (1 - fx) * fy + I[y0 + 1, x0 + 1] * fx * fy)


def main():
    import cv2, pycolmap
    from scipy.sparse import csr_matrix, vstack
    from scipy.sparse.linalg import lsqr
    from scipy.spatial import cKDTree
    from frame_check import load_poses, intrinsics
    ap = argparse.ArgumentParser()
    ap.add_argument("fit"); ap.add_argument("fit_json"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("out")
    ap.add_argument("--poses"); ap.add_argument("--exclude"); ap.add_argument("--rounds", type=int, default=5)
    ap.add_argument("--search-mm", type=float, default=2.5); ap.add_argument("--step-mm", type=float, default=0.4)
    ap.add_argument("--w-smooth", type=float, default=80.0); ap.add_argument("--w-lm", type=float, default=2.0)
    ap.add_argument("--others", type=int, default=4); ap.add_argument("--patch", type=int, default=7)
    ap.add_argument("--patch-px", type=float, default=2.0, help="patch sample spacing in reference-image pixels")
    ap.add_argument("--min-ncc", type=float, default=0.5); ap.add_argument("--max-side", type=int, default=1920)
    ap.add_argument("--region", type=float, default=0.55, help="refine skin within this x eye distance of a landmark")
    ap.add_argument("--judge", help="MEASURE ONLY: frame list (e.g. holdout.txt); reference views from the other frames, "
                    "compared views only from this list -> photo agreement on frames the model never saw (no output mesh)")
    ap.add_argument("--eye-margin", type=float, default=0.12, help="leave skin this close (x eye distance) to the eye openings")
    a = ap.parse_args()
    d = np.load(TPL); F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(a.fit)["vertices"], np.float64)
    fitj = json.load(open(a.fit_json)); lid = np.array(fitj["landmark_vertex_ids"])
    L = V[lid]; iod = np.linalg.norm(L[33] - L[263]); mm = iod / 62.0
    skin = np.where(mat == 0)[0]
    rmap = -np.ones(len(V), int); rmap[skin] = np.arange(len(skin))
    Fs = F[(mat[F] == 0).all(1)]; Fl = rmap[Fs]
    near = cKDTree(L).query(V[skin])[0] < a.region * iod
    # eyes (lashes, eyeball moves, wet highlights) break photo agreement: keep them on the landmark fit
    EYES = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7,
            263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
    eyes_d = cKDTree(L[EYES]).query(V[skin])[0]
    near &= eyes_d > a.eye_margin * iod
    act = np.where(near)[0]                     # local skin ids that are refined
    rec = pycolmap.Reconstruction(a.sparse); poses = load_poses(a.poses)
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    judge = set(open(a.judge).read().split()) if a.judge else None
    if judge: excl = excl - judge; a.rounds = 1
    views = []
    for im in sorted(rec.images.values(), key=lambda i: i.name):
        if im.name in excl or (poses is not None and im.name not in poses): continue
        g = cv2.imread(os.path.join(a.images, im.name), cv2.IMREAD_GRAYSCALE)
        if g is None: continue
        cam = rec.cameras[im.camera_id]; f, cx, cy = intrinsics(cam)
        s = 1.0
        if max(g.shape) > a.max_side:
            s = a.max_side / max(g.shape); g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        R, t = poses[im.name] if poses else (im.cam_from_world().rotation.matrix(), np.asarray(im.cam_from_world().translation))
        views.append(dict(name=im.name, img=g.astype(np.float32), R=np.asarray(R), t=np.asarray(t, float), f=f * s, cx=cx * s, cy=cy * s))
    nV = len(views)
    Lap = laplacian(len(skin), Fl); Bi = (Lap @ Lap).tocsr()
    X = V[skin].copy(); X0 = X.copy(); delta = Bi @ X0
    lm_local = rmap[lid]; okl = lm_local >= 0
    offs = np.arange(-a.search_mm, a.search_mm + 1e-9, a.step_mm) * mm
    k = a.patch; gy, gx = np.mgrid[0:k, 0:k]; grid = np.stack([gx.ravel() - (k - 1) / 2, gy.ravel() - (k - 1) / 2], 1)  # (k*k, 2)
    stats = []
    cons = np.full(len(skin), np.nan)
    for rd in range(a.rounds):
        Vcur = V.copy(); Vcur[skin] = X
        N = vnormals(Vcur, F)[skin]
        cams = np.array([-v["R"].T @ v["t"] for v in views])
        if ((X[act] - X[act].mean(0)) * N[act]).sum(1).mean() < 0: N = -N
        P = X[act]; Nn = N[act]
        # visibility per view: facing + coarse z-buffer of the whole mesh
        cosm = np.zeros((len(act), nV), np.float32); vis = np.zeros((len(act), nV), bool)
        for j, v in enumerate(views):
            cc = cams[j]; dv = cc - P; dist = np.linalg.norm(dv, axis=1)
            cosm[:, j] = (dv * Nn).sum(1) / dist
            Q = Vcur @ v["R"].T + v["t"]; H, W = v["img"].shape
            um = (v["f"] * Q[:, 0] / Q[:, 2] + v["cx"]) / 4; vm = (v["f"] * Q[:, 1] / Q[:, 2] + v["cy"]) / 4
            zb = np.full((H // 4 + 1, W // 4 + 1), np.inf); okm = (Q[:, 2] > 0) & (um >= 0) & (um < W // 4) & (vm >= 0) & (vm < H // 4)
            np.minimum.at(zb, (vm[okm].astype(int), um[okm].astype(int)), Q[okm, 2])
            zb = cv2.erode(np.where(np.isinf(zb), 1e9, zb).astype(np.float32), np.ones((5, 5), np.uint8))
            q = P @ v["R"].T + v["t"]; u = v["f"] * q[:, 0] / q[:, 2] + v["cx"]; w = v["f"] * q[:, 1] / q[:, 2] + v["cy"]
            inb = (q[:, 2] > 0) & (u > 8) & (u < W - 8) & (w > 8) & (w < H - 8)
            zt = zb[np.clip((w / 4).astype(int), 0, zb.shape[0] - 1), np.clip((u / 4).astype(int), 0, zb.shape[1] - 1)]
            vis[:, j] = inb & (q[:, 2] <= zt + 1.5 * mm * 3) & (cosm[:, j] > 0.3)
        isj = np.array([judge is not None and v["name"] in judge for v in views])
        cm = np.where(vis & ~isj[None, :], cosm, -1)
        ref = cm.argmax(1); has = cm.max(1) > 0.5
        # other views: visible, angle to the ref view 6..45 deg, best facing first
        dirs = cams[None, :, :] - P[:, None, :]; dirs /= np.linalg.norm(dirs, axis=2, keepdims=True)
        rdir = dirs[np.arange(len(act)), ref]
        ang = np.degrees(np.arccos(np.clip((dirs * rdir[:, None, :]).sum(2), -1, 1)))
        score = np.where(vis & (ang > 6) & (ang < 45), cosm, -1); score[np.arange(len(act)), ref] = -1
        if judge is not None:
            score = np.where(isj[None, :], score, -1)
        else:
            score = np.where(isj[None, :], -1, score)
        others = np.argsort(-score, 1)[:, :a.others]; oval = np.take_along_axis(score, others, 1) > 0.3
        # tangent frame
        tmp = np.where(np.abs(Nn[:, 0:1]) < 0.9, np.array([[1.0, 0, 0]]), np.array([[0, 1.0, 0]]))
        T1 = np.cross(Nn, tmp); T1 /= np.linalg.norm(T1, axis=1, keepdims=True); T2 = np.cross(Nn, T1)
        # patch spacing from the reference view (patch-px pixels)
        refdepth = np.array([(P[i] @ views[ref[i]]["R"].T + views[ref[i]]["t"])[2] for i in range(len(act))])
        reff = np.array([views[r]["f"] for r in ref]); h = a.patch_px * refdepth / reff
        nO = len(offs); kk = k * k
        # sample points: (n, nO, kk, 3)
        base = P[:, None, None, :] + offs[None, :, None, None] * Nn[:, None, None, :] \
            + (grid[None, None, :, 0:1] * h[:, None, None, None]) * T1[:, None, None, :] + (grid[None, None, :, 1:2] * h[:, None, None, None]) * T2[:, None, None, :]
        base = base.astype(np.float32)

        def sample(idx_v, view_idx):
            """intensities of patches for vertices idx_v in view view_idx -> (len, nO, kk)"""
            v = views[view_idx]; Pt = base[idx_v].reshape(-1, 3) @ v["R"].T.astype(np.float32) + v["t"].astype(np.float32)
            u = v["f"] * Pt[:, 0] / Pt[:, 2] + v["cx"]; w = v["f"] * Pt[:, 1] / Pt[:, 2] + v["cy"]
            return bilinear(v["img"], u, w).reshape(len(idx_v), nO, kk)
        refI = np.zeros((len(act), nO, kk), np.float32)
        for j in range(nV):
            sel = np.where(has & (ref == j))[0]
            if len(sel): refI[sel] = sample(sel, j)

        def zn(Z):
            Z = Z - Z.mean(-1, keepdims=True); return Z / (np.linalg.norm(Z, axis=-1, keepdims=True) + 1e-6)
        refZ = zn(refI); texture = refI.std(-1)[:, nO // 2]
        nccsum = np.zeros((len(act), nO), np.float32); wsum = np.zeros(len(act), np.float32)
        for slot in range(a.others):
            for j in range(nV):
                sel = np.where(has & oval[:, slot] & (others[:, slot] == j))[0]
                if not len(sel): continue
                Z = zn(sample(sel, j))
                nccsum[sel] += (Z * refZ[sel]).sum(-1); wsum[sel] += 1
        ok = has & (wsum >= (1 if judge else 2)) & (texture > 2.0)
        if judge is not None:
            res = {"judged_vertices": int(ok.sum()), "ncc_at_surface_median": float(np.median(ncc_now := (nccsum[:, nO // 2] / np.maximum(wsum, 1))[ok])),
                   "ncc_at_surface_mean": float(ncc_now.mean())}
            print(json.dumps(res)); json.dump(res, open(os.path.splitext(a.out)[0] + ".judge.json", "w")); return
        ncc = nccsum / np.maximum(wsum, 1)[:, None]
        best = ncc.argmax(1); peak = ncc[np.arange(len(act)), best]
        # sub-sample parabola
        b0 = np.clip(best, 1, nO - 2); y0, y1, y2 = ncc[np.arange(len(act)), b0 - 1], ncc[np.arange(len(act)), b0], ncc[np.arange(len(act)), b0 + 1]
        den = y0 - 2 * y1 + y2; sub = np.where(np.abs(den) > 1e-6, 0.5 * (y0 - y2) / den, 0); sub = np.clip(sub, -0.5, 0.5)
        dbest = (b0 + sub) * a.step_mm * mm - a.search_mm * mm
        edge = (best == 0) | (best == nO - 1)
        distinct = peak - np.median(ncc, 1)
        conf = np.where(ok & ~edge & (peak > a.min_ncc), np.clip(distinct, 0, 1) * peak, 0)
        cons[act] = np.where(ok, ncc[:, nO // 2], np.nan)  # agreement of the CURRENT surface (offset 0)
        st = {"round": rd, "vertices": int(len(act)), "judged": int(ok.sum()), "used": int((conf > 0).sum()),
              "ncc_at_surface_median": float(np.nanmedian(ncc[ok, nO // 2])) if ok.any() else None,
              "ncc_best_median": float(np.median(peak[ok])) if ok.any() else None,
              "offset_mm_median_abs": float(np.median(np.abs(dbest[conf > 0])) / mm) if (conf > 0).any() else None}
        stats.append(st); print(json.dumps(st), flush=True)
        # solve: smooth deformation towards the photo-consistent positions
        tgt = P + dbest[:, None] * Nn
        use = np.where(conf > 0)[0]
        rows = [a.w_smooth * Bi]; rhs = [a.w_smooth * delta]
        wc = 3.0 * conf[use]
        rows.append(csr_matrix((wc, (np.arange(len(use)), act[use])), shape=(len(use), len(skin)))); rhs.append(wc[:, None] * tgt[use])
        wl = np.full(int(okl.sum()), a.w_lm)
        rows.append(csr_matrix((wl, (np.arange(len(wl)), lm_local[okl])), shape=(len(wl), len(skin)))); rhs.append(wl[:, None] * X[lm_local[okl]])
        A = vstack(rows).tocsr(); B = np.vstack(rhs)
        X = np.stack([lsqr(A, B[:, c], atol=1e-10, btol=1e-10, iter_lim=3000, x0=X[:, c])[0] for c in range(3)], 1)
    # non-skin parts follow (eyes keep their ring similarity from the fit: shift by the mean displacement around them)
    Vout = V.copy(); Vout[skin] = X
    disp = np.zeros_like(V); disp[skin] = X - V[skin]
    tree = cKDTree(V[skin])
    for cid in np.unique(d["components"]):
        if cid == 0: continue
        ids = np.where(d["components"] == cid)[0]
        _, nn = tree.query(V[ids], k=30)
        Vout[ids] = V[ids] + disp[skin][nn].mean(1).mean(0)
    meshio.write_ply(a.out, Vout, F)
    base_out = os.path.splitext(a.out)[0]
    fitj2 = dict(fitj); fitj2["photo_refine"] = stats
    json.dump(fitj2, open(base_out + ".fit.json", "w"), indent=1)
    json.dump({"rounds": stats, "mm_per_unit_assumed": float(1 / mm)}, open(base_out + ".refine.json", "w"), indent=1)
    np.save(base_out + ".consistency.npy", cons)


if __name__ == "__main__":
    main()
