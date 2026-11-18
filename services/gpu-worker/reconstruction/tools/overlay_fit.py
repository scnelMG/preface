"""Overlay a fitted mesh on the capture frames with the SfM camera (shape check: does the model's outline sit on the person?).
usage: python tools/overlay_fit.py <mesh.ply> <sparse> <prepare.json> <imagesDir> <out.jpg> [--yaws -40,-20,0,20,40]
each tile: left = photo, right = photo with the model drawn semi-transparent (grey shading) + outline (yellow)."""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import meshio  # noqa


def draw(img, V, F, rec, im, poses=None):
    import cv2
    cam = rec.cameras[im.camera_id]; T = im.cam_from_world()
    R, t = poses[im.name] if poses and im.name in poses else (T.rotation.matrix(), T.translation)
    Q = V @ R.T + t
    from frame_check import intrinsics
    f, cx, cy = intrinsics(cam)
    uv = np.stack([f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy], 1)
    n = np.cross(Q[F[:, 1]] - Q[F[:, 0]], Q[F[:, 2]] - Q[F[:, 0]]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    c = Q[F].mean(1); vd = -c / np.linalg.norm(c, axis=1, keepdims=True)
    sh = (n * vd).sum(1)
    if np.median(sh) < 0: sh = -sh
    order = np.argsort(-c[:, 2])
    lay = img.copy(); mask = np.zeros(img.shape[:2], np.uint8)
    for k in order:
        if sh[k] <= 0: continue
        g = int(60 + 190 * sh[k] ** 0.8)
        p = uv[F[k]].astype(np.int32)
        cv2.fillConvexPoly(lay, p, (g, g, g)); cv2.fillConvexPoly(mask, p, 255)
    out = cv2.addWeighted(img, 0.45, lay, 0.55, 0)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(out, cnts, -1, (0, 255, 255), 2)
    return out, uv


def main():
    import cv2, pycolmap
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh"); ap.add_argument("sparse"); ap.add_argument("prepare"); ap.add_argument("images"); ap.add_argument("out")
    ap.add_argument("--yaws", default="-40,-20,0,20,40"); ap.add_argument("--skin-only", action="store_true"); ap.add_argument("--poses", help="frame_check.py JSON (corrected poses)")
    a = ap.parse_args()
    m = meshio.read_any(a.mesh); V = np.asarray(m["vertices"], np.float64); F = np.asarray(m["faces"], np.int64)
    rec = pycolmap.Reconstruction(a.sparse)
    from frame_check import load_poses
    poses = load_poses(a.poses)
    prep = json.load(open(a.prepare)); yaw = {i["file"]: i["yaw"] for i in prep["images"] if i.get("yaw") is not None}
    ims = [i for i in rec.images.values() if i.name in yaw and (poses is None or i.name in poses)]
    tiles = []
    for y in [float(s) for s in a.yaws.split(",")]:
        im = min(ims, key=lambda i: abs(yaw[i.name] - y))
        img = cv2.imread(os.path.join(a.images, im.name))
        o, uv = draw(img, V, F, rec, im, poses)
        x0, y0 = np.maximum(uv.min(0) - 60, 0).astype(int); x1, y1 = np.minimum(uv.max(0) + 60, [img.shape[1], img.shape[0]]).astype(int)
        A, B = img[y0:y1, x0:x1], o[y0:y1, x0:x1]
        s = 420 / A.shape[0]
        A = cv2.resize(A, None, fx=s, fy=s); B = cv2.resize(B, None, fx=s, fy=s)
        t = np.concatenate([A, B], 1)
        cv2.putText(t, f"yaw {yaw[im.name]:.0f}", (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        tiles.append(t)
    W = max(t.shape[1] for t in tiles)
    tiles = [cv2.copyMakeBorder(t, 0, 4, 0, W - t.shape[1], cv2.BORDER_CONSTANT) for t in tiles]
    cv2.imwrite(a.out, np.concatenate(tiles, 0), [cv2.IMWRITE_JPEG_QUALITY, 85])


if __name__ == "__main__":
    main()
