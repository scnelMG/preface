"""Our own face rig ("MetaHuman-like", clean-room): jaw joint + eye joints + ARKit-named expression shapes on the GNM
template topology, driven at runtime by MediaPipe's 52 blendshape scores.

build(V_fit, lid, axes) -> rig dict (all vectors in the fitted model's frame)
  * mouth opened (lips cut, inner bag removed: pipeline/mouth_split.py)
  * jaw weight per vertex: crisp on the lips (upper 0 / lower 1, decided by geodesic distance on the cut surface),
    smooth over cheeks (biharmonic), teeth: upper 0 / lower + tongue 1
  * expression shapes (procedural v1): each shape = target displacements of MediaPipe landmarks in head axes, spread
    over the skin with biharmonic interpolation (exact at landmarks, other landmarks held). Amounts are fractions of the
    outer eye-corner distance. A data-driven version (regression on an expression video) replaces these later.
  * eye joints: eyeball centres for gaze rotation
No MetaHuman data or assets are used anywhere.
"""
import numpy as np

# MediaPipe face-mesh ids. "L"/"R" = the SUBJECT's left/right (MediaPipe's LEFT_EYE ids 263/362 are the subject's left).
EYE = {
    "L": {"up": [466, 388, 387, 386, 385, 384, 398], "lo": [249, 390, 373, 374, 380, 381, 382], "corners": [263, 362]},
    "R": {"up": [246, 161, 160, 159, 158, 157, 173], "lo": [7, 163, 144, 145, 153, 154, 155], "corners": [33, 133]},
}
BROW = {"L": {"inner": [336, 296, 285, 295], "mid": [334, 282], "outer": [300, 293, 276, 283]},
        "R": {"inner": [107, 66, 55, 65], "mid": [105, 52], "outer": [70, 63, 46, 53]}}
CORNER = {"L": 291, "R": 61}
CORNER_NB = {"L": [409, 270, 375, 321, 308, 415, 324], "R": [185, 40, 146, 91, 78, 191, 95]}
CHEEK = {"L": [425, 280, 411, 352, 376, 346], "R": [205, 50, 187, 123, 147, 117]}
ALAR = {"L": [358, 327, 294, 279], "R": [129, 98, 64, 49]}
UPPER_LIP = [0, 37, 39, 40, 185, 267, 269, 270, 409, 13, 82, 81, 80, 191, 312, 311, 310, 415]
LOWER_LIP = [17, 84, 181, 91, 146, 314, 405, 321, 375, 14, 87, 178, 88, 95, 317, 402, 318, 324]
LOWER_FACE = LOWER_LIP + [152, 148, 176, 149, 150, 136, 172, 58, 377, 400, 378, 379, 365, 397, 288, 199, 200, 175, 18,
                          201, 421, 428, 208, 32, 262, 171, 396, 140, 369, 83, 313, 106, 335, 182, 406, 194, 418, 169,
                          170, 211, 394, 395, 430, 431, 424, 204, 202, 210]


def _graph(V, F):
    from scipy.sparse import coo_matrix
    e = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    w = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1); n = len(V)
    return coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr(), e


def _bilap(n, e):
    from scipy.sparse import coo_matrix, csr_matrix
    A = coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    I = csr_matrix((np.ones(n), (np.arange(n), np.arange(n))), shape=(n, n))
    L = I - csr_matrix((1 / np.maximum(deg, 1), (np.arange(n), np.arange(n))), shape=(n, n)) @ A
    return (L.T @ L).tocsr(), deg > 0


def _solve_constrained(Bi, active, cidx, cval):
    """biharmonic interpolation on `active` vertices with values fixed at cidx (cval: (k,) or (k,d))."""
    from scipy.sparse import csr_matrix
    from scipy.sparse.linalg import splu
    n = Bi.shape[0]
    isc = np.zeros(n, bool); isc[cidx] = True
    free = np.where(active & ~isc)[0]
    Aff = Bi[free][:, free].tocsc(); Afc = Bi[free][:, cidx]
    lu = splu(Aff + 1e-9 * csr_matrix((np.ones(len(free)), (np.arange(len(free)), np.arange(len(free))))).tocsc())
    cval = np.asarray(cval, float)
    out = np.zeros((n,) + cval.shape[1:])
    out[cidx] = cval
    out[free] = lu.solve(-(Afc @ cval))
    return out


