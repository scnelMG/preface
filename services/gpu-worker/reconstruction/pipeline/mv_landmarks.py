"""Multi-view landmark triangulation: video/photo frames + COLMAP camera poses -> 3D face mesh with MEASURED depth.

Single-photo mode (rgb_to_mesh.py) estimates depth from one picture: the profile (dorsum, tip projection) is a guess.
Here every registered frame gives the 478 MediaPipe face landmarks in 2D; since a landmark id is the same physical point
in every frame, each of the 468 face points is triangulated from all views that SEE it (side landmarks only from frames
turned toward them, judged from MediaPipe's own per-frame 3D normals). This needs no skin texture, so it also works on
low-texture webcam video where dense stereo fails.

pipeline:
  per frame: MediaPipe landmarks (px) + visibility (per-frame face-mesh normal toward the camera)
  per landmark: robust DLT triangulation (IRLS, Huber on reprojection error) over visible views; reject > 8 px median,
    fewer than 3 views, or views within MIN_PARALLAX_DEG of each other (depth not measured); rejected points are filled
    from their neighbours and weigh almost nothing in the fits (no reprojection error recorded)
  mesh: MediaPipe tessellation + eye/mouth caps (rgb_to_mesh.add_cap) + subdivision
  colour: blended from the 3 best-facing frames (cosine-weighted) with the COLMAP projection
usage: python mv_landmarks.py <imagesDir> <sparseModelDir> <out.ply> [--subdiv 3]
outputs <out.ply> (COLMAP frame, arbitrary scale) and <out>.mvinfo.json (per-landmark views/reprojection, summary)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import meshio  # noqa: E402
from rgb_to_mesh import tessellation_triangles, subdivide, add_cap, EYE_LOOPS, MOUTH_LOOP  # noqa: E402
import face_lm  # noqa: E402

# the most different viewing directions of a landmark must differ by this much. Points seen only in the few chin-up frames
# (nostrils) had 11 deg on an iPhone 17 recording: a few px in 2D became millimetres along the ray, the fit followed them and
# the nose was pulled sideways (columella 6 % IOD off the photo). Well-measured points: 28-140 deg (5 recordings, 2026-11-11)
MIN_PARALLAX_DEG = 20.0


def vertex_normals(v, f):
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


def main():
    import cv2
    import pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("images"); ap.add_argument("sparse"); ap.add_argument("out")
    ap.add_argument("--subdiv", type=int, default=3)
    ap.add_argument("--poses", help="frame_check.py JSON: corrected poses, dropped frames skipped")
    ap.add_argument("--exclude", help="text file with frame names to leave out (hold-out validation)")
    a = ap.parse_args()
    rec = pycolmap.Reconstruction(a.sparse)
    from frame_check import load_poses
    poses = load_poses(a.poses)
    excl = set(open(a.exclude).read().split()) if a.exclude else set()
    F = tessellation_triangles()
    Foriented = None  # triangle winding made consistent once (from the most frontal frame), reused for every frame
    views = []  # (P 3x4, uv 468x2, vis 468, image name, img)
    face_lm.prefetch(a.images, [i.name for i in rec.images.values()
                                if i.name not in excl and (poses is None or i.name in poses)])
    for img in sorted(rec.images.values(), key=lambda i: i.name):
        if img.name in excl or (poses is not None and img.name not in poses):
            continue
        path = os.path.join(a.images, img.name)
        bgr = cv2.imread(path)
        if bgr is None:
            continue
        cam = rec.cameras[img.camera_id]
        L, _ = face_lm.landmarks(a.images, img.name, bgr)
        if L is None:
            continue
        H, W = bgr.shape[:2]
        lm = (np.array(L) * [W, H, W])[:468]
        # undistort the 2D points with the COLMAP camera (handles SIMPLE_RADIAL etc.) -> normalized camera coordinates
        xy = np.array([cam.cam_from_img(lm[k, :2]) for k in range(468)])
        # visibility: per-frame mesh normal (MediaPipe 3D, camera looks along +z in image space) pointing to the camera
        v3 = np.stack([lm[:, 0], lm[:, 1], lm[:, 2]], 1)
        views.append({"name": img.name, "T": None, "xy": xy, "v3": v3, "bgr": bgr, "cam": cam, "img": img})
    # consistent winding: in the most frontal frame every face-mesh triangle must face the camera (normal z < 0, z away)
    yawish = [abs(np.median(v["v3"][[234, 454], 2][0] - v["v3"][[234, 454], 2][1])) for v in views]
    fr = views[int(np.argmin(yawish))]["v3"]
    fz = np.cross(fr[F[:, 1]] - fr[F[:, 0]], fr[F[:, 2]] - fr[F[:, 0]])[:, 2]
    F[fz > 0] = F[fz > 0][:, [0, 2, 1]]
    for v in views:
        nrm = vertex_normals(v["v3"], F)
        v["facing"] = -nrm[:, 2]  # toward the viewer (MediaPipe image coordinates, z grows away)
        if poses is not None:
            R, t = poses[v["name"]]; v["T"] = np.hstack([R, np.asarray(t).reshape(3, 1)])
        else:
            v["T"] = np.asarray(v["img"].cam_from_world().matrix())
    for _unused in []:
        pass
    if len(views) < 5:
        raise SystemExit(f"only {len(views)} frames with a face")
    # robust triangulation per landmark
    X = np.zeros((468, 3)); info = []
    for k in range(468):
        rows, wts, used = [], [], []
        for vi, v in enumerate(views):
            fz = v["facing"][k]
            if fz < 0.5:
                continue
            x, y = v["xy"][k]; T = v["T"]
            rows.append(x * T[2] - T[0]); rows.append(y * T[2] - T[1])
            wts += [fz, fz]; used.append(vi)
        if len(used) < 3:
            info.append({"id": k, "views": len(used), "status": "too_few"}); X[k] = np.nan; continue
        A = np.array(rows); w = np.array(wts)
        for it in range(6):
            Aw = A * w[:, None]
            _, _, Vt = np.linalg.svd(Aw)
            Xh = Vt[-1]; Xk = Xh[:3] / Xh[3]
            # reprojection residuals (normalized coords) -> Huber weights
            res = []
            for vi in used:
                T = views[vi]["T"]; pc = T[:, :3] @ Xk + T[:, 3]
                res.append(np.hypot(pc[0] / pc[2] - views[vi]["xy"][k][0], pc[1] / pc[2] - views[vi]["xy"][k][1]))
            res = np.array(res)
            s = 1.5 * np.median(res) + 1e-9
            hub = np.where(res <= s, 1.0, s / res)
            base = np.array([views[vi]["facing"][k] for vi in used])
            w = np.repeat(base * hub, 2)
        C = np.array([-views[vi]["T"][:, :3].T @ views[vi]["T"][:, 3] for vi in used])   # camera centres
        D = Xk - C; D /= np.linalg.norm(D, axis=1, keepdims=True)
        par = float(np.degrees(np.arccos(np.clip((D @ D.T).min(), -1, 1))))
        if par < MIN_PARALLAX_DEG:
            info.append({"id": k, "views": len(used), "parallax_deg": round(par, 1), "status": "narrow"}); X[k] = np.nan; continue
        X[k] = Xk
        fpx = views[used[0]]["cam"].params[0]
        info.append({"id": k, "views": len(used), "reproj_px_median": float(np.median(res) * fpx), "parallax_deg": round(par, 1)})
    bad = [i["id"] for i in info if i.get("status") or i.get("reproj_px_median", 0) > 8.0]
    good = np.array([i not in bad for i in range(468)])
    # fill rejected landmarks from their neighbours (Laplacian fill on the tessellation)
    if (~good).any():
        nb = [set() for _ in range(468)]
        for t in F:
            for i in range(3):
                nb[t[i]].update(t)
        for _ in range(50):
            for k in np.where(~good)[0]:
                nn = [j for j in nb[k] if j != k and not np.isnan(X[j]).any()]
                if nn:
                    X[k] = np.mean(X[nn], 0)
    # orient triangles outward (toward the frontal camera)
    front = min(views, key=lambda v: abs(np.median(v["facing"]) - 1))
    fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]])
    cc = -front["T"][:, :3].T @ front["T"][:, 3]  # camera centre
    out_dir = (X[F].mean(1) - cc)
    # winding is already consistent (from the frontal MediaPipe frame); flip ALL triangles only if most face away
    if ((fn * out_dir).sum(1) > 0).mean() > 0.5:
        F = F[:, [0, 2, 1]]
    # caps (eyes recessed, mouth flat) in a local frame: use the frontal camera z as "toward viewer"
    Rf = front["T"][:, :3]
    Xc = (Rf @ X.T).T  # frontal camera frame: +z away from camera
    Vloc = Xc * np.array([1, -1, -1])  # +z toward camera, +y up
    eye_w = np.linalg.norm(Vloc[33] - Vloc[133])
    v, f = Vloc, F
    for loop in EYE_LOOPS.values():
        v, f = add_cap(v, f, loop, bulge=-0.08 * eye_w, rings=4)
    v, f = add_cap(v, f, MOUTH_LOOP, bulge=-0.02 * eye_w, rings=2)
    for _ in range(a.subdiv):
        v, f = subdivide(v, f)
    Xw = (Rf.T @ (v * np.array([1, -1, -1])).T).T  # back to the COLMAP world frame
    # colour: best-facing frames, cosine-weighted
    vn = vertex_normals(Xw, f)
    col = np.zeros((len(Xw), 3)); wsum = np.zeros(len(Xw))
    for vw in views:
        T = vw["T"]; pc = (T[:, :3] @ Xw.T).T + T[:, 3]
        ccam = -T[:, :3].T @ T[:, 3]
        cosv = ((ccam - Xw) * vn).sum(1) / (np.linalg.norm(ccam - Xw, axis=1) + 1e-12)
        wv = np.clip(cosv, 0, 1) ** 4
        if wv.max() < 0.3:
            continue
        # img_from_cam is None behind the camera (10/20 chae01-f916 crash) -> (-1, -1), dropped by `ok` below
        uv = np.array([q if (q := vw["cam"].img_from_cam(p)) is not None else (-1.0, -1.0) for p in pc])
        H, W = vw["bgr"].shape[:2]
        ok = (pc[:, 2] > 0) & (uv[:, 0] >= 0) & (uv[:, 0] < W - 1) & (uv[:, 1] >= 0) & (uv[:, 1] < H - 1)
        px = np.clip(uv[:, 0], 0, W - 1).astype(int); py = np.clip(uv[:, 1], 0, H - 1).astype(int)
        c = vw["bgr"][py, px][:, ::-1] / 255.0
        wv = wv * ok
        col += c * wv[:, None]; wsum += wv
    col = col / np.maximum(wsum, 1e-9)[:, None]
    meshio.write_ply(a.out, Xw, f, col)
    rp = [i["reproj_px_median"] for i in info if "reproj_px_median" in i]
    summary = {"frames_used": len(views), "landmarks": 468, "rejected": len(bad), "reproj_px_median": float(np.median(rp)),
               "reproj_px_p95": float(np.quantile(rp, 0.95)), "views_per_landmark_median": float(np.median([i["views"] for i in info])),
               "vertices": int(len(Xw)), "faces": int(len(f)), "subdiv": a.subdiv,
               "note": "468 triangulated (measured) points; the rest are subdivision (interpolated). Units = COLMAP model units"}
    json.dump({"summary": summary, "landmarks": info}, open(os.path.splitext(a.out)[0] + ".mvinfo.json", "w"), indent=1)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
