"""Open the mouth of the GNM head template: the template's lips share one row of vertices (closed mouth), so a jaw drop
can only stretch them. We cut that row from mouth corner to mouth corner and give the lower lip its own copies.
Used for expression tracking (lips can part) - the neutral shape is unchanged (copies sit on the originals).

split(V, F, mat, comp, corr) -> V2, F2, mat2, comp2, corr2, info
  corr: MediaPipe-468 -> template vertex map; lower-lip landmarks on the cut are re-pointed to the lower copies.
"""
import numpy as np

LOWER_LIP = [14, 87, 178, 88, 95, 317, 402, 318, 324, 17, 84, 181, 91, 146, 314, 405, 321, 375]
UPPER_LIP = [13, 82, 81, 80, 191, 312, 311, 310, 415, 0, 37, 39, 40, 185, 267, 269, 270, 409]


def lip_path(V, F, mat, corr):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    skinF = F[(mat[F] == 0).all(1)]
    cl, cr, cm = corr[78], corr[308], corr[13]          # inner mouth corners, inner upper-lip centre
    yl = lambda x: np.interp(x, [V[cl, 0], V[cm, 0], V[cr, 0]], [V[cl, 1], V[cm, 1], V[cr, 1]])
    lo = np.minimum(V[cl], V[cr]) - [0.002, 0.008, 0.03]; hi = np.maximum(V[cl], V[cr]) + [0.002, 0.008, 0.03]
    e = np.vstack([skinF[:, [0, 1]], skinF[:, [1, 2]], skinF[:, [2, 0]]])
    inbox = ((V[e] >= lo) & (V[e] <= hi)).all(2).all(1)
    e = e[inbox]
    L = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
    off = lambda v: np.abs(V[v, 1] - yl(V[v, 0]))
    cost = L * (1 + 400 * (off(e[:, 0]) + off(e[:, 1])))   # stay on the lip-contact line
    n = len(V)
    G = coo_matrix((np.concatenate([cost, cost]), (np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]]))), shape=(n, n)).tocsr()
    path = []
    for a, b in ((cl, cm), (cm, cr)):
        _, pred = dijkstra(G, indices=a, return_predecessors=True)
        p = [b]
        while p[-1] != a and pred[p[-1]] >= 0: p.append(pred[p[-1]])
        path += p[::-1] if not path else p[::-1][1:]
    return np.array(path), yl


