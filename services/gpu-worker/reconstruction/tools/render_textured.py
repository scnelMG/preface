"""Render a uv_bake.py result (fitted GNM mesh + baked textures) from a few views, for checking. Offline, numpy z-buffer.
usage: python tools/render_textured.py <out_prefix of uv_bake> <fitted.ply> <sparse> <prepare.json> <out.png> [--size 640]
views: front, 3/4 right, profile right, 3/4 left (axes from the most frontal capture frame)."""
import argparse, json, os, subprocess, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import meshio  # noqa
from uv_bake import GROUPS, TEMPLATE  # noqa


def rot_y(a):
    c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def main():
    import cv2
    ap = argparse.ArgumentParser()
    ap.add_argument("prefix"); ap.add_argument("mesh"); ap.add_argument("sparse"); ap.add_argument("prepare"); ap.add_argument("out")
    ap.add_argument("--size", type=int, default=640); ap.add_argument("--gray", action="store_true"); ap.add_argument("--angles", default="0,35,80,-35")
    a = ap.parse_args()
    d = np.load(TEMPLATE); UV = d["vertex_uvs"].astype(np.float64); UT = d["uv_triangles"].astype(np.int64)
    F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(a.mesh)["vertices"], np.float64)
    o = json.loads(subprocess.check_output([sys.executable, os.path.join(HERE, "colmap", "frontal_axes.py"), a.sparse, a.prepare], stderr=subprocess.DEVNULL).decode().strip().splitlines()[-1])
    up = np.array([float(t) for t in o["up"].split(",")]); fw = np.array([float(t) for t in o["fwd"].split(",")])
    fw -= up * (fw @ up); fw /= np.linalg.norm(fw); x = np.cross(up, fw)
    Vc = (V - V[mat == 0].mean(0)) @ np.stack([x, up, fw]).T
    texs, tmat = [], np.full(len(F), -1)
    for gi, (name, mats, _) in enumerate(GROUPS):
        im_ = None if a.gray else cv2.imread(f"{a.prefix}_{name}.png")   # --gray: shape only, no bake needed
        texs.append(im_[:, :, ::-1].astype(np.float32) / 255 if im_ is not None else np.full((4, 4, 3), 0.8, np.float32))
        tmat[np.isin(mat[F], mats).all(1)] = gi
    S = a.size; tiles = []
    face = Vc[mat == 0]; ctr = np.array([0, np.percentile(face[:, 1], 55), 0]); ext = 0.62 * (np.percentile(face[:, 1], 99) - np.percentile(face[:, 1], 1))
    for ang in [float(x) for x in a.angles.split(',')]:
        P = (Vc - ctr) @ rot_y(np.radians(ang)).T
        px = np.stack([(P[:, 0] / ext * 0.5 + 0.5) * S, (0.5 - P[:, 1] / ext * 0.5) * S], 1)
        img = np.full((S, S, 3), 0.17, np.float32); zb = np.full((S, S), -np.inf)
        n = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        # outward orientation from the mesh itself (skin face normal vs its offset from the skin centroid), not from the
        # share of faces facing this view (~50 % in a profile view: the decision flipped and the head was drawn inside out)
        cen_f = P[F].mean(1); sk_c = P[mat == 0].mean(0)
        if ((cen_f[tmat == 0] - sk_c) * n[tmat == 0]).sum(1).mean() < 0: n = -n
        L = np.array([0.3, 0.4, 1.0]); L /= np.linalg.norm(L)
        for t in np.where(n[:, 2] > 0)[0]:
            p = px[F[t]]
            x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
            x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, S - 1), min(y1, S - 1)
            if x1 < x0 or y1 < y0: continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1)); q = np.stack([xs.ravel() + .5, ys.ravel() + .5], 1)
            T = np.array([p[1] - p[0], p[2] - p[0]]).T
            if abs(np.linalg.det(T)) < 1e-9: continue
            bc = np.linalg.solve(T, (q - p[0]).T).T; w = np.stack([1 - bc.sum(1), bc[:, 0], bc[:, 1]], 1)
            ins = (w >= -1e-4).all(1)
            if not ins.any(): continue
            w = w[ins]; xi, yi = xs.ravel()[ins], ys.ravel()[ins]
            z = w @ P[F[t], 2]; front = z > zb[yi, xi]
            if not front.any(): continue
            w, xi, yi, z = w[front], xi[front], yi[front], z[front]
            zb[yi, xi] = z
            shade = 0.55 + 0.45 * max(0.0, float(n[t] @ L))
            if a.gray:
                img[yi, xi] = np.array([0.82, 0.82, 0.85]) * (0.25 + 0.75 * max(0.0, float(n[t] @ L)))
            elif tmat[t] >= 0:
                tx = texs[tmat[t]]; ts = tx.shape[0]
                uv = w @ UV[UT[t]]
                c = tx[np.clip(((1 - uv[:, 1]) * (ts - 1)).astype(int), 0, ts - 1), np.clip((uv[:, 0] * (ts - 1)).astype(int), 0, ts - 1)]
                img[yi, xi] = c * (0.8 + 0.2 * shade)
            else:
                img[yi, xi] = np.array([0.55, 0.4, 0.4]) * shade
        tiles.append((np.clip(img, 0, 1) * 255).astype(np.uint8))
    cv2.imwrite(a.out, np.concatenate(tiles, 1)[:, :, ::-1])


if __name__ == "__main__":
    main()
