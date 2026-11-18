"""Where the teeth, gums and tongue belong in a fitted head (2026-11-12).

The fit moves only the SKIN (GNM identity + residual); the teeth have their own identity components that a capture never
sees. Until now each mouth part followed "the mean displacement of its nearest skin vertices" (gnm_fit.py / template_fit.py)
- a translation. A person's mouth is also turned and scaled against the GNM mean, and the lips' INNER surface is never
observed, so the fit squeezes or thickens it. Measured (dev recordings): the mean has 1.15 % of the eye distance of room
between the incisors' front and the lips' inner edge, fitted heads -0.6 .. +0.7 % - on one model the tooth front sat IN
FRONT of the lip's inner edge, so the lip surface cut through the tooth tips as soon as the lips parted. Teeth cannot come
through lips: the placement is the cause.

Rule (the same one the eyeballs already follow with their lid ring), in two steps:
 1 every mouth part keeps its GNM-mean SHAPE and is put where the skin around its teeth went - the similarity (scale,
   rotation, shift) that carries the skin vertices near the tooth crowns on the mean to the same vertices on the fitted head
 2 the lips keep at least the clearance they have on the mean. For every skin vertex that faces a tooth on the mean, its
   distance along that tooth's normal must stay >= the mean's (x scale); the part is shifted by the smallest translation
   that satisfies all of them (cyclic projection onto the violated constraint). After that no lip vertex is closer to a
   tooth than on the mean, where lips and teeth never intersect and the expression components move both together.

place(V, T, mat, comp, iod_T, F) -> V2 (mouth parts replaced), info
  V      fitted positions (N, 3), template vertex order (only the skin counts; the mouth parts are replaced)
  T      GNM mean positions in the same order (any frame / scale), iod_T its eye distance, F template triangles
  comp   template components: 3 = upper teeth + gums, 4 = lower teeth + gums, 5 = tongue
info per part: scale, rotation, shift of step 2, how many facing lip vertices are closer than on the mean (pipeline /
after step 1 / placed) and the worst one - numbers only.
"""
import numpy as np

PARTS = {"upper": 3, "lower": 4, "tongue": 5}
RADIUS = 0.08          # step 1: skin within this x eye distance (mean) of the tooth crowns (tongue: of the tongue)
FACING = 0.05          # step 2: skin vertices closer than this x eye distance to a tooth that faces them on the mean


def similarity(A, B):
    """s, R, t with B ~ s R A + t (Umeyama)"""
    ca, cb = A.mean(0), B.mean(0); U, S, Vt = np.linalg.svd((B - cb).T @ (A - ca)); d = np.sign(np.linalg.det(U @ Vt))
    R = U @ np.diag([1, 1, d]) @ Vt; s = (S * [1, 1, d]).sum() / ((A - ca) ** 2).sum()
    return s, R, cb - s * R @ ca


def _normals(P, F, n_all):
    n = np.zeros((n_all, 3)); c = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    for k in range(3): np.add.at(n, F[:, k], c)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-18)


def facing_pairs(T, F, mat, crown, skin, iod_T):
    """on the MEAN: skin vertex, tooth vertex, tooth normal, clearance - for every skin vertex within FACING of a tooth
    vertex whose outward normal points at it (the nearest such tooth vertex)"""
    from scipy.spatial import cKDTree
    n = _normals(T, F[np.isin(mat[F], [1]).all(1)], len(T))
    if n[crown].sum(0) @ (T[crown].mean(0) - T[skin].mean(0)) < 0: pass          # orientation is checked per pair below
    cen = T[crown].mean(0)
    if ((T[crown] - cen) * n[crown]).sum() < 0: n = -n                           # outward = away from the part's centre
    d, j = cKDTree(T[crown]).query(T[skin], k=8); sv, tv, tn, c0 = [], [], [], []
    for a, (dd, jj) in enumerate(zip(d, j)):
        q = crown[jj]; s = ((T[skin[a]] - T[q]) * n[q]).sum(1); ok = (s > 0) & (dd < FACING * iod_T)
        if ok.any():
            k = int(np.argmax(ok)); sv.append(skin[a]); tv.append(q[k]); tn.append(n[q[k]]); c0.append(s[k])
    return np.array(sv, int), np.array(tv, int), np.array(tn, float).reshape(-1, 3), np.array(c0, float)


def place(V, T, mat, comp, iod_T, F):
    from scipy.spatial import cKDTree
    V2 = np.array(V, np.float64); T = np.asarray(T, np.float64); mat = np.asarray(mat); skin = np.where(mat == 0)[0]; info = {}
    for name, cid in PARTS.items():
        part = np.where(np.asarray(comp) == cid)[0]
        if not len(part): continue
        crown = part[mat[part] == 1]; ref = crown if len(crown) else part
        d, _ = cKDTree(T[ref]).query(T[skin]); cav = skin[d < RADIUS * iod_T]
        s, R, t = similarity(T[cav], V2[cav]); old = V2[part].copy(); new = s * T[part] @ R.T + t
        row = {"skin_vertices": int(len(cav)), "scale": round(float(s), 4),
               "rotation_deg": round(float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))), 2)}
        if len(crown):
            sv, tv, tn, c0 = facing_pairs(T, F, mat, crown, skin, iod_T)
            at = {int(v): i for i, v in enumerate(part)}; ti = np.array([at[int(q)] for q in tv]); nn = tn @ R.T; need = s * c0
            clr = lambda P: ((V2[sv] - P[ti]) * nn).sum(1)
            pct = lambda x: round(100 * float(x) / (s * iod_T), 2)
            before = clr(old) - need; step1 = clr(new) - need
            # unknowns x = (shift tau, size change delta x rho): new' = c + (1 + delta)(new - c) + tau. A shift alone cannot
            # help when the person's mouth is NARROWER than the scaled mean (lips / cheeks press on both sides of the arch:
            # 2 of 3 dev models, the shift kept bouncing between the sides) - then the arch has to be smaller.
            # pair i:  n_i . tau + delta (q_i - c) . n_i <= clearance_i - need_i   (linear) -> cyclic projection from x = 0
            c = new.mean(0); rho = float(np.sqrt(((new - c) ** 2).sum(1).mean()))
            A = np.c_[nn, ((new[ti] - c) * nn).sum(1) / rho]; b0 = step1.copy(); x = np.zeros(4); it = 0
            for it in range(2000):
                r = A @ x - b0; k = int(np.argmax(r))
                if r[k] <= 1e-7 * s * iod_T: break
                x -= r[k] / (A[k] @ A[k]) * A[k]
            tau, delta = x[:3], x[3] / rho
            new = c + (1 + delta) * (new - c) + tau; after = clr(new) - need
            row.update({"facing_pairs": int(len(sv)), "shift_pct_iod": pct(np.linalg.norm(tau)), "size_change_pct": round(100 * float(delta), 2), "iterations": it,
                        "closer_than_mean": {"pipeline": int((before < 0).sum()), "similarity": int((step1 < 0).sum()), "placed": int((after < -1e-6 * s * iod_T).sum())},
                        "worst_vs_mean_pct_iod": {"pipeline": pct(before.min()), "similarity": pct(step1.min()), "placed": pct(after.min())}})
        V2[part] = new; row["moved_from_pipeline_pct_iod"] = round(100 * float(np.linalg.norm(new - old, axis=1).mean()) / (s * iod_T), 2)
        info[name] = row
    return V2, info
