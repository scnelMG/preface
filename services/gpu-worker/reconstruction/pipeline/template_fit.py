"""Fit the fixed-topology GNM head template (Apache-2.0, 17,821 vertices with UVs) to a person's capture.

Industry pattern "scan -> wrap a clean template -> bake texture" (user request 10/14):
  * measured where we have data: 468 multi-view triangulated face landmarks (mv_landmarks.py) and, if available, the
    dense COLMAP points / mesh
  * template elsewhere: forehead, hairline, ears, back of the head keep the template shape (smoothly attached)
  * one topology for every person -> editing rigs, expressions (blendshapes) and texture work the same way

steps
  1. MediaPipe<->template correspondence (once, cached in assets/gnm_mp468.json): render the template front view, detect
     the 468 landmarks, back-project through the depth buffer to the nearest skin vertex
  2. similarity alignment template -> person (Umeyama on the 468 pairs, robust re-weighting)
  3. Laplacian (as-smooth-as-possible) deformation of the skin: landmark targets + nearest dense points (ICP, 4 rounds)
     with the template's own shape as the regulariser; eyes/teeth/lashes move with the nearest skin
  4. vertex colours from the capture frames (cosine-weighted best views) - UV texture baking is the next step
usage: python template_fit.py --landmarks <mv.ply> [--dense <points or mesh .ply>] --sparse <model> --images <dir>
                              --out <out.ply> [--w-data 1.0]
writes <out.ply> (template topology, COLMAP frame) and <out>.fit.json (residuals, landmark vertex ids)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import meshio  # noqa: E402

TEMPLATE = os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")
CORR = os.path.join(HERE, "..", "assets", "gnm_mp468.json")


def load_template():
    d = np.load(TEMPLATE)
    return d["vertices"].astype(np.float64), d["triangles"].astype(np.int64), d["materials"], d["components"], d


def correspondence(v, f, mat):
    if os.path.exists(CORR):
        return np.array(json.load(open(CORR))["vertex"])
    import render
    sys.path.insert(0, HERE)
    import auto_orient
    skin = mat == 0
    fs = f[skin[f].all(1)]
    size = 900
    c = np.array([0.0, 0.25, 0.1]); ext = 0.13
    img, zb, _ = render.render(v, fs, np.eye(3), size, center=c, extent=ext, light=(0.2, 0.3, 1.0), return_depth=True)
    det = auto_orient.Detector(os.path.join(HERE, "..", "assets", "face_landmarker.task"))
    lm, _ = det(img)
    if lm is None:
        raise SystemExit("MediaPipe found no face on the template render")
    s = size / (2 * ext)
    idx = np.where(skin)[0]
    out = []
    for k in range(468):
        px, py = lm[k] * size
        x = c[0] + (px - size / 2) / s; y = c[1] + (size / 2 - py) / s
        z = c[2] + zb[int(np.clip(py, 0, size - 1)), int(np.clip(px, 0, size - 1))]
        p = np.array([x, y, z])
        out.append(int(idx[np.argmin(np.linalg.norm(v[idx] - p, axis=1))]))
    json.dump({"template": "gnm-template-v2.npz", "method": "MediaPipe on a front render, depth back-projection, nearest skin vertex",
               "vertex": out}, open(CORR, "w"))
    return np.array(out)


def umeyama(A, B, w=None):
    w = np.ones(len(A)) if w is None else w
    w = w / w.sum()
    ca, cb = (A * w[:, None]).sum(0), (B * w[:, None]).sum(0)
    A0, B0 = A - ca, B - cb
    S = (B0 * w[:, None]).T @ A0
    U, Sg, Vt = np.linalg.svd(S)
    d = np.sign(np.linalg.det(U @ Vt)); Dm = np.diag([1, 1, d])
    R = U @ Dm @ Vt
    s = np.trace(np.diag(Sg) @ Dm) / (w * (A0 ** 2).sum(1)).sum()
    return s, R, cb - s * R @ ca


EYE_LM = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7,
          263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def frontal_contours(sparse, poses_json, images, max_yaw, exclude=()):
    """[(R, t, f, cx, cy, uv of the 36 outline landmarks)] for frames whose MediaPipe head yaw is within +-max_yaw."""
    import cv2, pycolmap
    sys.path.insert(0, HERE)
    from frame_check import load_poses, intrinsics
    import face_lm
    rec = pycolmap.Reconstruction(sparse); poses = load_poses(poses_json)
    out = []
    for im in sorted(rec.images.values(), key=lambda i: i.name):
        if (poses is not None and im.name not in poses) or im.name in exclude: continue
        img = cv2.imread(os.path.join(images, im.name))
        if img is None: continue
        L, M4 = face_lm.landmarks(images, im.name, img)
        if L is None: continue
        M = np.array(M4)[:3, :3]
        if abs(np.degrees(np.arctan2(M[0, 2], M[2, 2]))) > max_yaw: continue
        H, W = img.shape[:2]
        uv = (np.array(L)[:, :2] * [W, H])[OVAL]
        cam = rec.cameras[im.camera_id]
        R, t = poses[im.name] if poses else (im.cam_from_world().rotation.matrix(), np.asarray(im.cam_from_world().translation))
        out.append((np.asarray(R), np.asarray(t, float), *intrinsics(cam), uv))
    return out


def laplacian(n, f):
    from scipy.sparse import coo_matrix, diags
    i = np.concatenate([f[:, 0], f[:, 1], f[:, 2], f[:, 1], f[:, 2], f[:, 0]])
    j = np.concatenate([f[:, 1], f[:, 2], f[:, 0], f[:, 0], f[:, 1], f[:, 2]])
    A = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    deg[deg == 0] = 1
    return diags(np.ones(n)) - diags(1 / deg) @ A


def head_axes(L):
    """rows: right, up, forward of the face from the landmarks"""
    x = L[454] - L[234]; x /= np.linalg.norm(x)
    up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
    fw = np.cross(x, up)
    if (L[1] - (L[234] + L[454]) / 2) @ fw < 0: fw = -fw
    return np.stack([x, up, fw])


def view_axes(L, poses_json, Bax, max_deg=20.0):
    """G15 OPTION --depth-axis view (2026-10-24): head axes turned so the third row is the mean direction from the face to
    the cameras of the near-frontal frames (within max_deg of head-forward). Depth along THAT line is what the frontal
    photos cannot see; dropping it keeps the photo position of a landmark even when its depth is off. With the head-
    forward axis a lid vertex that sat 0.08-0.15 x eye width in front of its target showed +0.01-0.03 too high in
    selfies taken from below (chae01 -12.5 deg). Returns (axes, frames used, angle to head-forward deg)."""
    from frame_check import load_poses
    poses = load_poses(poses_json) or {}
    c0 = L[[33, 263, 1]].mean(0); dirs = []
    for R_, t_ in poses.values():
        d = -R_.T @ t_ - c0; d /= np.linalg.norm(d) + 1e-12
        if np.degrees(np.arccos(np.clip(d @ Bax[2], -1, 1))) <= max_deg: dirs.append(d)
    if len(dirs) < 5: return Bax, len(dirs), 0.0
    z = np.mean(dirs, 0); z /= np.linalg.norm(z)
    x = Bax[0] - (Bax[0] @ z) * z; x /= np.linalg.norm(x)
    return np.stack([x, np.cross(z, x), z]), len(dirs), float(np.degrees(np.arccos(np.clip(z @ Bax[2], -1, 1))))


def main():
    from scipy.sparse import vstack, diags, csr_matrix
    from scipy.sparse.linalg import lsqr
    from scipy.spatial import cKDTree
    ap = argparse.ArgumentParser()
    ap.add_argument("--landmarks", required=True); ap.add_argument("--dense")
    ap.add_argument("--sparse"); ap.add_argument("--images"); ap.add_argument("--out", required=True)
    ap.add_argument("--w-data", type=float, default=1.0); ap.add_argument("--w-lm", type=float, default=1.0)
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--w-smooth", type=float, default=4.0)
    ap.add_argument("--contour-images", help="frames dir: face-outline landmarks are fitted to their 2D position in the NEAR-FRONTAL "
                    "frames instead of their 3D triangulation (outline points are silhouettes, not fixed skin points; their "
                    "triangulation drifts sideways with uneven left/right coverage). needs --sparse (+ --poses)")
    ap.add_argument("--poses", help="frame_check.py JSON (checked camera poses)")
    ap.add_argument("--w-contour", type=float, default=2.0)
    ap.add_argument("--w-eye", type=float, default=6.0, help="weight of the 32 eyelid landmarks (0 = like the others)")
    ap.add_argument("--eyelid-offset", help="eyelid_offset.py JSON: raise the upper-lid targets to the lash line")
    ap.add_argument("--eyelid-cols", action="store_true", help="OPTION (2026-10-21): use the per-column lash-edge offsets (offset_cols) of "
                    "the eyelid_offset JSON instead of one offset x taper per eye")
    ap.add_argument("--eye-depth-w", type=float, default=None, help="OPTION (2026-10-21, sunken lids): weight of the 32 eyelid landmarks "
                    "(and the lid-margin ring rows) in the head FORWARD direction only, like --anchor-depth-w for nose / lips. The lid "
                    "landmarks are triangulated on the eye-opening edge (= eyeball surface), so full depth weight pulls the lid skin onto "
                    "the ball (chae01: band 0.08-0.16 at 0.647 -> 0.553 x eye width); try 0.2")
    ap.add_argument("--lid-prior", type=float, default=None, help="OPTION (2026-10-21, sunken lids, option A): the FORWARD targets of "
                    "the 32 eyelid landmarks, the orbital-region landmarks (MediaPipe rings around the eye, e.g. 27-30 / 257-260 on the "
                    "upper lid) and the lid-margin ring rows are the BASE shape's depth (GNM prior) instead of their triangulation, with "
                    "this weight factor (1 = same row weight; left-right / up-down stay measured). Their triangulated depth sits "
                    "0.06-0.11 x eye width behind the statistical shape (chae01 / woo01 / gyu01), which flattened the upper lid onto the "
                    "eyeball; --eye-depth-w 0 alone left the ring-2 points pulling it back")
    ap.add_argument("--corr-fix", default="", help="OPTION (2026-10-22): JSON {vertex: {landmark: template vertex}} overriding the "
                    "468 -> template correspondence (assets/gnm_mp468_fix.json: 3 lid-ring landmarks that sit on socket-interior vertices "
                    "behind the eyeball - 161 R, 385 / 374 L - re-attached to the mirror of the other eye's lid-margin vertex)")
    ap.add_argument("--contour-max-yaw", type=float, default=10.0)
    ap.add_argument("--depth-axis", default="head", choices=["head", "view"], help="G15 OPTION (2026-10-24, default head = unchanged): "
                    "the 'depth' that --anchor-depth-w / --eye-depth-w / --lid-prior weaken is the head-forward axis (head) or the mean "
                    "viewing direction of the near-frontal cameras (view, needs --poses): then a landmark keeps its PHOTO position "
                    "even when its depth is wrong (lids +0.01-0.03 too high in selfies from below with --eye-depth-w 0)")
    ap.add_argument("--exclude", help="frame names to leave out (hold-out validation)")
    ap.add_argument("--profile-sil", action="store_true", help="side views (20-75 deg): fit the face's front profile edge "
                    "(forehead, far-side brow/eye/cheekbone line, nose, lips, chin) to the photo silhouette (GrabCut). needs --sparse --poses --contour-images")
    ap.add_argument("--w-sil", type=float, default=0.2)
    ap.add_argument("--profile90", type=float, default=0.0, help="OPTION (2026-10-24, pipeline/profile90.py): weight of the 80-100 deg "
                    "PROFILE as a two-sided depth observation of the face midline, CONVEX segments only (forehead, nasal bridge, tip, "
                    "lips, chin; the person mask fills the concave nasion / philtrum). Needs --sparse --poses --profile90-images. 0 = off")
    ap.add_argument("--profile90-images", help="--profile90: frames dir (person masks are read from ../person_masks)")
    ap.add_argument("--profile90-segs", default="forehead,bridge,tip,lips,chin", help="--profile90: midline segments that get the term")
    ap.add_argument("--profile90-rounds", type=int, default=4, help="--profile90: solve rounds (targets re-measured each round); "
                    "each round re-solves the whole residual system")
    ap.add_argument("--profile90-yaw", default="80,100", help="--profile90: head yaw range of the frames, deg")
    ap.add_argument("--profile-obs", help="cached side-view silhouettes from profile_sil.py --save (instead of segmenting here)")
    ap.add_argument("--dense-feature-radius", type=float, default=0.0,
                    help="hybrid: dense points shape only the face OUTLINE / cheeks / forehead; skin within this radius "
                         "(x eye distance) of the inner landmarks (eyes, nose, mouth) follows the landmarks only")
    ap.add_argument("--base-mesh", help="start shape in template topology (e.g. the GNM statistical fit, gnm_fit.py) "
                    "instead of the mean template: the smoothness term then keeps THAT shape where no data is")
    ap.add_argument("--w-oval", type=float, default=None,
                    help="multiply the face-oval landmark weights (e.g. 0.05 when the base shape already follows the measured "
                         "outlines, gnm_fit.py --sil: MediaPipe's oval points slide with the view and pulled the jaw back in)")
    ap.add_argument("--w-surface", type=float, default=None,
                    help="multiply the SURFACE landmark weights (cheek / jaw / temple skin points, gnm_features.py) - they "
                         "slide with the view; use with a silhouette-fitted base")
    ap.add_argument("--anchor-depth-w", type=float, default=None,
                    help="weight of the nose / lip landmarks in the FORWARD direction (depth); e.g. 0.15 with a silhouette-"
                         "fitted base, whose profile came from the side-view outlines")
    ap.add_argument("--anchor-depth-regions", default="nose_region,upper_lip_region,lower_lip_region", help="OPTION (2026-10-23): landmark regions (assets/gnm/gnm_features.json) whose depth gets --anchor-depth-w. MediaPipe's triangulated midline points (glabella / nasion / nose) lie 0.05-0.20 x eye width IN FRONT of the 90 deg photo profile (impossible for skin, 5/6 originals); add middle_brow_region so the glabella stops pulling the nasion forward; \"all\" = every landmark (front-plane only residual)")
    ap.add_argument("--keep-base", type=float, default=0.0,
                    help="weight that holds the BASE shape away from the anchor landmarks (eyes / brows / nose / lips): "
                         "the silhouette-fitted jaw, cheeks and ears stay, the residual only refines the features")
    ap.add_argument("--dense-region", default="all", choices=["all", "nose"],
                    help="nose: dense (multi-view stereo) points shape ONLY the nose (wings, nostril rims, columella), "
                         "where the 468 landmarks are sparse and the template nose was pasted with the photo nose "
                         "(woo01 2026-10-16); the rest of the face follows the landmarks")
    a = ap.parse_args()
    V0, F, mat, comp, raw = load_template()
    corr = correspondence(V0, F, mat)
    if a.corr_fix:
        # lid-ring landmarks on socket-interior vertices: the strong lid weight pulled that inner skin onto the photo lid line and
        # it bunched into a lobe (the pocket at the outer corner of one eye, 2026-10-22)
        cf = json.load(open(a.corr_fix))["vertex"]; corr = np.array(corr).copy()
        for k_, v_ in cf.items(): corr[int(k_)] = int(v_)
    if a.base_mesh:
        # bring the base shape into the TEMPLATE frame (similarity on all vertices): the template axes (+z = face
        # forward, +y = up) drive the eyelid ring / eyeball / eye-opening logic below; a base left in the COLMAP frame
        # made "forward" wrong -> eyeballs bulged through closed lids (P0 2026-10-16)
        Vb = np.asarray(meshio.read_any(a.base_mesh)["vertices"], np.float64)
        sb, Rb, tb = umeyama(Vb, V0)
        V0 = (sb * (Rb @ Vb.T)).T + tb
    L468 = np.asarray(meshio.read_any(a.landmarks)["vertices"][:468], np.float64)
    if a.eyelid_offset:
        # upper lid: MediaPipe sits on the inner edge of the opening; move to the measured lash line (per eye)
        from eyelid_offset import EYE as _EYE
        eo = json.load(open(a.eyelid_offset)); L468 = L468.copy()
        for S, e in _EYE.items():
            ew = np.linalg.norm(L468[e["c"][0]] - L468[e["c"][1]]); off = eo["offset"].get(S, 0.0)
            oc = (eo.get("offset_cols") or {}).get(S) if a.eyelid_cols else None
            for j, (u, l) in enumerate(zip(e["up"], e["lo"])):
                d = L468[u] - L468[l]; d /= np.linalg.norm(d) + 1e-12
                oj = off * eo["taper"][j]
                if oc is not None and j < len(oc) and oc[j] is not None: oj = float(oc[j])
                L468[u] = L468[u] + d * oj * ew
    # 2. similarity (robust: down-weight landmarks that disagree most, e.g. the face outline)
    corr = corr.copy()
    skin_ids = np.where(mat == 0)[0]; sktree = cKDTree(V0[skin_ids])
    report_fixed = []
    for it in range(4):
        w = np.ones(468) if it == 0 else w
        s, R, t = umeyama(V0[corr], L468, w)
        if a.base_mesh:
            # the base shape is already placed on the landmarks (gnm_fit.py: similarity fitted with its own weights,
            # outline from the silhouettes): keep ITS placement. Re-fitting the similarity to all 468 points shrank the
            # head ~2 % and undid the measured jaw / cheek outline (woo01 P1 2026-10-16)
            s, R, t = 1.0 / sb, Rb.T, -(Rb.T @ tb) / sb
        r = np.linalg.norm((s * (R @ V0[corr].T)).T + t - L468, axis=1)
        if it == 1 and not a.base_mesh:
            # broken correspondences (e.g. landmark 288 cached on a neck vertex): re-attach to the template skin vertex
            # where the measured landmark falls after the similarity
            bad = np.where(r > 15 * np.median(r))[0]  # only clearly broken ones; outline bias is handled by --contour-images
            for k in bad:
                corr[k] = skin_ids[sktree.query((R.T @ (L468[k] - t)) / s)[1]]; report_fixed.append(int(k))
        w = 1.0 / (1.0 + (r / (np.median(r) + 1e-12)) ** 2)
    V = (s * (R @ V0.T)).T + t
    skin = mat == 0
    sk = np.where(skin)[0]
    rmap = -np.ones(len(V), int); rmap[sk] = np.arange(len(sk))
    Fs = F[skin[F].all(1)]
    Fl = rmap[Fs]
    n = len(sk)
    Lap = laplacian(n, Fl)
    Bi = (Lap @ Lap).tocsr()   # bi-Laplacian on the DISPLACEMENT: smooth, wrinkle-free deformation (C1-like)
    X0 = V[sk]
    delta = Bi @ X0            # Bi (X - X0) = 0  <=>  Bi X = Bi X0  (keep the template's local shape)
    # landmark reliability from the multi-view triangulation (reprojection error), contour points weigh less
    rel = np.ones(468)
    mvinfo = os.path.splitext(a.landmarks)[0] + ".mvinfo.json"
    if os.path.exists(mvinfo):
        e = np.array([x.get("reproj_px_median", 20.0) for x in json.load(open(mvinfo))["landmarks"]])
        rel = 1.0 / (1.0 + (e / 3.0) ** 2)
    lm_local = rmap[corr]
    dense = None
    if a.dense:
        dm = meshio.read_any(a.dense)
        dense = np.asarray(dm["vertices"], np.float64)
        dtree = cKDTree(dense)
    X = X0.copy()
    scale = np.median(np.linalg.norm(L468 - L468.mean(0), axis=1))
    contour_obs = []
    if a.contour_images and a.sparse:
        contour_obs = frontal_contours(a.sparse, a.poses, a.contour_images, a.contour_max_yaw,
                                       set(open(a.exclude).read().split()) if a.exclude else set())
    oval = np.zeros(468, bool); oval[OVAL] = True
    sil_obs = []
    if a.profile_obs:
        from profile_sil import load_obs, sil_targets
        sil_obs = load_obs(a.profile_obs)
    elif a.profile_sil and a.sparse and a.poses and a.contour_images:
        from profile_sil import profile_obs, sil_targets
        sil_obs = profile_obs(a.sparse, a.poses, a.contour_images, V, F, corr,
                              set(open(a.exclude).read().split()) if a.exclude else set())
    # eyelid MARGIN (the skin ring lying on the eyeball): moved like its nearest lid landmarks, so the lid edge follows
    # the measured eye outline instead of tearing away from the eyeball (landmark vertices sit 1-2 rows outside it)
    margin = []
    if a.w_eye > 0:
        from scipy.spatial import cKDTree as _KD
        fwd_w0 = R @ np.array([0.0, 0.0, 1.0])
        for cid in (1, 2):
            eb = np.where((comp == cid) & (mat == 4))[0]
            if len(eb) < 20: continue
            Pe = V[eb]; A_ = np.c_[2 * Pe, np.ones(len(Pe))]; sol = np.linalg.lstsq(A_, (Pe ** 2).sum(1), rcond=None)[0]
            ce = sol[:3]; re_ = np.sqrt(max(sol[3] + ce @ ce, 1e-12))
            dd_ = np.linalg.norm(X0 - ce, axis=1) - re_
            ring = np.where((np.abs(dd_) < 0.12 * re_) & ((X0 - ce) @ fwd_w0 > 0.1 * re_))[0]
            side = [k for k in EYE_LM if np.linalg.norm(V[corr[k]] - ce) < 2.5 * re_]
            if len(ring) < 10 or len(side) < 8: continue
            dist, nn = _KD(X0[lm_local[side]]).query(X0[ring], k=2)
            wts = 1.0 / np.maximum(dist, 1e-9); wts /= wts.sum(1, keepdims=True)
            margin.append((ring, np.array(side)[nn], wts))
        report_margin = sum(len(m[0]) for m in margin)
    report = {"similarity_scale": float(s), "correspondence_fixed": report_fixed, "eyelid_cols": bool(a.eyelid_cols and a.eyelid_offset)}
    n_rounds = max(1, a.rounds if dense is not None else 1)
    p90 = []
    if a.profile90 > 0 and a.sparse and a.profile90_images:
        from profile90 import frames90, midline_segments, targets90
        Lm0 = X0[lm_local]; ylo, yhi = (float(v_) for v_ in a.profile90_yaw.split(","))
        p90 = frames90(a.sparse, a.poses, a.profile90_images, Lm0, set(open(a.exclude).read().split()) if a.exclude else set(), ylo, yhi)
        p90_ids, p90_lab = midline_segments(X0, lm_local, Lm0, segs=tuple(x_.strip() for x_ in a.profile90_segs.split(",") if x_.strip()))
        report["profile90"] = {"frames": len(p90), "midline_vertices": int(len(p90_ids)), "w": a.profile90}
        if p90: n_rounds = max(n_rounds, a.profile90_rounds)
    if sil_obs:
        n_rounds = max(n_rounds, 5)
        report["profile_sil_frames"] = len(sil_obs)
    if contour_obs:
        n_rounds = max(n_rounds, 3)
        report["contour_frames"] = len(contour_obs)
    keep_rows = None
    if a.keep_base > 0 and a.base_mesh:
        from gnm_features import landmark_classes
        anc = landmark_classes()["anchor"]; iod_k = np.linalg.norm(L468[33] - L468[263])
        dk, _ = cKDTree(X0[lm_local[anc]]).query(X0)
        wk = a.keep_base * np.clip((dk - 0.12 * iod_k) / (0.15 * iod_k), 0, 1)
        sel = np.where(wk > 0)[0]
        keep_rows = (csr_matrix((wk[sel], (np.arange(len(sel)), sel)), shape=(len(sel), n)), wk[sel][:, None] * X0[sel])
        report["keep_base_vertices"] = int(len(sel))
    depth_lm = np.zeros(0, int); depth_mode = a.anchor_depth_w is not None or a.eye_depth_w is not None or a.lid_prior is not None
    if a.eye_depth_w is not None: report["eye_depth_w"] = a.eye_depth_w
    prior_lm = np.zeros(0, int)
    if a.lid_prior is not None:
        # option A: eyelid + orbital landmarks keep the base (GNM prior) depth; measured only left-right / up-down
        reg_p = json.load(open(os.path.join(HERE, "..", "assets", "gnm", "gnm_features.json")))["regions"]
        prior_lm = np.array(sorted(set(EYE_LM) | {k for k in range(468) if any(r_ in ("left_orbital_region", "right_orbital_region")
                                                                              for r_ in reg_p[str(k)])}), int)
        report["lid_prior"] = {"w": a.lid_prior, "landmarks": int(len(prior_lm)), "margin_vertices": int(sum(len(m[0]) for m in margin))}
    if a.anchor_depth_w is not None:
        from gnm_features import landmark_classes
        import json as _j
        reg_ = _j.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "gnm", "gnm_features.json")))["regions"]
        depth_regions = tuple(r_.strip() for r_ in a.anchor_depth_regions.split(",") if r_.strip())
        # "all" (2026-10-23): every landmark, also the ones without a region (nostril area 79 / 238 / 250 / 459 / 461 kept
        # their MediaPipe depth under the region lists and pulled the subnasale / nose tip forward by 0.06-0.17 x eye width)
        depth_lm = np.arange(468) if "all" in depth_regions else np.array([k for k in range(468) if any(r_ in depth_regions
                                                         for r_ in reg_[str(k)])], int)
        report["anchor_depth_w"] = {"w": a.anchor_depth_w, "landmarks": int(len(depth_lm))}
    for rd in range(n_rounds):
        rows, rhs = [a.w_smooth * Bi], [a.w_smooth * delta]
        if keep_rows is not None:
            rows.append(keep_rows[0]); rhs.append(keep_rows[1])
        # landmark constraints
        Wl = a.w_lm * np.sqrt(w * rel)
        if a.w_eye > 0:
            # eyelid contour: the smooth template pull narrowed the eye opening (~16-20 % vs the photos); the 32 lid
            # landmarks are measured well (multi-view reprojection ~1.3 px), so they get a strong weight
            Wl = Wl.copy(); Wl[EYE_LM] = np.maximum(Wl[EYE_LM], a.w_eye)
        if contour_obs:
            Wl = Wl.copy(); Wl[oval] *= 0.1   # outline: 3D triangulation only as a weak hint
        if a.w_oval is not None or a.w_surface is not None:
            from gnm_features import landmark_weights
            Wl = Wl * landmark_weights(oval=1.0 if a.w_oval is None else a.w_oval, surface=1.0 if a.w_surface is None else a.w_surface)
        Cl = csr_matrix((Wl, (np.arange(468), lm_local)), shape=(468, n))
        lm_row0 = sum(r_.shape[0] for r_ in rows)
        rows.append(Cl); rhs.append(Wl[:, None] * L468)
        margin_rows = []
        for ring, lmk, wts in margin:
            dlm = L468[lmk] - X0[lm_local[lmk]]                      # (n_ring, 2, 3) landmark displacements
            tgt = X0[ring] + (wts[:, :, None] * dlm).sum(1)
            Wm = np.full(len(ring), a.w_eye)
            margin_rows.append((sum(r_.shape[0] for r_ in rows), len(ring)))
            rows.append(csr_matrix((Wm, (np.arange(len(ring)), ring)), shape=(len(ring), n))); rhs.append(Wm[:, None] * tgt)
        if contour_obs:
            # outline target = the detected 2D outline in each near-frontal frame, back-projected at the model's current depth
            Xo = X[lm_local[OVAL]]; T = np.zeros_like(Xo)
            for R_, t_, f_, cx_, cy_, uvo in contour_obs:
                Pc = Xo @ R_.T + t_; z = Pc[:, 2:3]
                ray = np.hstack([(uvo[:, :1] - cx_) / f_, (uvo[:, 1:] - cy_) / f_, np.ones((len(uvo), 1))]) * z
                T += (ray - t_) @ R_
            T /= len(contour_obs)
            Wc = np.full(len(OVAL), a.w_contour)
            rows.append(csr_matrix((Wc, (np.arange(len(OVAL)), lm_local[OVAL])), shape=(len(OVAL), n))); rhs.append(Wc[:, None] * T)
        if sil_obs:
            Vcur = V.copy(); Vcur[sk] = X; nsil = 0
            for ob in sil_obs:
                ids, T = sil_targets(X, Fl, ob, Vcur, F)
                if not len(ids): continue
                Ws = np.full(len(ids), a.w_sil); nsil += len(ids)
                rows.append(csr_matrix((Ws, (np.arange(len(ids)), ids)), shape=(len(ids), n))); rhs.append(Ws[:, None] * T)
            report[f"round{rd}_profile_sil_constraints"] = nsil
        if p90:
            import time as _t; _t0 = _t.time()
            np90, g90 = 0, []
            for ob in p90:
                ids, T, g = targets90(X, ob, p90_ids, X[lm_local])
                if not len(ids): continue
                Wp = np.full(len(ids), a.profile90); np90 += len(ids); g90 += list(g)
                rows.append(csr_matrix((Wp, (np.arange(len(ids)), ids)), shape=(len(ids), n))); rhs.append(Wp[:, None] * T)
            report[f"round{rd}_profile90_target_sec"] = round(_t.time() - _t0, 2)
            report[f"round{rd}_profile90"] = {"constraints": np90, "gap_median_pct_iod": round(float(np.median(g90)) * 100, 2) if g90 else None,
                                              "gap_abs_median_pct_iod": round(float(np.median(np.abs(g90))) * 100, 2) if g90 else None}
        if dense is not None:
            dd, ii = dtree.query(X)
            # only skin near the measured surface (face region), robust cut
            thr = 0.15 * scale
            m = dd < thr
            if a.dense_feature_radius > 0:
                inner = lm_local[~oval]
                iod = np.linalg.norm(L468[33] - L468[263])
                dfeat, _ = cKDTree(X[inner]).query(X)
                m &= dfeat > a.dense_feature_radius * iod
            wd = a.w_data * (1 - (dd[m] / thr) ** 2)
            if a.dense_region == "nose":
                # capsule around the nose midline (nasion 168 -> tip 1 -> subnasale 2) + the alar points, feathered
                iod_ = np.linalg.norm(L468[33] - L468[263]); Xm = X[m]
                def seg_d(P, A, B):
                    ab = B - A; t_ = np.clip(((P - A) @ ab) / (ab @ ab), 0, 1); return np.linalg.norm(P - (A + t_[:, None] * ab), axis=1)
                dn = np.minimum.reduce([seg_d(Xm, L468[168], L468[1]), seg_d(Xm, L468[1], L468[2]),
                                        seg_d(Xm, L468[129], L468[358])])
                wn = np.clip((0.30 * iod_ - dn) / (0.08 * iod_), 0, 1)
                wd = wd * wn
                keep = wn > 0
                Cd = csr_matrix((wd[keep], (np.arange(keep.sum()), np.where(m)[0][keep])), shape=(int(keep.sum()), n))
                rows.append(Cd); rhs.append(wd[keep][:, None] * dense[ii[m]][keep])
                report[f"round{rd}_data_points"] = int(keep.sum()); report[f"round{rd}_data_median"] = float(np.median(dd[m][keep]) / scale) if keep.any() else None
                continue_dense = False
            else:
                continue_dense = True
            if continue_dense:
                Cd = csr_matrix((wd, (np.arange(m.sum()), np.where(m)[0])), shape=(int(m.sum()), n))
                rows.append(Cd); rhs.append(wd[:, None] * dense[ii[m]])
                report[f"round{rd}_data_points"] = int(m.sum()); report[f"round{rd}_data_median"] = float(np.median(dd[m]) / scale) if m.any() else None
        import time as _t2; _ts = _t2.time()
        A = vstack(rows).tocsr(); B = np.vstack(rhs)
        if depth_mode:
            # solved in HEAD axes (right / up / forward): the nose and lip landmarks count only --anchor-depth-w in the
            # FORWARD direction - their triangulated depth sat in front of the photo profile (woo01: philtrum / nose
            # bridge protruded in side views, 2026-10-16); left-right / up-down they stay exact
            Bax = head_axes(L468)
            if a.depth_axis == "view" and a.poses:
                Bax, n_v, ang_v = view_axes(L468, a.poses, Bax); report["depth_axis"] = {"axis": "view", "frames": n_v, "deg_from_head_forward": round(ang_v, 2)}
            Br = B @ Bax.T; X0r = X @ Bax.T; cols_ = []
            for k in range(3):
                Ak = A
                if k == 2:
                    sc = np.ones(A.shape[0])
                    if a.anchor_depth_w is not None: sc[lm_row0 + depth_lm] = a.anchor_depth_w
                    if a.eye_depth_w is not None:                 # eyelid landmarks + lid-margin ring rows: weak in depth
                        sc[lm_row0 + np.array(EYE_LM)] = a.eye_depth_w
                        for r0_, n_ in margin_rows: sc[r0_:r0_ + n_] = a.eye_depth_w
                    bfwd = Br[:, k].copy()
                    if a.lid_prior is not None:
                        # target depth = the base shape's depth at that vertex (row weight kept, x lid_prior)
                        X0f = X0 @ Bax[2]
                        rows_p = lm_row0 + prior_lm
                        bfwd[rows_p] = Wl[prior_lm] * X0f[lm_local[prior_lm]]; sc[rows_p] = a.lid_prior
                        for (r0_, n_), (ring_, _, _) in zip(margin_rows, margin):
                            bfwd[r0_:r0_ + n_] = a.w_eye * X0f[ring_]; sc[r0_:r0_ + n_] = a.lid_prior
                    from scipy.sparse import diags
                    Ak = diags(sc) @ A; bk = bfwd * sc
                else:
                    bk = Br[:, k]
                cols_.append(lsqr(Ak, bk, atol=1e-10, btol=1e-10, iter_lim=4000, x0=X0r[:, k])[0])
            X = np.stack(cols_, 1) @ Bax
        else:
            X = np.stack([lsqr(A, B[:, k], atol=1e-10, btol=1e-10, iter_lim=4000, x0=X[:, k])[0] for k in range(3)], 1)
        report[f"round{rd}_solve_sec"] = round(_t2.time() - _ts, 2)
    V[sk] = X
    # non-skin parts (eyes, lashes, teeth): follow the mean displacement of their nearest skin vertices
    stree = cKDTree(V0[sk])
    for cid in np.unique(comp):
        if cid == 0:
            continue
        ids = np.where(comp == cid)[0]
        Vt = (s * (R @ V0[ids].T)).T + t   # part after the global similarity
        if set(np.unique(mat[ids])) & {4, 5, 6}:
            # eyeball: follow its eyelid ring with a similarity (scale + turn + shift), so a flatter / smaller eye region
            # does not leave the eyeball poking through the lids (seen in profile views)
            # eyelid contact ring: skin vertices lying on the front half of the eyeball surface (lid margins).
            # (a wide ball around the eye also caught the socket interior behind the eyeball)
            ball = ids[mat[ids] == 4] if (mat[ids] == 4).any() else ids
            A_ = np.c_[2 * Vt[np.isin(ids, ball)], np.ones(len(ball))]; b_ = (Vt[np.isin(ids, ball)] ** 2).sum(1)
            sol = np.linalg.lstsq(A_, b_, rcond=None)[0]; c0 = sol[:3]; rad = np.sqrt(max(sol[3] + c0 @ c0, 1e-12))
            fwd_w = R @ np.array([0.0, 0.0, 1.0])
            dd_ = np.linalg.norm(X0 - c0, axis=1) - rad
            ring = np.where((np.abs(dd_) < 0.1 * rad) & ((X0 - c0) @ fwd_w > 0.2 * rad))[0]
            if len(ring) >= 20:
                # eyeball follows its lid ring: same shift as the ring centre, size by the ring spread (+-8 %), no
                # rotation; then keep the template's depth of the cornea apex behind the lid ring (no popping out)
                rc0, rc1 = X0[ring].mean(0), X[ring].mean(0)
                sc = np.clip(np.sqrt(((X[ring] - rc1) ** 2).sum(1).mean() / max(((X0[ring] - rc0) ** 2).sum(1).mean(), 1e-12)), 0.92, 1.08)
                Ve = rc1 + sc * (Vt - rc0)
                apex0 = ((Vt - rc0) @ fwd_w).max(); apex1 = ((Ve - rc1) @ fwd_w).max()
                V[ids] = Ve + fwd_w * (apex0 - apex1)
                continue
        _, nn = stree.query(V0[ids], k=20)
        disp = (X[nn] - X0[nn]).mean(1).mean(0)
        V[ids] = Vt + disp
    # eye-opening cleanup: inner-socket skin that ended up IN FRONT of the eyeball inside the lid opening (a flap seen
    # through the eye) is pushed back behind the eyeball surface
    if a.w_eye > 0:
        from matplotlib.path import Path as _Path
        fwd_w = R @ np.array([0.0, 0.0, 1.0]); up_w = R @ np.array([0.0, 1.0, 0.0]); rt_w = np.cross(up_w, fwd_w)
        moved = 0
        for cid, ring_ids in ((1, [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]),
                              (2, [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7])):
            eb = np.where((comp == cid) & (mat == 4))[0]
            if len(eb) < 20: continue
            Pe = V[eb]; sol = np.linalg.lstsq(np.c_[2 * Pe, np.ones(len(Pe))], (Pe ** 2).sum(1), rcond=None)[0]
            ce = sol[:3]; re_ = np.sqrt(max(sol[3] + ce @ ce, 1e-12))
            poly = V[corr[ring_ids]]
            if np.linalg.norm(poly.mean(0) - ce) > 3 * re_:   # wrong side: swap eye
                continue
            pc = poly.mean(0)
            P2 = np.c_[(poly - pc) @ rt_w, (poly - pc) @ up_w] * 0.92
            path = _Path(P2)
            cand = sk[np.linalg.norm(V[sk] - ce, axis=1) < 1.6 * re_]
            Q = V[cand]; q2 = np.c_[(Q - pc) @ rt_w, (Q - pc) @ up_w]
            dce = np.linalg.norm(Q - ce, axis=1)
            bad = path.contains_points(q2) & (dce > 0.97 * re_) & ((Q - ce) @ fwd_w > 0)
            if bad.any():
                u = (Q[bad] - ce) / dce[bad, None]
                V[cand[bad]] = ce + u * 0.93 * re_; moved += int(bad.sum())
        report["eye_opening_cleaned_vertices"] = moved
    res = np.linalg.norm(V[corr] - L468, axis=1) / scale
    report.update({"landmark_residual_median_rel": float(np.median(res)), "landmark_residual_p95_rel": float(np.quantile(res, 0.95)),
                   "vertices": int(len(V)), "skin_vertices": int(n), "dense_points": None if dense is None else int(len(dense))})
    # 4. colours from the frames (if a camera model is given)
    col = np.full((len(V), 3), 0.75)
    if a.sparse and a.images:
        import cv2, pycolmap
        rec = pycolmap.Reconstruction(a.sparse)
        vn = np.zeros_like(V)
        fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        for k in range(3):
            np.add.at(vn, F[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        # outward check: normals should point to the cameras on average
        cams = np.array([i.projection_center() for i in rec.images.values()])
        if ((V[sk] - V[sk].mean(0)) * vn[sk]).sum(1).mean() < 0:
            vn = -vn
        acc = np.zeros((len(V), 3)); ws = np.zeros(len(V))
        for im in rec.images.values():
            img = cv2.imread(os.path.join(a.images, im.name))
            if img is None:
                continue
            cam = rec.cameras[im.camera_id]; T = im.cam_from_world()
            cc = im.projection_center()
            cosv = ((cc - V) * vn).sum(1) / (np.linalg.norm(cc - V, axis=1) + 1e-12)
            wv = np.clip(cosv, 0, 1) ** 6
            pc = np.array([T * p for p in V])
            uv = np.array([q if (q := cam.img_from_cam(p)) is not None else (-1.0, -1.0) for p in pc])   # None behind the camera
            H, W = img.shape[:2]
            ok = (pc[:, 2] > 0) & (uv[:, 0] >= 0) & (uv[:, 0] < W) & (uv[:, 1] >= 0) & (uv[:, 1] < H) & (wv > 0.05)
            px = np.clip(uv[:, 0], 0, W - 1).astype(int); py = np.clip(uv[:, 1], 0, H - 1).astype(int)
            acc[ok] += img[py[ok], px[ok]][:, ::-1] / 255.0 * wv[ok, None]; ws[ok] += wv[ok]
        have = ws > 0.15
        col[have] = acc[have] / ws[have, None]
        report["coloured_vertices"] = int(have.sum())
        # regions no frame saw well (under the chin, crown, behind the ears): diffuse the neighbouring skin colour
        # instead of leaving white/grey patches (they are marked as estimated in the report)
        from scipy.sparse import coo_matrix
        nV = len(V)
        i_ = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
        j_ = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
        Adj = coo_matrix((np.ones(len(i_)), (i_, j_)), shape=(nV, nV)).tocsr(); Adj.data[:] = 1.0
        deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
        known = have.copy(); c2 = col.copy(); c2[~known] = np.median(col[have & (mat == 0)], 0)
        for _ in range(300):
            avg = (Adj @ c2) / deg[:, None]
            c2[~known] = avg[~known]
        col = c2
        report["colour_estimated_vertices"] = int((~known).sum())
    meshio.write_ply(a.out, V, F, col)
    report["landmark_vertex_ids"] = [int(x) for x in corr]
    json.dump(report, open(os.path.splitext(a.out)[0] + ".fit.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != "landmark_vertex_ids"}))


if __name__ == "__main__":
    main()