def split(V, F, mat, comp, corr, V_fit=None):
    """cut where the upper-lip surface (faces looking down) meets the lower-lip surface (faces looking up): the template's
    lips touch over a band that folds into the mouth, not just along the front crease."""
    path, yl = lip_path(V, F, mat, corr)
    cl, cr = V[corr[78]], V[corr[308]]
    up = np.array([0.0, 1.0, 0.0])                         # template frame: +y up
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    cen = V[F].mean(1)
    skin = (mat[F] == 0).all(1)
    xm, xM = min(cl[0], cr[0]) + 0.0015, max(cl[0], cr[0]) - 0.0015
    box = skin & (cen[:, 0] > xm) & (cen[:, 0] < xM) & (np.abs(cen[:, 1] - yl(cen[:, 0])) < 0.012) & (cen[:, 2] > 0.06)
    lower_f = box & (fn @ up > 0.05) & (cen[:, 1] < yl(cen[:, 0]) + 0.004)
    upper_f = box & ~lower_f
    vin_low = np.zeros(len(V), bool); vin_up = np.zeros(len(V), bool)
    vin_low[F[lower_f].ravel()] = True; vin_up[F[upper_f].ravel()] = True
    corner = (np.linalg.norm(V - cl, axis=1) < 0.0015) | (np.linalg.norm(V - cr, axis=1) < 0.0015)
    inner = np.where(vin_low & vin_up & ~corner)[0]
    inner = np.union1d(inner, path[1:-1])                  # the front crease too
    dup = {int(v): len(V) + k for k, v in enumerate(inner)}
    # topology decided on the TEMPLATE (its own axes: +y up, +z forward); positions may come from a fitted head
    V2 = np.vstack([V, V[inner]]); mat2 = np.concatenate([mat, mat[inner]]); comp2 = np.concatenate([comp, comp[inner]])
    F2 = F.copy()
    ins = set(dup)
    for t in np.where(skin & np.isin(F, inner).any(1))[0]:
        c = V[F[t]].mean(0)
        is_low = lower_f[t] if box[t] else (c[1] < yl(c[0]))
        if is_low:                                          # lower lip uses the copies
            F2[t] = [dup.get(int(v), int(v)) for v in F[t]]
    # inside the mouth the template continues as a closed "bag" (roof -> back -> floor). Opening the jaw would stretch it
    # into a curtain, so faces deeper than ~4 mm behind the lips are dropped (the viewer puts a dark cavity, the real
    # teeth and tongue there).
    from scipy.spatial import cKDTree
    sk = np.where(mat == 0)[0]
    cen2 = V2[F2].mean(1)
    xm2, xM2 = min(cl[0], cr[0]) - 0.004, max(cl[0], cr[0]) + 0.004
    cand = (mat2[F2] == 0).all(1) & (cen2[:, 0] > xm2) & (cen2[:, 0] < xM2) & (np.abs(cen2[:, 1] - yl(cen2[:, 0])) < 0.02) & (cen2[:, 2] > 0.04)
    deep = np.zeros(len(F2), bool)
    if cand.any():
        P2 = V[sk]; tr = cKDTree(P2[:, :2])
        idx = np.where(cand)[0]
        nbr = tr.query_ball_point(cen2[idx, :2], 0.003)
        front = np.array([P2[nb, 2].max() if len(nb) else cen2[i, 2] for nb, i in zip(nbr, idx)])
        deep[idx] = cen2[idx, 2] < front - 0.004
    F2 = F2[~deep]
    skin2 = (mat2[F2] == 0).all(1)
    # landmarks: lower-lip ids must sit on vertices of the lower lip, upper-lip ids on the upper lip
    low_faces = np.zeros(len(F2), bool)
    lowset = set(dup.values())
    low_faces = skin2 & np.isin(F2, list(lowset)).any(1)
    low_v = np.unique(F2[low_faces]); up_v = np.unique(F2[skin2 & ~low_faces])
    low_only = np.setdiff1d(low_v, up_v); up_only = np.setdiff1d(up_v, low_v)
    corr2 = np.array(corr).copy()
    for k in LOWER_LIP:
        v = int(corr2[k])
        if v in dup:
            v = dup[v] if dup[v] in set(low_v.tolist()) else int(low_only[np.argmin(np.linalg.norm(V2[low_only] - V2[v], axis=1))])
        corr2[k] = v
    for k in UPPER_LIP:
        v = int(corr2[k])
        if v in set(low_only.tolist()):
            corr2[k] = int(up_only[np.argmin(np.linalg.norm(V2[up_only] - V2[v], axis=1))])
    info_deep = int(deep.sum())
    if V_fit is not None:
        V2 = np.vstack([V_fit, V_fit[inner]])
    return V2, F2, mat2, comp2, corr2, {"path": path.tolist(), "duplicated": len(inner), "deep_faces_removed": info_deep}


if __name__ == "__main__":
    import json, os, sys
    HERE = os.path.dirname(os.path.abspath(__file__))
    d = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz"))
    corr = np.array(json.load(open(os.path.join(HERE, "..", "assets", "gnm_mp468.json")))["vertex"])
    V2, F2, mat2, comp2, corr2, info = split(d["vertices"].astype(float), d["triangles"].astype(np.int64), d["materials"], d["components"], corr)
    print(json.dumps({"duplicated": info["duplicated"], "path_len": len(info["path"]), "lm13": int(corr2[13]), "lm14": int(corr2[14])}))