def build(V2, F2, mat2, comp2, lid, axes, iod):
    """V2/F2/mat2/comp2: mouth-split template with fitted positions; lid: 468 landmark -> vertex ids (split-aware);
    axes: dict right/up/fwd unit vectors of the head in the model frame; iod: outer eye-corner distance (model units)."""
    from scipy.sparse.csgraph import dijkstra
    RT, UP, FW = (np.asarray(axes[k], float) for k in ("right", "up", "fwd"))
    skinF = F2[(mat2[F2] == 0).all(1)]
    G, e = _graph(V2, skinF)
    Bi, active = _bilap(len(V2), e)
    L = V2[lid]
    mouth_c = (L[13] + L[14]) / 2
    # ---- jaw weights: crisp lips, smooth cheeks
    lo_src = np.unique(lid[LOWER_LIP]); up_src = np.unique(lid[UPPER_LIP])
    d_lo = dijkstra(G, indices=lo_src, min_only=True); d_up = dijkstra(G, indices=up_src, min_only=True)
    zone = active & (np.linalg.norm(V2 - mouth_c, axis=1) < 0.42 * iod)
    zone_v = np.where(zone)[0]
    zval = (d_lo[zone_v] < d_up[zone_v]).astype(float)
    lm_v = np.unique(lid); lm_v = lm_v[~zone[lm_v]]
    lowset = set(lid[LOWER_FACE].tolist())
    lm_val = np.array([1.0 if v in lowset else 0.0 for v in lm_v])
    cidx = np.concatenate([zone_v, lm_v]); cval = np.concatenate([zval, lm_val])
    jw = np.clip(_solve_constrained(Bi, active, cidx, cval), 0, 1)
    dmin = dijkstra(G, indices=np.unique(lid), min_only=True)
    fall = np.clip(1 - dmin / (0.8 * iod), 0, 1) ** 0.5
    jw = jw * fall
    eye = np.isin(mat2, [4, 5, 6]); jw[eye] = 0
    jw[comp2 == 3] = 0; jw[np.isin(comp2, [4, 5])] = 1.0
    hinge = (L[234] + L[454]) / 2 - FW * 0.30 * iod - UP * 0.05 * iod
    # ---- expression shapes: landmark targets -> biharmonic spread (other landmarks held at 0)
    ctrl = np.unique(lid)
    cpos = {int(v): i for i, v in enumerate(ctrl)}

    def side_out(k):  # unit vector pointing away from the face midline at landmark k
        return RT * np.sign((L[k] - mouth_c) @ RT)

    s = iod  # amounts below are fractions of the outer eye-corner distance
    T = {}

    def put(name, k, d):
        T.setdefault(name, {})
        T[name][int(lid[k])] = T[name].get(int(lid[k]), 0) + d

    for S in ("L", "R"):
        ey = EYE[S]
        for u, l in zip(ey["up"], ey["lo"]):
            gap = L[l] - L[u]
            put(f"eyeBlink{'Left' if S == 'L' else 'Right'}", u, gap * 0.95 + FW * 0.018 * s)
            put(f"eyeBlink{'Left' if S == 'L' else 'Right'}", l, -gap * 0.08)
            put(f"eyeSquint{'Left' if S == 'L' else 'Right'}", l, -gap * 0.30)
            put(f"eyeSquint{'Left' if S == 'L' else 'Right'}", u, gap * 0.12)
            put(f"eyeWide{'Left' if S == 'L' else 'Right'}", u, -gap * 0.30)
        side = "Left" if S == "L" else "Right"
        for k in BROW[S]["inner"]: put("browInnerUp", k, UP * 0.035 * s)
        for k in BROW[S]["inner"] + BROW[S]["mid"] + BROW[S]["outer"]:
            put(f"browDown{side}", k, -UP * 0.030 * s - side_out(k) * 0.008 * s * (k in BROW[S]["inner"]))
        for k in BROW[S]["outer"]: put(f"browOuterUp{side}", k, UP * 0.035 * s)
        for k in BROW[S]["mid"]: put(f"browOuterUp{side}", k, UP * 0.015 * s)
        c = CORNER[S]
        put(f"mouthSmile{side}", c, UP * 0.055 * s + side_out(c) * 0.035 * s - FW * 0.015 * s)
        for k in CORNER_NB[S]: put(f"mouthSmile{side}", k, UP * 0.025 * s + side_out(k) * 0.015 * s)
        for k in CHEEK[S]: put(f"mouthSmile{side}", k, UP * 0.020 * s + FW * 0.008 * s)
        put(f"mouthFrown{side}", c, -UP * 0.040 * s)
        for k in CORNER_NB[S]: put(f"mouthFrown{side}", k, -UP * 0.015 * s)
        put(f"mouthStretch{side}", c, side_out(c) * 0.040 * s - UP * 0.010 * s)
        put(f"mouthDimple{side}", c, side_out(c) * 0.020 * s - FW * 0.010 * s)
        for k in CHEEK[S]: put(f"cheekSquint{side}", k, UP * 0.020 * s)
        for k in ALAR[S]: put(f"noseSneer{side}", k, UP * 0.020 * s)
        for k in CHEEK[S][:3]: put("cheekPuff", k, side_out(k) * 0.040 * s + FW * 0.010 * s)
        lower_side = [k for k in LOWER_LIP if np.sign((L[k] - mouth_c) @ RT) == np.sign((L[CORNER[S]] - mouth_c) @ RT)]
        for k in lower_side: put(f"mouthLowerDown{side}", k, -UP * 0.030 * s)
        upper_side = [k for k in UPPER_LIP if np.sign((L[k] - mouth_c) @ RT) == np.sign((L[CORNER[S]] - mouth_c) @ RT)]
        for k in upper_side: put(f"mouthUpperUp{side}", k, UP * 0.025 * s)
    for k in UPPER_LIP + LOWER_LIP:
        put("mouthPucker", k, FW * 0.030 * s - (L[k] - mouth_c) * 0.25)
        put("mouthFunnel", k, FW * 0.035 * s + (L[k] - mouth_c) * 0.10 * (k in (13, 14, 82, 87, 312, 317)))
    for k in UPPER_LIP + LOWER_LIP + [61, 291]:
        put("mouthLeft", k, RT * np.sign((L[291] - mouth_c) @ RT) * 0.030 * s)
        put("mouthRight", k, RT * np.sign((L[61] - mouth_c) @ RT) * 0.030 * s)
    for k in [61, 291]:
        put("mouthPucker", k, -side_out(k) * 0.030 * s)
        put("mouthFunnel", k, -side_out(k) * 0.025 * s)
    for k in LOWER_LIP: put("mouthRollLower", k, -FW * 0.020 * s + UP * 0.010 * s)
    for k in UPPER_LIP: put("mouthRollUpper", k, -FW * 0.020 * s - UP * 0.008 * s)
    for k in LOWER_LIP + [152, 175, 199, 200]: put("mouthShrugLower", k, UP * 0.020 * s + FW * 0.010 * s)
    for k in UPPER_LIP: put("mouthShrugUpper", k, UP * 0.012 * s)
    for k in LOWER_LIP: put("mouthClose", k, UP * 0.060 * s)          # used with jawOpen: lips together
    for k in LOWER_LIP + UPPER_LIP: put("mouthPress" + "Left", k, -FW * 0.008 * s)
    # ---- eye EDIT shapes (surgery-style, symmetric; sliders in the viewer, original-relative)
    CREASE = {"R": [225, 224, 223, 222, 221], "L": [445, 444, 443, 442, 441]}       # ring above the upper lid
    UNDER = {"R": [230, 229, 228, 231, 232], "L": [450, 449, 448, 451, 452]}        # ring below the lower lid
    for S in ("L", "R"):
        ey = EYE[S]
        inner, outer = ey["corners"][1], ey["corners"][0]
        for u, l in zip(ey["up"], ey["lo"]):
            gap = L[l] - L[u]
            put("edit_eyeOpen", u, -gap * 0.25)                                    # 눈매교정: 윗눈꺼풀 올림
        med = -side_out(inner)                                                     # toward the nose
        put("edit_innerCorner", inner, med * 0.035 * s)                            # 앞트임
        for k in (ey["up"][-1], ey["lo"][-1]): put("edit_innerCorner", k, med * 0.015 * s)
        put("edit_outerCorner", outer, side_out(outer) * 0.035 * s)                # 뒤트임
        for k in (ey["up"][0], ey["lo"][0]): put("edit_outerCorner", k, side_out(outer) * 0.015 * s)
        put("edit_canthalTilt", outer, UP * 0.030 * s)                             # 눈꼬리 올림
        for k in (ey["up"][0], ey["up"][1], ey["lo"][0], ey["lo"][1]): put("edit_canthalTilt", k, UP * 0.015 * s)
        for k in CREASE[S][1:-1]: put("edit_doubleLid", k, -FW * 0.012 * s)        # 쌍꺼풀 라인 (접힘 홈)
        for k in ey["up"][1:-1]: put("edit_doubleLid", k, FW * 0.004 * s)          # 라인 아래 눈꺼풀 살짝 앞으로
        for k in CREASE[S]: put("edit_lidFullness", k, FW * 0.015 * s)            # 눈두덩 볼륨 (+ 도톰 / - 꺼짐)
        for k in UNDER[S][1:-1]: put("edit_aegyo", k, FW * 0.012 * s + UP * 0.004 * s)  # 애교살
    names = sorted(T)
    # one biharmonic solve for all shapes at once (3 columns each)
    C = np.zeros((len(ctrl), 3 * len(names)))
    for j, nm in enumerate(names):
        for v, d in T[nm].items():
            C[cpos[v], 3 * j:3 * j + 3] = d
    D = _solve_constrained(Bi, active, ctrl, C) * fall[:, None]
    D[eye] = 0; D[np.isin(comp2, [3, 4, 5])] = 0
    shapes = {}
    for j, nm in enumerate(names):
        d = D[:, 3 * j:3 * j + 3]
        idx = np.where(np.linalg.norm(d, axis=1) > 1e-4 * iod)[0]
        shapes[nm] = {"idx": idx.astype(np.int32), "d": d[idx].astype(np.float32)}
    # eye joints: eyeball centres (components 1 and 2), and which is the subject's left
    eyes = {}
    for cid in (1, 2):
        ids = np.where(comp2 == cid)[0]
        if len(ids):
            cen = V2[ids].mean(0)
            eyes["L" if (cen - mouth_c) @ RT * np.sign((L[263] - mouth_c) @ RT) > 0 else "R"] = {"comp": cid, "center": cen.tolist()}
    return {"jaw": {"w": jw.astype(np.float32), "hinge": hinge, "axis": RT, "max_deg": 24.0},
            "shapes": shapes, "eyes": eyes, "axes": {"right": RT.tolist(), "up": UP.tolist(), "fwd": FW.tolist()}}
