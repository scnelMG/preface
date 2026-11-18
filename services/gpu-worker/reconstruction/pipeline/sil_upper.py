"""Photo silhouette as an UPPER BOUND on the final face shape (2026-10-24, W16 step 2, OPTION scan_to_model --sil-upper).

No part of the face may project OUTSIDE the person silhouette of any photo. This holds whatever forms the outline on that
image row (nose, or the far eye / cheek hiding the nose - 만두 10/24), so it needs no guess of which part is seen there and
no margin. It is the one direction of the silhouette that is always true; pulling the model OUT to the outline is not
(the gyu01 profile fit pulled the nose forward to an outline made by the far eye / cheek, 10/24).

Why here: the gnm residual (template_fit) adds MediaPipe landmark positions with no silhouette check, and the midline
landmarks lie in front of the real profile (gyu01 hand-traced: the d2 upper nose 0.11 x eye width in front of the skin,
~0.08 in front of the photo outline).

Method (any person): rounds of
  1. per posed frame (hold-out excluded): model OUTLINE vertices (exterior face skin, grazing, on the rendered outline)
     that project outside the person mask (multiclass segmentation, all person classes) -> image distance to the mask
  2. per vertex the largest violation over the frames -> 3D push inward along its image normal at its depth
  3. smooth displacement field (Laplacian, the pushed vertices as soft targets) applied to the mesh
Face regions only (nose / lips / brows / glabella / forehead / orbits / cheeks / chin / jaw); vertices projecting near the
image border are skipped (close-up frames: the frame ends there, not the head).

usage: python sil_upper.py <fit.ply> <fit.json> <out.ply> --work W --sparse S --poses P [--exclude H]  -> JSON stats
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa

FACE = ["nose_region", "upper_lip_region", "lower_lip_region", "middle_brow_region", "left_brow_region", "right_brow_region",
        "forehead_region", "left_orbital_region", "right_orbital_region", "left_infraorbital_region", "right_infraorbital_region",
        "left_zygomatic_region", "right_zygomatic_region", "left_cheek_region", "right_cheek_region", "chin_region"]


def main():
    import cv2
    from scipy.sparse import coo_matrix, diags, identity
    from scipy.sparse.linalg import spsolve
    from gnm_model import GNM
    from frame_check import load_poses, intrinsics
    from outline_obs import class_masks
    import pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("fit"); ap.add_argument("fit_json"); ap.add_argument("out")
    ap.add_argument("--work", required=True); ap.add_argument("--sparse", required=True); ap.add_argument("--poses", required=True)
    ap.add_argument("--exclude"); ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--max-step", type=float, default=0.04, help="largest push per round, x eye distance")
    ap.add_argument("--w-smooth", type=float, default=20.0, help="smoothness of the push field (higher = wider, gentler)")
    ap.add_argument("--border", type=float, default=0.02, help="skip vertices within this fraction of the image size of its border")
    ap.add_argument("--agg", default="q75", choices=["max", "q75", "median"], help="per vertex over the frames where it is on the outline")
    ap.add_argument("--bad-frame", type=float, default=0.05, help="skip frames with more than this share of the face more than 5 %% IOD outside the silhouette (wrong pose / mask)")
    ap.add_argument("--max-viol", type=float, default=0.15, help="ignore violations above this x eye distance (mask failures)")
    ap.add_argument("--tol", type=float, default=0.004, help="stop when the largest violation is below this x eye distance")
    a = ap.parse_args()
    mf = meshio.read_any(a.fit); V = np.asarray(mf["vertices"], np.float64).copy()
    g = GNM(); F = g.tri; n = len(V)
    if n != g.V:
        print(json.dumps({"status": "skipped", "reason": "not GNM topology"})); return
    lid = np.array(json.load(open(a.fit_json))["landmark_vertex_ids"]); iod = float(np.linalg.norm(V[lid[33]] - V[lid[263]]))
    ext = g.group("skin_exterior")
    face = ext & np.any([g.group(r) for r in FACE if r in g.group_names], axis=0)
    ext_tri = F[ext[F].all(1)]
    P = load_poses(a.poses); excl = set(open(a.exclude).read().split()) if a.exclude else set()
    names = sorted(nm for nm in P if nm not in excl)[::max(1, a.every)]
    images = os.path.join(a.work, "prep", "images")
    CM = class_masks(images, names, os.path.join(a.work, "prep", "class_masks"))
    rec = pycolmap.Reconstruction(a.sparse); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    frames = []
    for nm in names:
        cm = CM.get(nm)
        if cm is None: continue
        pm = (cm > 0).astype(np.uint8)
        # distance to the person mask + the NEAREST mask pixel (push direction = toward it, not along the vertex
        # normal: first try along the normal drifted in rounds 3-6 on gyu01, 2.8 -> 9.7 % IOD)
        dout, lab = cv2.distanceTransformWithLabels(1 - pm, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        zz = np.zeros((lab.max() + 1, 2), np.float32)
        ys, xs = np.nonzero(pm); lab_in = lab[ys, xs]; zz[lab_in] = np.c_[xs, ys]
        R, t = map(np.asarray, P[nm]); frames.append((nm, R, t.astype(np.float64), dout, lab, zz))
    # frames whose camera pose (or mask) is wrong as a whole: a share of the face lies FAR outside the silhouette (more than
    # 5 % IOD). seo01 frames 296-428: 12-65 % of the face vertices, woo03 922-1007: 7-23 %; frames where the model only
    # protrudes (woo02 / chae01 profiles, 10-23 % of the face outside but by 1-2 % IOD): 0-0.3 % (10/24). Without this
    # seo01 / woo03 did not converge (15-17 % IOD left) and the face was pushed in. Judged once on the input shape.
    good, bad_frames = [], []
    for fr_ in frames:
        nm, R, t, dout = fr_[0], fr_[1], fr_[2], fr_[3]
        Q = V[face] @ R.T + t
        if (Q[:, 2] <= 0).any(): continue
        uv = np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy]; H, W_ = dout.shape
        ok = (uv[:, 0] > a.border * W_) & (uv[:, 0] < (1 - a.border) * W_) & (uv[:, 1] > a.border * H) & (uv[:, 1] < (1 - a.border) * H)
        if ok.sum() < 50: continue
        iod_px0 = f * iod / float(np.median(Q[:, 2]))
        outside = float((dout[np.round(uv[ok, 1]).astype(int), np.round(uv[ok, 0]).astype(int)] > 0.05 * iod_px0).mean())
        (bad_frames if outside > a.bad_frame else good).append(fr_ if outside <= a.bad_frame else (nm, round(outside * 100, 1)))
    frames = good
    # smoothing operator on the whole mesh (neighbour average)
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n)).tocsr(); Adj.data[:] = 1.0
    deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1); Lap = identity(n) - diags(1.0 / deg) @ Adj
    LtL = (Lap.T @ Lap).tocsr()
    stats = []
    for rd in range(a.rounds):
        fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); vn = np.zeros_like(V)
        for k in range(3): np.add.at(vn, F[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        if ((V[ext] - V[ext].mean(0)) * vn[ext]).sum(1).mean() < 0: vn = -vn
        acc = {}; nviol_f = 0          # vertex -> [(push vector or zeros when inside), ...] over the frames it is on the outline
        for nm, R, t, dout, lab, zz in frames:
            Q = V @ R.T + t; z = Q[:, 2]
            if (z[face] <= 0).any(): continue
            uv = np.c_[f * Q[:, 0] / z + cx, f * Q[:, 1] / z + cy]; H, W_ = dout.shape
            mm = np.zeros((H, W_), np.uint8); cv2.fillPoly(mm, list(np.round(uv[ext_tri]).astype(np.int32)), 1)
            cs, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            if not cs: continue
            from scipy.spatial import cKDTree
            qm = np.vstack([c[:, 0, :] for c in cs]).astype(np.float64)
            nc = vn @ R.T; view = -Q / np.linalg.norm(Q, axis=1, keepdims=True)
            bx, by = a.border * W_, a.border * H
            cand = np.where(face & (np.abs((nc * view).sum(1)) < 0.35) & (uv[:, 0] > bx) & (uv[:, 0] < W_ - 1 - bx)
                            & (uv[:, 1] > by) & (uv[:, 1] < H - 1 - by))[0]
            if len(cand) < 5: continue
            iod_px = f * iod / float(np.median(z[face]))
            d_c, _ = cKDTree(qm).query(uv[cand]); on = cand[d_c < 0.02 * iod_px]      # on the model outline
            if not len(on): continue
            yy, xx = np.round(uv[on, 1]).astype(int), np.round(uv[on, 0]).astype(int)
            dv = dout[yy, xx]
            # a violation larger than --max-viol is a mask failure (missed skin, cut-off frame), not model error
            good = dv < a.max_viol * iod_px; on, yy, xx, dv = on[good], yy[good], xx[good], dv[good]
            bad = dv > 1.0
            if bad.any(): nviol_f += 1
            d_img = np.where(bad[:, None], zz[lab[yy, xx]] - uv[on], 0.0)                 # px, to the nearest mask pixel
            dw = np.c_[d_img * (z[on] / f)[:, None], np.zeros(len(on))] @ R              # camera -> world direction
            for v_, d_ in zip(on, dw): acc.setdefault(int(v_), []).append(d_)
        # per vertex: --agg over the frames where it is on the outline (inside = 0). max = strict bound (any frame);
        # the left / right profiles of gyu01 disagree by ~0.08 x eye width at the nose (camera poses): max pushed the
        # nose behind the real skin on one side (hand dots 00340: -0.08), 10/24
        push = np.zeros((n, 3)); mag = np.zeros(n)
        for v_, L_ in acc.items():
            L_ = np.array(L_); m_ = np.linalg.norm(L_, axis=1)
            q = m_.max() if a.agg == "max" else float(np.quantile(m_, {"median": 0.5, "q75": 0.75}[a.agg]))
            if q <= 0: continue
            dirn = L_[m_ > 0].mean(0); dirn /= np.linalg.norm(dirn) + 1e-12
            push[v_] = dirn * q; mag[v_] = q
        sel = np.where(mag > 0)[0]
        st = {"round": rd, "frames_violating": nviol_f, "vertices": int(len(sel)),
              "max_pct_iod": round(float(mag.max() / iod * 100), 2) if len(sel) else 0.0,
              "p95_pct_iod": round(float(np.quantile(mag[sel], 0.95) / iod * 100), 2) if len(sel) else 0.0}
        stats.append(st)
        if rd and st["max_pct_iod"] > stats[-2]["max_pct_iod"] and st["vertices"] > stats[-2]["vertices"]:
            V = V_prev; st["reverted"] = True; break                      # got worse: keep the previous round
        if not len(sel) or mag.max() < a.tol * iod: break
        V_prev = V.copy()
        cap = a.max_step * iod
        tgt = push[sel] * np.minimum(1.0, cap / np.maximum(mag[sel], 1e-12))[:, None]
        Wd = np.zeros(n); Wd[sel] = 1.0
        Amat = (a.w_smooth * LtL + diags(Wd + 1e-3)).tocsc()
        D = np.zeros((n, 3))
        for k in range(3):
            b = np.zeros(n); b[sel] = tgt[:, k]; D[:, k] = spsolve(Amat, b)
        V += D                       # eyeballs are separate components (no constraint) -> ~0 there
    meshio.write_ply(a.out, V, np.asarray(mf["faces"]), colors=mf.get("colors"))
    print(json.dumps({"status": "ok", "frames": len(frames), "bad_frames": bad_frames, "rounds": stats}))


if __name__ == "__main__":
    main()
