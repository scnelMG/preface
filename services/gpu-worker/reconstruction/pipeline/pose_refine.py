"""Landmark bundle refinement of the camera poses (fixes a few-degree SfM pose bias that shows up as a wrong profile in
some head-turn directions: on p01-s1 the + side frames needed ~3.6 deg more yaw, the frontal ones ~2.5 deg of pitch).

For every frame: PnP of the current 3D face points (mv.ply, first 468 vertices) against the MediaPipe points detected in
that frame, using only points that FACE the camera and are not on the face outline (outline points are silhouettes),
starting from the current pose (small correction). Frames whose refined pose does not reduce the error are kept.
Alternate with mv_landmarks.py (re-triangulation) 2-3 times = a simple bundle adjustment on landmarks.

usage: python pose_refine.py <mv.ply> <sparse> <images> <poses_in.json> <poses_out.json> [--max-deg 8]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa: E402
from frame_check import load_poses, intrinsics  # noqa: E402

OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150,
        136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


def main():
    import cv2, pycolmap
    import face_lm
    ap = argparse.ArgumentParser()
    ap.add_argument("mv"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("poses_in"); ap.add_argument("out")
    ap.add_argument("--max-deg", type=float, default=8.0)
    a = ap.parse_args()
    mm = meshio.read_any(a.mv); V = np.asarray(mm["vertices"], np.float64); F = np.asarray(mm["faces"], np.int64)
    X = V[:468]
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    XN = vn[:468] / (np.linalg.norm(vn[:468], axis=1, keepdims=True) + 1e-12)
    rec = pycolmap.Reconstruction(a.sparse)
    src = json.load(open(a.poses_in)); poses = load_poses(a.poses_in)
    cams = np.array([-R.T @ t for R, t in poses.values()])
    if ((X - X.mean(0)) * XN).sum(1).mean() < 0: XN = -XN
    out = {"summary": {}, "frames": {}}; deltas = []; gains = []
    for im in sorted(rec.images.values(), key=lambda i: i.name):
        row = dict(src["frames"].get(im.name, {}))
        if im.name not in poses:
            out["frames"][im.name] = row; continue
        R, t = poses[im.name]
        img = cv2.imread(os.path.join(a.images, im.name)); H, W = img.shape[:2]
        L, _ = face_lm.landmarks(a.images, im.name, img)
        if L is None:
            out["frames"][im.name] = row; continue
        uv = (np.array(L)[:, :2] * [W, H])[:468]
        f, cx, cy = intrinsics(rec.cameras[im.camera_id]); K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
        cc = -R.T @ t
        vis = ((cc - X) * XN).sum(1) / (np.linalg.norm(cc - X, axis=1) + 1e-12) > 0.35
        vis[OVAL] = False
        sel = np.where(vis)[0]
        if len(sel) < 60:
            out["frames"][im.name] = row; continue
        rv, _ = cv2.Rodrigues(R); tv = t.reshape(3, 1).astype(np.float64)
        e0 = np.median(np.linalg.norm(cv2.projectPoints(X[sel], rv, tv, K, None)[0][:, 0] - uv[sel], axis=1))
        ok, rv2, tv2 = cv2.solvePnP(X[sel], uv[sel], K, None, rv.copy(), tv.copy(), useExtrinsicGuess=True, flags=cv2.SOLVEPNP_ITERATIVE)
        e1 = np.median(np.linalg.norm(cv2.projectPoints(X[sel], rv2, tv2, K, None)[0][:, 0] - uv[sel], axis=1))
        R2, _ = cv2.Rodrigues(rv2)
        dang = np.degrees(np.arccos(np.clip((np.trace(R2 @ R.T) - 1) / 2, -1, 1)))
        if ok and e1 < e0 and dang < a.max_deg:
            row.update(R=R2.tolist(), t=tv2.ravel().tolist(), refined_deg=float(dang), err_before_px=float(e0), err_after_px=float(e1))
            deltas.append(dang); gains.append(e0 - e1)
        out["frames"][im.name] = row
    out["summary"] = {"refined": len(deltas), "median_correction_deg": float(np.median(deltas)) if deltas else 0.0,
                      "median_error_drop_px": float(np.median(gains)) if gains else 0.0}
    json.dump(out, open(a.out, "w"), indent=1)
    print(json.dumps(out["summary"]))


if __name__ == "__main__":
    main()
