"""The person's hairline (pipeline/hairline.py -> model/hairline.json) for head.glb (S15P31B204-722).

The app puts hair assets on the head in the edit screen (S15P31B204-714) and needs the person's hairline there; until now
only head.glb, rig.json and the capture images were uploaded. The curve is stored ON THE SKIN, not as coordinates: every
point is a skin triangle of the template topology (3 template vertex ids, the same ids as the _TEMPLATE_INDEX vertex
attribute) and its barycentric weights. The app rebuilds it on whatever positions the head has (the GLB frame, and after
edits that move the skin), with no frame or scale bookkeeping:

    point = w0 * V[i0] + w1 * V[i1] + (1 - w0 - w1) * V[i2]      V[i] = position of the glTF vertex whose _TEMPLATE_INDEX is i

head.glb: asset.extras["live-mirror"]["hairline"] = {"version": 1, "points": [[i0, i1, i2, w0, w1], ...], ...}
(left to right as hairline.py wrote it; absent when the model has no hairline.json)
"""
import numpy as np

VERSION = 1


def closest_on_triangles(P, A, B, C):
    """closest point on each triangle (A[k], B[k], C[k]) to P[k] -> barycentric weights (n, 3) (Ericson, RTCD 5.1.5)"""
    ab, ac, ap = B - A, C - A, P - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = P - B; d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = P - C; d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) < 1e-30, 1e-30, va + vb + vc)
    w = np.stack([va, vb, vc], 1) / den[:, None]                                      # inside the face
    with np.errstate(divide="ignore", invalid="ignore"):
        cases = [
            ((d1 <= 0) & (d2 <= 0), np.stack([np.ones_like(d1), 0 * d1, 0 * d1], 1)),  # vertex A
            ((d3 >= 0) & (d4 <= d3), np.stack([0 * d1, np.ones_like(d1), 0 * d1], 1)),  # vertex B
            ((d6 >= 0) & (d5 <= d6), np.stack([0 * d1, 0 * d1, np.ones_like(d1)], 1)),  # vertex C
        ]
        t = d1 / (d1 - d3); cases.append(((vc <= 0) & (d1 >= 0) & (d3 <= 0), np.stack([1 - t, t, 0 * t], 1)))   # edge AB
        t = d2 / (d2 - d6); cases.append(((vb <= 0) & (d2 >= 0) & (d6 <= 0), np.stack([1 - t, 0 * t, t], 1)))   # edge AC
        t = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        cases.append(((va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0), np.stack([0 * t, 1 - t, t], 1)))      # edge BC
    done = np.zeros(len(P), bool)
    for m, val in cases:
        m = m & ~done; w[m] = val[m]; done |= m
    return w


def hairline_on_skin(V, F, curve, k=12):
    """curve points (same frame as V) -> skin triangle + barycentric weights. F: skin triangles (template vertex ids).
    Searches the triangles around the k nearest triangle centres; returns (points [[i0, i1, i2, w0, w1], ...], distance
    of each curve point to its triangle point, in V's units)."""
    from scipy.spatial import cKDTree
    curve = np.asarray(curve, np.float64)
    cen = V[F].mean(1)
    _, cand = cKDTree(cen).query(curve, k)                                            # (n, k) triangle ids
    n = len(curve)
    best_d = np.full(n, np.inf); best_t = np.zeros(n, np.int64); best_w = np.zeros((n, 3))
    for j in range(cand.shape[1]):
        t = cand[:, j]; A, B, C = V[F[t, 0]], V[F[t, 1]], V[F[t, 2]]
        w = closest_on_triangles(curve, A, B, C)
        q = w[:, :1] * A + w[:, 1:2] * B + w[:, 2:] * C
        d = np.linalg.norm(q - curve, axis=1)
        m = d < best_d; best_d[m] = d[m]; best_t[m] = t[m]; best_w[m] = w[m]
    pts = [[int(F[t, 0]), int(F[t, 1]), int(F[t, 2]), round(float(w[0]), 5), round(float(w[1]), 5)]
           for t, w in zip(best_t, best_w)]
    return pts, best_d


def rebuild(points, positions):
    """points -> 3D curve on `positions` (indexed by template vertex id): what the app does"""
    P = np.asarray(points, np.float64); i = P[:, :3].astype(np.int64); w0, w1 = P[:, 3:4], P[:, 4:5]
    return w0 * positions[i[:, 0]] + w1 * positions[i[:, 1]] + (1 - w0 - w1) * positions[i[:, 2]]


def extras_for(hairline_json, chosen, V, F_skin, glb_scale):
    """the head.glb metadata block, or None when the hairline was made on another fit / has no curve.
    glb_scale: V units -> glb metres (the eye-distance normalisation), for the reported error"""
    if hairline_json.get("chosen") not in (None, chosen) or not hairline_json.get("curve"):
        return None
    pts, d = hairline_on_skin(V, F_skin, hairline_json["curve"])
    return {"version": VERSION, "source": "model/hairline.json (pipeline/hairline.py)",
            "how": "point = w0*V[i0] + w1*V[i1] + (1-w0-w1)*V[i2]; V[i] = position of the glTF skin vertex with _TEMPLATE_INDEX i",
            "points": pts, "max_off_surface_mm": round(float(d.max() * glb_scale * 1000), 3)}
