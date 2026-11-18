"""Fit the CRANIUM (top and back of the head, hair volume) to the head silhouettes in the photos.

Why (eun01, 2026-10-15): the face is fitted to the 468 MediaPipe landmarks, but nothing measures the skull: the
template's cranium is only scaled with the face, so in the photo-compare view the model head was much smaller than the
real head (top and back), and the ears / hair texture landed on the wrong place.

Method (automatic, any person / camera):
  1. person silhouette per frame: MediaPipe selfie segmentation (bundled with the mediapipe package), cached in
     prep/person_masks
  2. only the part ABOVE the eye line is used (head top, back of the head above the ears): below it are the neck,
     shoulders and a hanging ponytail, which are not the head
  3. per frame: the model's outer contour points that belong to cranium vertices are moved along the contour normal
     onto the photo contour; per vertex the MEDIAN over all frames (robust to pose noise and segmentation errors)
  4. smooth solve on the skin mesh: bi-Laplacian on the displacement, face vertices (near the 468 landmarks and below
     the eye line) held fixed -> the face fit is untouched
usage: python cranium_fit.py <fit.ply> <fit.json> <sparse> <images> <poses.json> <out.ply> [--rounds 3] [--every 2]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa


def person_masks(images, names, cache):
    import cv2, threading, mediapipe as mp
    from concurrent.futures import ThreadPoolExecutor
    from parallel import workers
    os.makedirs(cache, exist_ok=True)
    tl = threading.local(); out = {}

    def one(n):
        p = os.path.join(cache, n + ".png")
        if os.path.exists(p):
            return cv2.imread(p, 0)
        if getattr(tl, "seg", None) is None:   # one segmenter per thread (MediaPipe graphs are not thread safe)
            tl.seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
        im = cv2.imread(os.path.join(images, n))
        m = (tl.seg.process(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)).segmentation_mask > 0.5).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8)); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        cv2.imwrite(p, m); return m

    # frames are independent: side by side (S15P31B204-702, the first call of a job walked them one by one)
    todo = [n for n in names if not os.path.exists(os.path.join(cache, n + ".png"))]
    with ThreadPoolExecutor(workers(len(todo)) if len(todo) > 1 else 1) as pool:
        for n, m in zip(names, pool.map(one, names)):
            out[n] = m
    # 2026-10-19: run_all --person-masks sam -> full-resolution boundary from SAM 2.1 on the head crop (sam_masks.py);
    # the selfie masks above are its prompts and its fallback
    if os.environ.get("LM_PERSON_MASKS", "selfie") == "sam":
        from sam_masks import refine
        prep = os.path.dirname(os.path.normpath(cache))
        return refine(images, names, out, cache.rstrip("/\\") + "_sam", class_cache=os.path.join(prep, "class_masks"))
    return out


def main():
    import cv2, pycolmap
    from scipy.sparse import vstack, csr_matrix
    from scipy.sparse.linalg import lsqr
    from scipy.spatial import cKDTree
    from frame_check import load_poses, intrinsics
    from template_fit import laplacian
    ap = argparse.ArgumentParser()
    ap.add_argument("fit"); ap.add_argument("fit_json"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("poses"); ap.add_argument("out")
    ap.add_argument("--rounds", type=int, default=3); ap.add_argument("--every", type=int, default=3)
    ap.add_argument("--max-push", type=float, default=0.45, help="largest move, x eye-corner distance")
    a = ap.parse_args()
    t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")); F = t["triangles"].astype(np.int64); mat = t["materials"]
    V = np.asarray(meshio.read_any(a.fit)["vertices"], np.float64); V0 = V.copy()
    lid = np.array(json.load(open(a.fit_json))["landmark_vertex_ids"]); L = V[lid]
    iod = np.linalg.norm(L[33] - L[263]); c = (L[234] + L[454]) / 2
    x = (L[454] - L[234]); x /= np.linalg.norm(x); up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up); fw *= np.sign((L[1] - c) @ fw)
    skin = mat == 0; sk = np.where(skin)[0]; rmap = -np.ones(len(V), int); rmap[sk] = np.arange(len(sk))
    Fs = F[skin[F].all(1)]; Fl = rmap[Fs]
    h_eye = (((L[33] + L[263]) / 2) - c) @ up
    hv = (V - c) @ up
    dface, _ = cKDTree(L).query(V)
    cran = skin & (hv > h_eye) & (dface > 0.12 * iod)                        # top / back of the head, not the face
    anchor = skin & ((hv < h_eye - 0.15 * iod) | (dface < 0.06 * iod))       # face and below: fixed
    rec = pycolmap.Reconstruction(a.sparse); P = load_poses(a.poses)
    names = sorted(n for n in P)[::max(1, a.every)]
    masks = person_masks(a.images, names, os.path.join(os.path.dirname(a.images.rstrip("/\\")), "person_masks"))
    cam = list(rec.cameras.values())[0]; f, cx, cy = intrinsics(cam)
    Lap = laplacian(len(sk), Fl); Bi = (Lap @ Lap).tocsr()
    X = V[sk].copy(); X0 = X.copy()
    rep = {"frames": len(names), "cranium_vertices": int(cran.sum())}
    for rd in range(a.rounds):
        Vc = V0.copy(); Vc[sk] = X
        fn = np.cross(Vc[F[:, 1]] - Vc[F[:, 0]], Vc[F[:, 2]] - Vc[F[:, 0]]); vn = np.zeros_like(Vc)
        for k in range(3): np.add.at(vn, F[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        if ((Vc[sk] - Vc[sk].mean(0)) * vn[sk]).sum(1).mean() < 0: vn = -vn
        acc = {}
        for n in names:
            m = masks.get(n)
            if m is None: continue
            R, tt = P[n]; H, W = m.shape
            Q = Vc @ R.T + tt; uv = np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]; z = Q[:, 2]
            # projected head axes: keep only the image part above the eye line
            e2 = np.array([f * ((((L[33] + L[263]) / 2) @ R.T + tt)[i] / (((L[33] + L[263]) / 2) @ R.T + tt)[2]) for i in (0, 1)]) + [cx, cy]
            u2 = (c + up * iod) @ R.T + tt; u2 = np.array([f * u2[0] / u2[2] + cx, f * u2[1] / u2[2] + cy]) - (np.array([f * (c @ R.T + tt)[0] / (c @ R.T + tt)[2] + cx, f * (c @ R.T + tt)[1] / (c @ R.T + tt)[2] + cy]))
            u2 /= np.linalg.norm(u2) + 1e-9
            mm = np.zeros((H, W), np.uint8)
            Fv = F[(skin[F].all(1)) & (z[F] > 0).all(1)]
            cv2.fillPoly(mm, list(np.round(uv[Fv]).astype(np.int32)), 255)
            cm, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            cp, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not cm or not cp: continue
            qm = max(cm, key=cv2.contourArea)[:, 0, :].astype(float); qp = np.vstack([q[:, 0, :] for q in cp]).astype(float)
            above = lambda q: ((q - e2) @ u2) > 0.05 * iod * f / np.median(z[lid])
            qm = qm[above(qm)]; qp = qp[above(qp)]
            if len(qm) < 20 or len(qp) < 20: continue
            # contour normals of the model outline (outward = away from the projected head centre)
            tg = np.gradient(qm, axis=0); tg /= np.linalg.norm(tg, axis=1, keepdims=True) + 1e-9
            nr = np.c_[tg[:, 1], -tg[:, 0]]; cen = uv[sk].mean(0); nr *= np.sign(((qm - cen) * nr).sum(1))[:, None]
            # cranium vertices on the silhouette in this view
            cc_ = -R.T @ tt; vd = cc_ - Vc; vd /= np.linalg.norm(vd, axis=1, keepdims=True)
            graz = np.where(cran & (np.abs((vn * vd).sum(1)) < 0.3))[0]
            if not len(graz): continue
            gtree = cKDTree(uv[graz]); ptree = cKDTree(qp); pxiod = iod * f / np.median(z[lid])
            for q, nq in zip(qm, nr):
                dg, j = gtree.query(q)
                if dg > 0.05 * pxiod: continue
                dp, k = ptree.query(q)
                if dp > a.max_push * pxiod: continue
                s = (qp[k] - q) @ nq
                vi = int(graz[j]); uvn = uv[vi] + s * nq
                ray = np.array([(uvn[0] - cx) / f, (uvn[1] - cy) / f, 1.0]) * z[vi]
                acc.setdefault(vi, []).append((ray - tt) @ R - Vc[vi])
        if not acc: break
        ids = np.array(list(acc)); D = np.array([np.median(np.array(acc[i]), 0) for i in ids])
        cnt = np.array([len(acc[i]) for i in ids]); keep = cnt >= 3                     # seen as silhouette in >= 3 views
        ids, D = ids[keep], D[keep]
        nrm = np.linalg.norm(D, axis=1); D *= np.minimum(1, a.max_push * iod / (nrm + 1e-12))[:, None]
        T = Vc[ids] + D
        an = np.where(anchor)[0]
        rows = [80.0 * Bi, csr_matrix((np.full(len(an), 10.0), (np.arange(len(an)), rmap[an])), shape=(len(an), len(sk))),
                csr_matrix((np.ones(len(ids)), (np.arange(len(ids)), rmap[ids])), shape=(len(ids), len(sk)))]
        rhs = [80.0 * (Bi @ X0), 10.0 * X0[rmap[an]], T]
        A = vstack(rows).tocsr(); B = np.vstack(rhs)
        X = np.stack([lsqr(A, B[:, k], atol=1e-10, btol=1e-10, iter_lim=3000, x0=X[:, k])[0] for k in range(3)], 1)
        rep[f"round{rd}"] = {"silhouette_vertices": int(len(ids)), "median_push_iod": round(float(np.median(nrm) / iod), 4) if len(nrm) else 0}
    V[sk] = X
    # non-skin parts near the cranium (none of eyes / teeth) are unaffected; write
    fit = meshio.read_any(a.fit)
    meshio.write_ply(a.out, V, np.asarray(fit["faces"]), fit.get("colors"))
    disp = np.linalg.norm(V - V0, axis=1) / iod
    rep["moved_max_iod"] = round(float(disp.max()), 3); rep["face_moved_max_iod"] = round(float(disp[anchor].max()), 4)
    print(json.dumps(rep))


if __name__ == "__main__":
    main()
