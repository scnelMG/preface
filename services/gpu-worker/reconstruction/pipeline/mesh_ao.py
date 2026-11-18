"""Ambient occlusion of a mesh, per vertex: how much of the sky above each surface point is open (cosine weighted).
Concave places (under the nose, the nostril wings, under the lower lip, the jaw underside) get little light from any
direction -> they stay dark in EVERY frame of a capture, so frame-to-frame lighting separation cannot remove that
shading (eun02 2026-10-16: under-nose skin 0.70-0.76 of the cheek in all head pitches). AO lets the bake explain it.
"""
import numpy as np


def fib_dirs(k):
    i = np.arange(k) + 0.5; phi = np.arccos(1 - 2 * i / k); th = np.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)


def vertex_ao(V, F, vn, k=96, res=384, smooth=10):
    import cv2
    from scipy.sparse import coo_matrix
    D = fib_dirs(k); acc = np.zeros(len(V)); wsum = np.zeros(len(V))
    ext = np.abs(V - V.mean(0)).max() * 1.05; C = V.mean(0)
    Ps = np.concatenate([V, V[F].mean(1), (V[F[:, 0]] + V[F[:, 1]]) / 2])     # dense samples: hole-free depth maps
    for d in D:
        a = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.9 else [1, 0, 0]); a /= np.linalg.norm(a); b = np.cross(d, a)
        def proj(X):
            Q = X - C; return ((Q @ a) / ext * 0.5 + 0.5) * (res - 1), ((Q @ b) / ext * 0.5 + 0.5) * (res - 1), Q @ d
        u, v, z = proj(Ps); zb = np.full((res, res), -np.inf)
        np.maximum.at(zb, (np.clip(v.astype(int), 0, res - 1), np.clip(u.astype(int), 0, res - 1)), z)
        zb = cv2.dilate(np.where(np.isinf(zb), -1e9, zb).astype(np.float32), np.ones((3, 3), np.uint8))
        u, v, z = proj(V)
        vis = z >= zb[np.clip(v.astype(int), 0, res - 1), np.clip(u.astype(int), 0, res - 1)] - 0.01 * ext
        c = vn @ d; m = c > 0
        acc[m] += vis[m] * c[m]; wsum[m] += c[m]
    ao = acc / np.maximum(wsum, 1e-9)
    e = np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]
    Aj = coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(len(V), len(V))).tocsr()
    deg = np.asarray(Aj.sum(1)).ravel() + 1
    for _ in range(smooth): ao = (Aj @ ao + ao) / deg
    return ao
