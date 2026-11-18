"""Bake UV textures for a template-topology (GNM) mesh from the capture frames (multi-view, visibility-tested).

usage: python uv_bake.py <fitted.ply> <sparseModel> <imagesDir> <out_prefix> [--size 2048] [--every 2] [--poses frame_poses.json]
writes <out>_skin.png, <out>_eye.png, <out>_iris.png, <out>.obj + .mtl (+ .bake.json report)
per texel: 3D point by barycentric interpolation in the template UV layout -> every frame where it faces the camera and is
not occluded (coarse z-buffer of the whole mesh in that frame) contributes with weight cos^6 -> weighted mean.
Per-frame exposure/white-balance gains (webcam auto exposure changes while the head turns) are solved first so that frames
agree on shared texels. Texels no frame saw are filled from neighbours (cv2.inpaint) and counted in the report.
--poses: corrected / dropped frames from frame_check.py (frames whose SfM pose does not put the model on the person).
"""
import argparse, json, os, sys, threading, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import meshio  # noqa: E402
import bake_gpu  # noqa: E402
TEMPLATE = os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")
# GNM materials: 0 skin, 1-3 mouth interior, 4 eyeballs, 5 iris disc, 6 pupil disc
GROUPS = [("skin", [0], 1.0), ("eye", [4], 0.5), ("iris", [5, 6], 0.25)]


_LAYOUT = {}
CACHE = os.path.join(HERE, "..", "assets", "cache")


def raster_layout(S, tris, UV, UT):
    """texel -> (triangle, barycentric weights) of the template UV layout. It depends on the template only (not on the
    fitted shape), so it is computed once and cached (memory + assets/cache): the per-triangle loop took ~15 s per bake.
    Same rule as the old per-triangle raster: triangles in order, a later triangle overwrites shared border texels."""
    import hashlib
    h = hashlib.sha1(np.ascontiguousarray(UV).tobytes() + np.ascontiguousarray(UT).tobytes()
                     + np.ascontiguousarray(tris, np.int64).tobytes() + str(S).encode()).hexdigest()[:16]
    if h in _LAYOUT: return _LAYOUT[h]
    fn = os.path.join(CACHE, f"uv_layout_{S}_{h}.npz")
    if os.path.exists(fn):
        try:
            z = np.load(fn); _LAYOUT[h] = (z["py"], z["px"], z["tri"], z["w"]); return _LAYOUT[h]
        except Exception:
            pass
    PY, PX, TT, WW = [], [], [], []
    for t in tris:
        uv = UV[UT[t]] * (S - 1); uv[:, 1] = (S - 1) - uv[:, 1]
        x0, y0 = np.floor(uv.min(0)).astype(int); x1, y1 = np.ceil(uv.max(0)).astype(int)
        if x1 < 0 or y1 < 0 or x0 >= S or y0 >= S: continue
        xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1, S - 1) + 1), np.arange(max(y0, 0), min(y1, S - 1) + 1))
        pts = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
        T = np.array([uv[1] - uv[0], uv[2] - uv[0]]).T
        if abs(np.linalg.det(T)) < 1e-12: continue
        bc = np.linalg.solve(T, (pts - uv[0]).T).T
        w = np.stack([1 - bc.sum(1), bc[:, 0], bc[:, 1]], 1)
        inside = (w >= -1e-6).all(1)
        if not inside.any(): continue
        pts = pts[inside].astype(int)
        PY.append(pts[:, 1]); PX.append(pts[:, 0]); TT.append(np.full(inside.sum(), t)); WW.append(w[inside])
    py, px, tt, ww = np.concatenate(PY), np.concatenate(PX), np.concatenate(TT), np.concatenate(WW)
    lin = py * S + px
    _, first_rev = np.unique(lin[::-1], return_index=True)     # last write wins
    keep = np.sort(len(lin) - 1 - first_rev)
    lay = (py[keep].astype(np.int32), px[keep].astype(np.int32), tt[keep].astype(np.int32), ww[keep])
    try:
        os.makedirs(CACHE, exist_ok=True); tmp = fn + ".tmp.npz"
        np.savez(tmp, py=lay[0], px=lay[1], tri=lay[2], w=lay[3]); os.replace(tmp, fn)
    except OSError:
        pass
    _LAYOUT[h] = lay
    return lay


def eye_front_last(tris, Vt, F, mat, comp):
    """Order of eye / iris triangles for raster_layout (S15P31B204-569). Both eyes and the front / back of each ball share
    their UV texels (template: eyeball texels 100 % shared by the two eyes, 79 % folded within one ball; iris 100 % /
    44 %), and raster_layout keeps the LAST triangle per texel. The template order often put a back face or the other
    eye last -> the photo colour of a hidden point was baked onto the visible front: triangle-shaped patches. Here: the
    second eye first, then the first eye; within an eye back -> front along its gaze (template shape, fit-independent),
    so every shared texel samples the first eye's FRONT surface."""
    first = comp[F[tris, 0]]
    out = [tris[~np.isin(first, [1, 2])]]
    for cid in (2, 1):
        t = tris[first == cid]
        eb = np.where((comp == cid) & (mat == 4))[0]; ir = np.where((comp == cid) & np.isin(mat, [5, 6]))[0]
        if len(t) and len(eb) >= 20 and len(ir):
            c = np.linalg.lstsq(np.c_[2 * Vt[eb], np.ones(len(eb))], (Vt[eb] ** 2).sum(1), rcond=None)[0][:3]   # ball centre
            fwd = Vt[ir].mean(0) - c                                                                             # -> iris
            t = t[np.argsort(((Vt[F[t]] - c) @ fwd).mean(1), kind="stable")]
        out.append(t)
    return np.concatenate(out)


def raster(S, tris, V, vn, F, UV, UT):
    """UV image of the 3D position P and normal N (NaN / 0 outside the layout)"""
    py, px, tt, w = raster_layout(S, tris, UV, UT)
    P = np.full((S, S, 3), np.nan); N = np.zeros((S, S, 3))
    Ft = F[tt]
    P[py, px] = np.einsum("ij,ijk->ik", w, V[Ft]); N[py, px] = np.einsum("ij,ijk->ik", w, vn[Ft])
    return P, N


def mv_light_correct(samples, Rs, allP, allN, n0, chin, upv, hgt, dev=None):
    """Capture lighting removed from every sample BEFORE blending (2026-10-15, eun01 blotchy lower face).
    The same skin point is seen in many frames under different light angles (the person turns, the room light does not):
    averaging those samples mixes bright and dark versions -> blotches where the frame mix changes (nose, mouth, jaw).
    Model per sample: lum = A[texel] * g[frame] * (c0 + L . n), n = surface normal in the CAMERA frame (light moves with
    the camera when the person turns) or in the HEAD frame (camera orbits a still person); both are fitted on face-skin
    texels, the better one is used. 1st order + ridge (2nd order was ill-conditioned on a head turn). Every skin sample
    is divided by its predicted shading (in linear light), so all frames agree before the blend.
    dev (torch device, S15P31B204-69): the texel sums and the light fit on the GPU in float64 (bake_gpu.py); the skin masks
    and the per-sample correction below are the same code on both paths."""
    import cv2
    N = len(allP); hr = ((allP - chin) @ upv) / hgt
    if dev is not None:
        ref, ws = bake_gpu.texel_mean(samples, N, dev)
    else:
        acc = np.zeros((N, 3)); ws = np.zeros(N)
        for idx, c, w, cs in samples: acc[idx] += c * w[:, None]; ws[idx] += w        # idx unique per frame
        ref = (acc / np.maximum(ws, 1e-9)[:, None]).astype(np.float32)
    lab = cv2.cvtColor(np.clip(ref, 0, 255).astype(np.uint8)[None], cv2.COLOR_BGR2LAB)[0].astype(np.float32)
    face = (np.arange(N) < n0) & (hr > 0.05) & (hr < 0.95) & (ws > 1e-3)
    if face.sum() < 2000: return None
    Lr, Ar, Br = lab[:, 0], lab[:, 1], lab[:, 2]
    a0, b0, L0 = np.median(Ar[face]), np.median(Br[face]), np.median(Lr[face])
    skin = face & (np.abs(Ar - a0) < 10) & (np.abs(Br - b0) < 12) & (Lr > 0.55 * L0)
    sub = skin & (np.arange(N) % 8 == 0)            # subset: the light has 4 parameters (memory on 2048 maps)
    lumw = np.array([0.0722, 0.7152, 0.2126])          # BGR -> linear luminance
    I, Y, Wt, Nc, Nh, Fi = [], [], [], [], [], []
    for k, ((idx, c, w, cs), R) in enumerate(zip(samples, Rs)):
        m = sub[idx] & (cs > 0.6)
        if m.sum() < 200: continue
        I.append(idx[m]); Y.append(np.power(np.clip(c[m] / 255, 1e-3, 1), 2.2) @ lumw); Wt.append(w[m])
        Nh.append(allN[idx[m]]); Nc.append(allN[idx[m]] @ np.asarray(R).T * np.array([1, -1, -1])); Fi.append(np.full(m.sum(), k))
    if not I: return None
    I = np.concatenate(I); Y = np.maximum(np.concatenate(Y), 1e-3); Wt = np.concatenate(Wt); Fi = np.concatenate(Fi)
    nF = len(samples)
    fs = np.searchsorted(Fi, np.arange(nF + 1))          # Fi is ascending: frame j = samples fs[j]:fs[j + 1]
    def fit(nv):
        X = np.c_[np.ones(len(I)), nv]; g = np.ones(nF)
        A = np.bincount(I, Wt * Y, N) / np.maximum(np.bincount(I, Wt, N), 1e-9); coef = None
        for _ in range(8):
            y = Y / (g[Fi] * np.maximum(A[I], 1e-4)); rw = Wt.copy()
            if coef is not None:
                r = np.log(np.maximum(X @ coef, 1e-3)) - np.log(y); sc = 1.4826 * np.median(np.abs(r)) + 1e-6; rw = rw / (1 + (r / (2 * sc)) ** 2)
            lam = 0.02 * rw.sum(); Rg = np.zeros((3, 4)); Rg[:, 1:] = np.eye(3) * np.sqrt(lam)
            coef = np.linalg.lstsq(np.r_[X * np.sqrt(rw)[:, None], Rg], np.r_[y * np.sqrt(rw), np.zeros(3)], rcond=None)[0]
            s_ = np.maximum(X @ coef, 0.05)
            A = np.bincount(I, Wt * Y / g[Fi] * s_, N) / np.maximum(np.bincount(I, Wt * s_ * s_, N), 1e-9)
            q = Y / np.maximum(A[I] * s_, 1e-4)
            g = np.array([np.median(q[fs[j]:fs[j + 1]]) if fs[j + 1] - fs[j] > 100 else 1.0 for j in range(nF)]); g /= np.median(g)
        res = np.log(Y) - np.log(g[Fi] * np.maximum(A[I], 1e-4) * np.maximum(X @ coef, 0.05))
        return coef, float(np.sqrt(np.average(res ** 2, weights=Wt)))
    Nc = np.concatenate(Nc); Nh = np.concatenate(Nh)
    fit_ = fit if dev is None else (lambda nv: bake_gpu.light_fit(I, Y, Wt, Fi, fs, nv, N, nF, dev))
    fits = {"camera": fit_(Nc), "head": fit_(Nh)}
    mode = min(fits, key=lambda m_: fits[m_][1]); coef = fits[mode][0]
    def shade_of(idx, R):
        n = allN[idx] if mode == "head" else allN[idx] @ np.asarray(R).T * np.array([1, -1, -1])
        return np.maximum(n.astype(np.float32) @ coef[1:].astype(np.float32) + np.float32(coef[0]), 0.05)
    sref = float(np.median(np.concatenate([shade_of(idx[skin[idx]][::7], R) for (idx, c, w, cs), R in zip(samples, Rs)])))
    for (idx, c, w, cs), R in zip(samples, Rs):                     # memory: one frame at a time
        sk = idx < n0
        ratio = np.clip(shade_of(idx[sk], R) / sref, 0.6, 1.6)
        c[sk] = c[sk] / np.power(ratio, 1 / 2.2)[:, None]            # linear-light division on sRGB values
    return {"mode": mode, "residual_camera": round(fits["camera"][1], 4), "residual_head": round(fits["head"][1], 4),
            "coef": [round(float(x), 4) for x in coef], "skin_texels": int(skin.sum())}


# MediaPipe landmark rings protected from skin evening (their colour is not skin): outer lips, eyes, eyebrows
LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185]
EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
BROW_L = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
BROW_R = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]


def protect_uv_mask(S, V, F, UV, UT, ids):
    """UV mask of lips, eyes and brows (polygons of the landmark rings; lips / eyes: convex hull, slightly enlarged).
    Brows: the ring in its own order (upper edge outer -> inner, lower edge inner -> outer) = the brow outline, not its
    convex hull. The hull (x1.25) also covered the skin under the brow arch (+67-101 % of the brow), which skin evening /
    occlusion lift then skipped while the skin around was lifted: a dark band under the brows (S15P31B204-413, 11/06)."""
    import cv2
    vuv = np.zeros((len(V), 2)); vuv[F.ravel()] = UV[UT.ravel()]
    m = np.zeros((S, S), np.uint8)
    for ring, grow, hull in ((LIPS, 1.12, True), (EYE_L, 1.35, True), (EYE_R, 1.35, True), (BROW_L, 1.0, False), (BROW_R, 1.0, False)):
        q = vuv[[ids[i] for i in ring]] * (S - 1); q[:, 1] = (S - 1) - q[:, 1]
        c = q.mean(0); q = c + (q - c) * grow
        p = np.round(q).astype(np.int32)
        cv2.fillPoly(m, [cv2.convexHull(p) if hull else p], 255)
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 0.004 * S)


def skin_mask_lab(lab, fimg, protect):
    import cv2
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    ref = fimg & (L > np.percentile(L[fimg], 30)) & (protect < 0.1)
    a0, b0, L0 = np.median(A[ref]), np.median(B[ref]), np.median(L[ref])
    skin = fimg & (np.abs(A - a0) < 14) & (np.abs(B - b0) < 14) & (L > 0.5 * L0) & (protect < 0.5)
    return cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0


def occlusion_lift(tex8, AO, valid, face_seen, protect, strength, rep):
    """Remove the skin shading that the mesh's AMBIENT OCCLUSION explains (2026-10-16).
    Concave places get less light from every direction, so they are dark in every frame and the per-frame lighting
    model cannot take it out (eun02: under the nose 0.70-0.76 of the cheek at every head pitch). Per texel, the
    local darkening of the skin, log(mid / broad), is regressed on the local darkening of the AO, log(AO_mid / AO_broad),
    over the whole face (robust, through 0): the slope beta says how strongly occlusion darkened THIS capture. Then
    exactly that explained part is divided out where the AO is below its surroundings. Colour (a, b) kept."""
    import cv2
    S = tex8.shape[0]
    fimg = np.zeros((S, S), bool); fimg[valid] = face_seen
    lab = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB).astype(np.float32); L = lab[..., 0]
    skin = skin_mask_lab(lab, fimg, protect); m = skin.astype(np.float32)
    def nb(X, wgt, sg):
        q = 4 if sg > 0.01 * S else 1; sm_ = (S // q, S // q)
        Xs = cv2.resize(X * wgt, sm_, interpolation=cv2.INTER_AREA); Ws = cv2.resize(wgt, sm_, interpolation=cv2.INTER_AREA)
        r = cv2.GaussianBlur(Xs, (0, 0), sg / q) / np.maximum(cv2.GaussianBlur(Ws, (0, 0), sg / q), 1e-3)
        return cv2.resize(r, (S, S), interpolation=cv2.INTER_LINEAR) if q > 1 else r
    sb, sm = 0.03 * S, 0.004 * S
    AOf = np.clip(AO.astype(np.float32), 0.05, 1.0)
    aoB, aoM = nb(AOf, m, sb), nb(AOf, m, sm)
    LB, LM = nb(L, m, sb), nb(L, m, sm)
    for _ in range(2): LB = nb(L, m * (LM > 0.9 * LB), sb)          # broad tone not pulled down by the shadows
    # occlusion against the OPEN skin (75th percentile of the face AO), not against the local surroundings: the
    # whole strip under the nose is one broad AO valley, so a local ratio saw ~0 there (eun02: AO 0.57 vs cheek 0.73)
    ao_ref = float(np.percentile(AOf[skin], 75))
    LW = nb(L, m, 0.08 * S)                                              # wide skin tone (8 % of the map)
    for _ in range(2): LW = nb(L, m * (LM > 0.9 * LW), 0.08 * S)
    aa = np.log(np.minimum(aoM, ao_ref) / ao_ref); rr = np.log(np.maximum(LM, 1) / np.maximum(LW, 1))
    sel = skin & (aa < -0.02)
    if sel.sum() < 500:
        rep["occlusion"] = {"applied": False, "occluded_texels": int(sel.sum())}; return tex8
    x, y = aa[sel], rr[sel]; beta = float(np.sum(x * y) / np.sum(x * x))
    for _ in range(4):                                                    # robust through-origin slope
        res = y - beta * x; sc = 1.4826 * np.median(np.abs(res)) + 1e-6; w = 1 / (1 + (res / (2 * sc)) ** 2)
        beta = float(np.sum(w * x * y) / np.sum(w * x * x))
    beta = float(np.clip(beta, 0.0, 1.5))
    corr = np.exp(-strength * beta * np.minimum(aa, 0.0))
    corr = np.clip(corr, 1.0, 1.6)
    # deep cavities (nostril insides, AO < 0.4) are really dark: not lifted (a lift there showed bright nostrils)
    corr = 1 + (corr - 1) * np.clip((aoM - 0.40) / 0.10, 0, 1)
    wgt = cv2.GaussianBlur(m, (0, 0), 0.002 * S) * (1 - protect)
    lab[..., 0] = np.clip(L * (1 + (corr - 1) * wgt), 0, 255)
    out = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    rep["occlusion"] = {"applied": True, "beta": round(beta, 3), "ao_ref": round(ao_ref, 3), "occluded_texels": int(sel.sum()),
                        "lift_p50_p95_max": [round(float(np.percentile(corr[sel], q)), 3) for q in (50, 95)] + [round(float(corr[sel].max()), 3)]}
    return out


def skin_even(tex8, valid, face_seen, strength, protect, rep):
    """Even out BLOTCHY skin (2026-10-15, eun01 phone capture: nose / mouth / jaw looked patchy).
    Three scales of the skin (Lab): broad tone (sigma 3 % of the map) / mid (0.4 %) / detail. The mid-scale deviation from
    the broad tone (redness patches, dark circles, fold shadows, exposure seams) is reduced by `strength`; the detail
    (pores, fine lines, moles) and the broad skin tone are kept. Lips / eyes / brows / nostrils / hair are masked out."""
    import cv2
    S = tex8.shape[0]
    fimg = np.zeros((S, S), bool); fimg[valid] = face_seen
    lab = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    ref = fimg & (L > np.percentile(L[fimg], 30)) & (protect < 0.1)
    a0, b0, L0 = np.median(A[ref]), np.median(B[ref]), np.median(L[ref])
    skin = fimg & (np.abs(A - a0) < 14) & (np.abs(B - b0) < 14) & (L > 0.5 * L0) & (protect < 0.5)
    skin = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    m = skin.astype(np.float32)
    nb = lambda X, sg: cv2.GaussianBlur(X * m, (0, 0), sg) / np.maximum(cv2.GaussianBlur(m, (0, 0), sg), 1e-3)
    sb, sm = 0.03 * S, 0.004 * S
    w = cv2.GaussianBlur(m, (0, 0), 0.002 * S) * (1 - protect)
    def nb_big(X, wgt, sg):                         # wide blur on a 4x smaller map (same result, ~16x faster)
        q = 4; sm_ = (S // q, S // q)
        Xs = cv2.resize(X * wgt, sm_, interpolation=cv2.INTER_AREA); Ws = cv2.resize(wgt, sm_, interpolation=cv2.INTER_AREA)
        r = cv2.GaussianBlur(Xs, (0, 0), sg / q) / np.maximum(cv2.GaussianBlur(Ws, (0, 0), sg / q), 1e-3)
        return cv2.resize(r, (S, S), interpolation=cv2.INTER_LINEAR)
    baseL, midL = nb_big(L, m, sb), nb(L, sm)
    # robust broad tone: shadow pixels (well below the broad tone) do not pull the tone down (nose-side shadow is ~3 % of
    # the map wide, the same size as the tone blur -> the tone itself was darkened there and the lift too small)
    for _ in range(2):
        baseL = nb_big(L, m * (midL > 0.9 * baseL), sb)
    gain = np.clip((baseL / np.maximum(midL, 1)) ** strength, 0.75, 1.5)
    lab[..., 0] = np.clip(L * (1 + (gain - 1) * w), 0, 255)
    for ch, X in ((1, A), (2, B)):                                    # chroma: shift the mid-scale patch toward the tone
        d = nb(X, sm) - nb_big(X, m, sb)
        lab[..., ch] = X - 0.6 * strength * d * w                       # milder on colour: natural flush (cheeks) stays
    out = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    rep["skin_even"] = {"strength": strength, "skin_texels": int(skin.sum()),
                        "L_gain_p5_p95": [round(float(np.percentile(gain[skin], 5)), 3), round(float(np.percentile(gain[skin], 95)), 3)]}
    return out


def _sh9(n):
    x, y, z = n[..., 0], n[..., 1], n[..., 2]
    return np.stack([np.ones_like(x), x, y, z, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y], -1)


def albedo_from_texture(tex8, valid, V, F, UV, UT, tris, ao, face_seen, prot, rep, highlight=0.4):
    """Skin ALBEDO map = the baked colour with the remaining capture lighting divided out (2026-10-16, "MetaHuman-like":
    the viewer then lights the albedo itself, so the face gets its shading from its own 3D form, not from the photos).
      1. smooth surface normals (mesh smoothed: the shading is low-frequency, pores and mesh facets must not enter it)
      2. robust fit on the skin: linear luminance ~ c * AO + SH2(n) . L  (10 numbers for the whole face)
      3. shading = that model, normalised to median 1 on the skin, clipped 0.6-1.6, blurred; divided out (luminance
         only: hue and saturation of the skin stay) inside the photographed face region, feathered
      4. shine: luminance clearly above the local skin tone (nose tip, forehead) compressed
    Returns the albedo (uint8 BGR, same layout as tex8)."""
    import cv2
    from scipy.sparse import coo_matrix
    S = tex8.shape[0]; S2 = S // 2
    e = np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]
    Aj = coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(len(V), len(V))).tocsr()
    deg = np.asarray(Aj.sum(1)).ravel() + 1; Vs = V.copy()
    for _ in range(15): Vs = (Aj @ Vs + Vs) / deg[:, None]
    fn = np.cross(Vs[F[:, 1]] - Vs[F[:, 0]], Vs[F[:, 2]] - Vs[F[:, 0]]); vs = np.zeros_like(Vs)
    for k in range(3): np.add.at(vs, F[:, k], fn)
    vs /= np.linalg.norm(vs, axis=1, keepdims=True) + 1e-12
    if ((V - V.mean(0)) * vs).sum(1).mean() < 0: vs = -vs
    P2, N2 = raster(S2, tris, V, vs, F, UV, UT)
    A2, _ = raster(S2, tris, np.c_[ao, ao, ao], vs, F, UV, UT)
    v2 = ~np.isnan(P2[..., 0]); N2[v2] /= np.linalg.norm(N2[v2], axis=1, keepdims=True) + 1e-12
    t2 = cv2.resize(tex8, (S2, S2), interpolation=cv2.INTER_AREA)
    fimg = np.zeros((S, S), np.uint8); fimg[valid] = face_seen
    f2 = cv2.resize(fimg, (S2, S2), interpolation=cv2.INTER_NEAREST) > 0
    pr2 = cv2.resize(prot, (S2, S2), interpolation=cv2.INTER_AREA)
    lab2 = cv2.cvtColor(t2, cv2.COLOR_BGR2LAB).astype(np.float32)
    skin = skin_mask_lab(lab2, f2 & v2, pr2) & v2
    if skin.sum() < 3000:
        rep["albedo"] = {"applied": False, "skin_texels": int(skin.sum())}; return tex8.copy()
    lw = np.array([0.0722, 0.7152, 0.2126])
    lum = (np.power(t2.astype(np.float32) / 255, 2.2) @ lw)
    aoc = np.nan_to_num(A2[..., 0], nan=1.0)
    X = np.c_[aoc[skin], _sh9(N2[skin])]; y = lum[skin]; wt = np.ones(len(y))
    sub = np.arange(len(y)) % max(1, len(y) // 60000) == 0
    for _ in range(8):
        coef = np.linalg.lstsq(X[sub] * np.sqrt(wt[sub])[:, None], y[sub] * np.sqrt(wt[sub]), rcond=None)[0]
        r = y - X @ coef; sc = 1.4826 * np.median(np.abs(r)) + 1e-6; wt = 1 / (1 + (r / (2 * sc)) ** 2)
    if coef[0] < 0:                                   # AO collinear with the constant: drop it rather than invert it
        X = X[:, 1:]; wt = np.ones(len(y))
        for _ in range(8):
            c2 = np.linalg.lstsq(X[sub] * np.sqrt(wt[sub])[:, None], y[sub] * np.sqrt(wt[sub]), rcond=None)[0]
            r = y - X @ c2; sc = 1.4826 * np.median(np.abs(r)) + 1e-6; wt = 1 / (1 + (r / (2 * sc)) ** 2)
        coef = np.r_[0.0, c2]
    r2 = 1 - np.var(y - np.c_[aoc[skin], _sh9(N2[skin])] @ coef) / np.var(y)
    shade = np.ones((S2, S2), np.float32)
    shade[v2] = np.c_[aoc[v2], _sh9(N2[v2])] @ coef
    shade = np.clip(shade / np.median(shade[skin]), 0.6, 1.6)
    m = (f2 & v2).astype(np.float32)
    sm = cv2.GaussianBlur(shade * m, (0, 0), 0.006 * S2) / np.maximum(cv2.GaussianBlur(m, (0, 0), 0.006 * S2), 1e-3)
    feather = cv2.GaussianBlur(m, (0, 0), 0.01 * S2)
    s_app = 1 + (np.where(m > 0, sm, 1) - 1) * feather
    s_full = cv2.resize(s_app, (S, S), interpolation=cv2.INTER_LINEAR)
    lin = np.power(tex8.astype(np.float32) / 255, 2.2) / s_full[..., None]
    alb = (np.power(np.clip(lin, 0, 1), 1 / 2.2) * 255).astype(np.uint8)
    # shine: compress luminance well above the local skin tone (specular highlight is not skin colour)
    lab = cv2.cvtColor(alb, cv2.COLOR_BGR2LAB).astype(np.float32); L = lab[..., 0]
    fbig = cv2.resize(m, (S, S), interpolation=cv2.INTER_LINEAR) > 0.5
    sk = skin_mask_lab(lab, fbig & valid, prot)
    mk = sk.astype(np.float32)
    base = cv2.GaussianBlur(L * mk, (0, 0), 0.02 * S) / np.maximum(cv2.GaussianBlur(mk, (0, 0), 0.02 * S), 1e-3)
    thr = base * 1.06; hi = sk & (L > thr)
    L2 = np.where(hi, thr + (L - thr) * highlight, L)
    wsk = cv2.GaussianBlur(mk, (0, 0), 0.002 * S)
    lab[..., 0] = L * (1 - wsk) + L2 * wsk
    alb = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    rest = np.power(cv2.resize(alb, (S2, S2), interpolation=cv2.INTER_AREA).astype(np.float32) / 255, 2.2) @ lw
    Xa = np.c_[aoc[skin], _sh9(N2[skin])]; ca = np.linalg.lstsq(Xa, rest[skin], rcond=None)[0]
    r2a = 1 - np.var(rest[skin] - Xa @ ca) / np.var(rest[skin])
    rep["albedo"] = {"applied": True, "skin_texels": int(skin.sum()), "ao_coef": round(float(coef[0]), 4),
                     "shading_explained_r2_before": round(float(r2), 3), "after": round(float(r2a), 3),
                     "shade_p5_p95": [round(float(np.percentile(shade[skin], 5)), 3), round(float(np.percentile(shade[skin], 95)), 3)],
                     "shine_texels": int(hi.sum())}
    return alb


def nose_black_clean(tex8, region, ref_src, ratio=0.5):
    """Black blotches on the nose (S15P31B204-413, 11/05): the photo's black nostril lands where the model has none
    (ghost outside the model's nostril, smears on the nostril walls). In `region` (nose + nostril interior), texels
    darker than `ratio` x the open nose skin (median of `ref_src`) are refilled from the texture around them (inpaint).
    The nose's own shading (alar groove ~0.55-0.68 of the skin) stays. Returns (tex8, refilled texels)."""
    import cv2
    if region.sum() < 50 or ref_src.sum() < 50: return tex8, 0
    L = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
    k3 = np.ones((3, 3), np.uint8)
    dark = (region & (L < ratio * np.median(L[ref_src]))).astype(np.uint8)
    dark = cv2.dilate(dark, k3, iterations=2) & cv2.dilate(region.astype(np.uint8), k3)   # the soft edge of a blotch too
    return cv2.inpaint(tex8, dark * 255, 5, cv2.INPAINT_TELEA), int(dark.sum())


def eye_angle_map(S, tris, V, F, UV, UT, mat, comp):
    """Per eye texel: angle (deg) of its sampled point from its eye's gaze axis (ball centre -> iris disc centre), and
    the model's iris edge angle. NaN outside the layout. Used by sclera_spill_clean."""
    py, px, tt, w = raster_layout(S, tris, UV, UT)
    P = np.einsum("ij,ijk->ik", w, V[F[tt]]); cid = comp[F[tt, 0]]
    ang = np.full((S, S), np.nan, np.float32); th_i = []
    for c_ in (1, 2):
        eb = np.where((comp == c_) & (mat == 4))[0]; ir = np.where((comp == c_) & np.isin(mat, [5, 6]))[0]
        on = cid == c_
        if len(eb) < 20 or not len(ir) or not on.any(): continue
        c = np.linalg.lstsq(np.c_[2 * V[eb], np.ones(len(eb))], (V[eb] ** 2).sum(1), rcond=None)[0][:3]
        ic = V[ir].mean(0); fwd = (ic - c) / np.linalg.norm(ic - c)
        th_i.append(np.degrees(np.arctan2(np.linalg.norm(V[ir] - ic, axis=1).max(), np.linalg.norm(ic - c))))
        Q = P[on] - c; ang[py[on], px[on]] = np.degrees(np.arccos(np.clip(Q @ fwd / np.linalg.norm(Q, axis=1), -1, 1)))
    return ang, (float(np.mean(th_i)) if th_i else None)


def sclera_spill_clean(tex8, ang, th_i, ratio=0.7, top=50.0):
    """Dark iris colour on the white of the eye (S15P31B204-569, 11/06): the photo iris is 10-14 % wider than the
    model's (by01 / chae01 / woo02), so the dark limbus is baked onto the sclera just outside the model's iris and its
    edge lands on an eyeball vertex ring (32 deg): a concentric band. In the sclera zone (th_i .. top deg from the gaze),
    texels darker than `ratio` x the zone's bright sclera (75th percentile) are refilled from the texture around them;
    the iris area and the softer corner shading (0.8-0.9) stay. Returns (tex8, refilled texels)."""
    import cv2
    if th_i is None: return tex8, 0
    zone = np.nan_to_num(ang, nan=-1) > th_i
    zone &= np.nan_to_num(ang, nan=1e9) < top
    if zone.sum() < 100: return tex8, 0
    L = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
    dark = (zone & (L < ratio * np.percentile(L[zone], 75))).astype(np.uint8)
    dark = (cv2.dilate(dark, np.ones((3, 3), np.uint8)) & zone.astype(np.uint8)) > 0
    # fill colour from the SCLERA only: non-dark zone texels, the less saturated half (the zone also holds eyelid skin
    # where the lids cover the ball; an inpainting from all neighbours painted brown skin patches, woo02 11/06).
    # Normalised blur, a wider one where no sclera is near (wide bands)
    lab = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = np.hypot(lab[..., 1] - 128, lab[..., 2] - 128); ok = zone & ~dark
    src = (ok & (chroma <= np.percentile(chroma[ok], 50))).astype(np.float32)
    img = tex8.astype(np.float32); S = tex8.shape[0]
    def tone(sg):
        den = cv2.GaussianBlur(src, (0, 0), sg)
        return cv2.GaussianBlur(img * src[..., None], (0, 0), sg) / np.maximum(den, 1e-4)[..., None], den
    t1, d1 = tone(0.01 * S); t2, _ = tone(0.04 * S)
    fill = np.where((d1 < 0.05)[..., None], t2, t1)
    out = tex8.copy(); out[dark] = np.clip(fill[dark], 0, 255).astype(np.uint8)
    return out, int(dark.sum())


def even_light(tex8, valid, face_seen, strength, rep):
    """Texture-space shading evening for the face SKIN only (not brows / eyes / lips / hair).
    Broad (low-frequency) luminance of the skin vs. its median: broad shadows are lifted and broad highlights toned down
    by (median / broad)^strength, clipped. Fine detail (pores, freckles, wrinkles) and colour (a, b) are kept."""
    import cv2
    S = tex8.shape[0]
    fimg = np.zeros((S, S), bool); fimg[valid] = face_seen
    lab = cv2.cvtColor(tex8, cv2.COLOR_BGR2LAB).astype(np.float32)
    Lc, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    ref = fimg & (Lc > np.percentile(Lc[fimg], 30))
    a0, b0, L0 = np.median(A[ref]), np.median(B[ref]), np.median(Lc[ref])
    # skin: colour near the skin tone and not dark (brows, lashes, nostrils, hair are excluded)
    skin = fimg & (np.abs(A - a0) < 10) & (np.abs(B - b0) < 12) & (Lc > 0.55 * L0)
    skin = cv2.morphologyEx(skin.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
    sg = 0.02 * S
    m = skin.astype(np.float32)
    low = cv2.GaussianBlur(Lc * m, (0, 0), sg) / np.maximum(cv2.GaussianBlur(m, (0, 0), sg), 1e-3)
    gain = np.clip((L0 / np.maximum(low, 1)) ** strength, 0.85, 1.3)
    w = cv2.GaussianBlur(m, (0, 0), 0.004 * S)                          # soft edge toward brows / lips / hair
    # dark features inside the skin area (moles, brows edge) keep their contrast: the gain multiplies, it does not set
    lab[..., 0] = np.clip(Lc * (1 + (gain - 1) * w), 0, 255)
    out = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    rep["even_light"] = {"strength": strength, "skin_texels": int(skin.sum()),
                         "gain_p5_p95": [round(float(np.percentile(gain[skin], 5)), 3), round(float(np.percentile(gain[skin], 95)), 3)]}
    return out


TIMING = {}
_T0 = [time.perf_counter()]


def tick(name):
    """wall seconds since the previous tick, summed per name (report: timing_sec)"""
    t = time.perf_counter(); TIMING[name] = round(TIMING.get(name, 0.0) + t - _T0[0], 2); _T0[0] = t


def main():
    import cv2, pycolmap
    from frame_check import load_poses, intrinsics
    ap = argparse.ArgumentParser()
    ap.add_argument("mesh"); ap.add_argument("sparse"); ap.add_argument("images"); ap.add_argument("out")
    ap.add_argument("--size", type=int, default=2048); ap.add_argument("--every", type=int, default=2)
    ap.add_argument("--poses", help="frame_check.py JSON")
    ap.add_argument("--fit-json", help="template_fit report: landmark ids -> skin below the neck line is not taken from the photos (clothes)")
    ap.add_argument("--delight", action="store_true", help="EXPERIMENTAL: divide out each photo's broad shading (off by default: "
                    "on webcam data it made the skin look streaky; user preferred the plain bake)")
    ap.add_argument("--blend", default="average", choices=["best", "average"], help="best = sharper, most frontal photo per texel (experimental)")
    ap.add_argument("--no-person-mask", action="store_true", help="do not reject background pixels with the person segmentation")
    ap.add_argument("--neck", type=float, default=None, help="keep photo colour down to chin - neck x face height (0.12)")
    # 2026-10-15 A/B on p01 against the user-approved bake (iris_size2): cos^8 + grazing fallback + hair fill painted the
    # head periphery with grazing samples (wall / clothes patches, hard edges at the crown) -> mean diff 12, p95 62 grey
    # levels. cos^6 without fallback reproduces the approved texture (mean 1.9). Defaults restored; the rest is opt-in.
    ap.add_argument("--cos-pow", type=float, default=6, help="view weight exponent cos^p (6 = approved p01 bake)")
    ap.add_argument("--fallback", action="store_true", help="EXPERIMENTAL: grazing fallback samples + hair-tone fill for "
                    "surfaces no view faces (crown); off: they are inpainted smoothly as in the approved bake")
    ap.add_argument("--no-fallback", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--no-hair-fill", action="store_true", help="unseen crown: plain inpaint (smears forehead skin up the "
                    "crown when the capture has no top view, eun01) instead of a soft blend into the measured hair tone")
    # off by default: on p01 (approved texture) 0.5 changed the face by 5.5 grey levels, and the broad-luminance spread of
    # the skin was NOT larger on eun01 (phone, std 0.08) than on p01 (webcam, 0.11): the phone look is sharper detail, not
    # stronger broad shading. Opt-in for captures under a hard top light.
    ap.add_argument("--no-mv-light", dest="mv_light", action="store_false", help="do not remove the capture lighting per frame "
                    "before blending (fitted on all frames: light fixed to the camera or to the head, whichever fits better)")
    ap.add_argument("--shadow-robust", action="store_true", help="EXPERIMENTAL: down-weight skin samples darker than the "
                    "consensus (eun01: the nose-side shadow is in ALL frames -> 91 -> 93 only, and +3 overall brightening)")
    ap.add_argument("--no-robust", action="store_true", help="plain weighted mean (no down-weighting of disagreeing samples)")
    ap.add_argument("--occlusion", type=float, default=1.0, help="0..1: remove the shading explained by the mesh's ambient "
                    "occlusion (under the nose, nostril wings, under the lip: dark in every frame, eun02 2026-10-16)")
    ap.add_argument("--skin-even", type=float, default=0.7, help="0..1: even out blotchy skin (mid-scale tone / redness / "
                    "fold shadows); pores, moles and the overall skin colour are kept; lips / eyes / brows / nostrils untouched")
    ap.add_argument("--no-skin-only", dest="skin_only", action="store_false", help="face / ear / neck texels: also take "
                    "photo pixels that are NOT skin (hair hanging over the cheek, temple, ear or neck was painted onto the "
                    "face surface - woo01 2026-10-16). Default: only skin pixels; spots no frame shows as skin are filled from "
                    "the surrounding skin")
    ap.add_argument("--edge-guard", type=float, default=0.0, help="EXPERIMENTAL (woo01: dotted hairline, neck ghosts stayed) x eye distance: samples closer than this to the model's "
                    "outline / self-occlusion edges in a frame are faded out (misalignment ghosts); 0 = off")
    ap.add_argument("--no-albedo", dest="albedo", action="store_false", help="do not write <out>_skin_albedo.png "
                    "(skin colour with the capture lighting divided out, for the viewer's natural-light mode)")
    ap.add_argument("--nostril-dark", type=float, default=0.0, help="0..1 OPTION (2026-10-21): fade the nostril interior to "
                    "its darkest baked tone (bright skin-coloured streaks inside the nostrils seen from below, me01)")
    ap.add_argument("--keep-nose-creases", type=float, default=0.0, help="0..1 OPTION (2026-10-22): protect the concave grooves "
                    "around the nose (alar groove) from skin evening and the occlusion lift (they painted the alar groove "
                    "brighter than the photo, me01)")
    ap.add_argument("--sclera-clean", type=float, default=0.7, help="S15P31B204-569: on the white of the eye (model iris edge "
                    "to 50 deg from the gaze), refill texels darker than this x the bright sclera (photo iris wider than the "
                    "model's: a dark concentric band); 0 = off")
    ap.add_argument("--nose-black", type=float, default=0.5, help="S15P31B204-413: on the nose and inside the nostrils, refill "
                    "texels darker than this x the open nose skin from the texture around them (black photo nostril smears); 0 = off")
    ap.add_argument("--nostril-ring", type=float, default=0.7, help="with --nostril-dark: paint of the occluded exterior ring "
                    "at the nostril opening (0 = interior only)")
    ap.add_argument("--no-feature-warp", dest="feature_warp", action="store_false", help="read the photo colour at the "
                    "model projection only (default: shifted onto where MediaPipe finds the eyes / nose / lips in that photo)")
    ap.add_argument("--detail", type=float, default=1.0, help="0..1.5: fine detail (pores, lines) from the sharpest frontal "
                    "view on top of the stable average colour (multi-band blend); 0 = average only")
    ap.add_argument("--detail-sigma", type=float, default=0.003, help="band split, x map size")
    ap.add_argument("--sharp-weight", type=float, default=1.0, help="weight frames by their sharpness^p (0 = off)")
    ap.add_argument("--align", type=int, default=2, help="texture-space registration rounds (optical flow of every frame "
                    "onto the consensus texture, pipeline/tex_align.py); 0 = off")
    ap.add_argument("--topology", default="", help="W8b S2: mesh topology npz (vertices / triangles / vertex_uvs / uv_triangles / materials) "
                    "instead of the template, e.g. assets/gnm-detail-v1.npz for a fit_<c>_detail.ply (same UV atlas, subdivided)")
    ap.add_argument("--even-light", type=float, default=0.0, help="0..1: lift broad shadows / tone down broad highlights "
                    "on the face skin in texture space (e.g. 0.5 for a hard top light: nasolabial / jaw shadows)")
    # 2026-11-02 (S15P31B204-539, straight line across the forehead, brighter above): the skin post-processing (skin
    # evening, occlusion lift, albedo shading division + shine compression) only worked below a fixed height (1.05 x
    # chin -> landmark 10). Landmark 10 is not the hairline: the forehead skin goes on to hr 1.1-1.3, and the albedo map
    # was 22-30 grey levels brighter right above the cut (woo02 / chae01 / gyu01 / by01; a 4-10 px feather). No cap now:
    # hair is left out by the skin colour tests of those steps (woo02: line +29.7 -> +0.8, hair changed <= 3 levels).
    ap.add_argument("--face-top", type=float, default=float("inf"), help="upper end of the skin post-processing region, "
                    "x chin -> landmark 10 height (default: no cap; 1.05 = the old cut through the forehead)")
    a = ap.parse_args()
    gdev, glabel = bake_gpu.pick(); gpu_rep = {"device": glabel}      # LM_BAKE_DEVICE (S15P31B204-69)
    a.no_fallback = a.no_fallback or not a.fallback
    # 0.3 with the skin-only rule painted the shirt collar (eun02 pink stripes pass the skin colour test): kept at 0.12
    if a.neck is None:
        # with the multiclass segmentation the neck skin is cut cleanly at the collar -> photo colour down the whole
        # neck (the clothes are not skin any more); without it 0.12 (eun02 shirt stripes passed the colour test)
        from outline_obs import SEG_MODEL
        a.neck = 0.6 if (a.skin_only and not a.no_person_mask and os.path.exists(SEG_MODEL)) else 0.12
    d = np.load(a.topology or TEMPLATE); UV = d["vertex_uvs"].astype(np.float64); UT = d["uv_triangles"].astype(np.int64)
    F = d["triangles"].astype(np.int64); mat = d["materials"]
    V = np.asarray(meshio.read_any(a.mesh)["vertices"], np.float64)
    if len(V) != len(mat): raise SystemExit(f"mesh has {len(V)} vertices, the topology {len(mat)} (wrong --topology?)")
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    vn = np.zeros_like(V)
    for k in range(3): np.add.at(vn, F[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    rec = pycolmap.Reconstruction(a.sparse); poses = load_poses(a.poses)
    frames = []
    for im in sorted(rec.images.values(), key=lambda i: i.name)[::max(1, a.every)]:
        if poses is not None and im.name not in poses: continue
        R, t = poses[im.name] if poses else (im.cam_from_world().rotation.matrix(), np.asarray(im.cam_from_world().translation))
        frames.append((im, R, np.asarray(t, np.float64)))
    cams = np.array([-R.T @ t for _, R, t in frames])
    n0_ = None
    skin = mat == 0
    if ((V[skin] - V[skin].mean(0)) * vn[skin]).sum(1).mean() < 0: vn = -vn
    # texel sets of all groups, sampled together frame by frame
    groups = []
    # face -> group. Faces on a material border (iris|white of the eye: the limbus ring) used to fall into no group and
    # were drawn as a flat brown "other" ring around the iris. Priority: iris/pupil > eyeball > skin
    fgroup = np.full(len(F), -1)
    for gi_, (name, mats, rel) in reversed(list(enumerate(GROUPS))):
        sel = np.isin(mat[F], mats).all(1) if name == "skin" else np.isin(mat[F], mats).any(1) & np.isin(mat[F], [4, 5, 6]).all(1)
        fgroup[sel] = gi_
    for gi_, (name, mats, rel) in enumerate(GROUPS):
        S = max(64, int(a.size * rel))
        tris = np.where(fgroup == gi_)[0]
        if name != "skin" and "components" in d and "vertices" in d:
            tris = eye_front_last(tris, d["vertices"].astype(np.float64), F, mat, d["components"])
        P, N = raster(S, tris, V, vn, F, UV, UT)
        valid = ~np.isnan(P[..., 0]); Nv = N[valid]; Nv /= np.linalg.norm(Nv, axis=1, keepdims=True) + 1e-12
        groups.append(dict(name=name, S=S, tris=tris, valid=valid, P=P[valid], N=Nv))
    tick("setup_raster")
    neck_cut = None; ids = None
    if a.fit_json:
        ids = json.load(open(a.fit_json))["landmark_vertex_ids"]
        chin, top = V[ids[152]], V[ids[10]]; upv = (top - chin) / np.linalg.norm(top - chin)
        hgt = np.linalg.norm(top - chin)
        neck_cut = ((groups[0]["P"] - chin) @ upv) < -(a.neck + 0.1) * hgt  # skin texels below the neck line
    allP = np.concatenate([g["P"] for g in groups]); allN = np.concatenate([g["N"] for g in groups])
    offs = np.cumsum([0] + [len(g["P"]) for g in groups]); n0_ = int(offs[1])
    # grazing fallback only for surfaces that face up or sideways (crown, temples); NOT under the chin / jaw, where a
    # grazing frontal view looks past the chin onto the wall or the shirt
    fb_ok = ((allN @ upv) > -0.15).astype(np.float32) if a.fit_json else np.ones(len(allN), np.float32)

    def sample(img, u, v):
        x0 = np.floor(u).astype(int); y0 = np.floor(v).astype(int); fx = (u - x0)[:, None]; fy = (v - y0)[:, None]
        I = lambda yy, xx: img[yy, xx].astype(np.float32)     # only the needed pixels to float (whole frame was 0.2 s)
        return I(y0, x0) * (1 - fx) * (1 - fy) + I(y0, x0 + 1) * fx * (1 - fy) + I(y0 + 1, x0) * (1 - fx) * fy + I(y0 + 1, x0 + 1) * fx * fy
    # person masks (shared cache with cranium_fit.py): prep/person_masks next to the images folder
    pmask_dir = None if a.no_person_mask else os.path.join(os.path.dirname(os.path.normpath(a.images)), "person_masks")
    PM = {}; CMk = {}
    if pmask_dir:
        try:   # all frames at once (one segmentation model instance)
            from cranium_fit import person_masks
            PM = person_masks(a.images, [im.name for im, _, _ in frames], pmask_dir)
            from outline_obs import class_masks
            CMk = class_masks(a.images, [im.name for im, _, _ in frames], os.path.join(os.path.dirname(os.path.normpath(a.images)), "class_masks"))
        except Exception as ex:
            print("person masks skipped:", ex, file=sys.stderr); pmask_dir = None
    # face / ear / neck texels (not the hair-covered scalp): only SKIN pixels of each photo are used there
    face_tex = None
    if a.skin_only and a.fit_json and pmask_dir:
        try:
            from gnm_features import skin_only_vertices
            from scipy.spatial import cKDTree
            scalp = ~skin_only_vertices()     # (name kept: everything that takes the photo colour as it is)
            # soft face weight per vertex (smoothed over the mesh): 1 = face / ear / neck skin, 0 = scalp; in between
            # non-skin pixels are only partly down-weighted -> no hard seam where the painted hair meets the face
            from scipy.sparse import coo_matrix
            ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
            jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
            Adj = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(V), len(V))).tocsr(); deg = np.maximum(np.asarray(Adj.sum(1)).ravel(), 1)
            fv = (~scalp).astype(np.float64)
            for _ in range(12): fv = 0.5 * fv + 0.5 * (Adj @ fv) / deg
            fv = np.clip((fv - 0.25) / 0.5, 0, 1)
            sk_ids = np.where(mat == 0)[0]
            _, nnv = cKDTree(V[sk_ids]).query(groups[0]["P"])
            face_w = np.zeros(len(allP), np.float32); face_w[:n0_] = fv[sk_ids[nnv]]
            face_tex = face_w > 0.5
            ids_l = json.load(open(a.fit_json))["landmark_vertex_ids"]
        except (Exception, SystemExit) as ex:
            print("skin-only sampling skipped:", ex, file=sys.stderr); face_tex = None
    tick("masks_load")
    skin_rejected = 0
    def person_mask(name):
        m = PM.get(name)
        return None if m is None else cv2.erode(m, np.ones((7, 7), np.uint8))
    lwarp = None
    if a.feature_warp and a.fit_json:
        try:
            from tex_align import LandmarkWarp
            lwarp = LandmarkWarp(os.path.join(HERE, "..", "assets", "face_landmarker.task"), ids)
        except Exception as ex:
            print("feature warp skipped:", ex, file=sys.stderr); lwarp = None
    tick("feature_warp_init")
    samples = []; Rs = []; sharps = []
    from concurrent.futures import ThreadPoolExecutor
    from parallel import workers           # LM_BAKE_WORKERS, else the job's thread budget (S15P31B204-702)
    pool = ThreadPoolExecutor(workers())
    # first pass: best facing cosine per texel over all views -> grazing fallback samples are collected ONLY for texels
    # that no view faces (keeps memory / time like before; collecting them everywhere ran out of memory)
    cmax_all = np.full(len(allP), -1.0, np.float32)
    def facing(fr):
        cc = -fr[1].T @ fr[2]
        return (((cc - allP) * allN).sum(1) / (np.linalg.norm(cc - allP, axis=1) + 1e-12)).astype(np.float32)
    FT = {}; FT_lock = threading.Lock()     # frames sub-steps in thread-seconds (4 threads: sum ~ 4x wall), S15P31B204-69
    def fsub(name, t0):
        t1 = time.perf_counter()
        with FT_lock: FT[name] = FT.get(name, 0.0) + t1 - t0
        return t1
    # GPU (S15P31B204-69): facing cosines / selection / colour sampling, bit-identical to the CPU code here.
    # LM_BAKE_CHECK=1 also runs the CPU code per frame and counts the frames where they differ (report "frames_check")
    fgeo = bake_gpu.stage(gpu_rep, "frames", lambda: bake_gpu.Frames(allP, allN, gdev)) if gdev else None
    CHECK = fgeo is not None and os.environ.get("LM_BAKE_CHECK") == "1"
    def gpu_fail(ex):
        with FT_lock: gpu_rep.setdefault("gpu_fallback", {}).setdefault("frames", f"{type(ex).__name__}: {str(ex)[:200]}")
    def check(name, same):
        with FT_lock: n = gpu_rep.setdefault("frames_check", {}).setdefault(name, [0, 0]); n[0] += not same; n[1] += 1
    t_ = time.perf_counter(); cm = None
    if fgeo is not None:
        try: cm = fgeo.facing_max([-fr[1].T @ fr[2] for fr in frames])
        except Exception as ex: gpu_fail(ex)
    if cm is None or CHECK:
        cm_c = np.full(len(allP), -1.0, np.float32)
        for cf in pool.map(facing, frames): np.maximum(cm_c, cf, out=cm_c)
        if cm is not None: check("facing_prepass", np.array_equal(np.maximum(cmax_all, cm), cm_c))
        else: cm = cm_c
    np.maximum(cmax_all, cm, out=cmax_all)
    fsub("facing_prepass_wall", t_)
    need_fb = (cmax_all < 0.55) & (fb_ok > 0) & (not a.no_fallback)
    def one_frame(fr):
        im, Rm, tv = fr; rejected = 0
        t = time.perf_counter()
        img = cv2.imread(os.path.join(a.images, im.name))
        if img is None: return None
        H, W = img.shape[:2]; t = fsub("read", t)
        cam = rec.cameras[im.camera_id]; f, cx, cy = intrinsics(cam)
        cc = -Rm.T @ tv
        wmul = None   # per-sample weight factor of the skin-only rule (this frame)
        gsel = None
        if fgeo is not None:
            try: gsel = fgeo.select(cc, need_fb)
            except Exception as ex: gpu_fail(ex)
        if gsel is not None:     # the weight only for the selected texels (it is only read there)
            sel, cos_s = gsel
            cpos_s = np.clip(cos_s, 0, 1); wv_s = cpos_s ** a.cos_pow + 2e-3 * cpos_s * need_fb[sel]
        if gsel is None or CHECK:
            cosv = ((cc - allP) * allN).sum(1) / (np.linalg.norm(cc - allP, axis=1) + 1e-12)
            # main weight: facing views (cos^p, default 6); with --fallback also a tiny
            # fallback weight for grazing views so surfaces that no view faces (crown of the head, under the chin) take the
            # photo colour (hair) instead of being inpainted from the forehead skin ("bald" crown, eun01 2026-10-15)
            cpos = np.clip(cosv, 0, 1)
            wv = cpos ** a.cos_pow + 2e-3 * cpos * need_fb
            sel_c = np.where((cosv > 0.52) | (need_fb & (cosv > 0.12)))[0]
            if gsel is None: sel, cos_s, wv_s = sel_c, cosv[sel_c], wv[sel_c]
            else: check("select", np.array_equal(sel, sel_c) and np.array_equal(cos_s, cosv[sel_c])
                        and np.array_equal(wv_s.astype(np.float32), wv[sel_c].astype(np.float32)))
        Q = allP[sel] @ Rm.T + tv
        u = f * Q[:, 0] / Q[:, 2] + cx; v = f * Q[:, 1] / Q[:, 2] + cy; t = fsub("facing_project", t)
        Qm = V @ Rm.T + tv; um = (f * Qm[:, 0] / Qm[:, 2] + cx) / 4; vm = (f * Qm[:, 1] / Qm[:, 2] + cy) / 4
        zb = np.full((H // 4 + 1, W // 4 + 1), np.inf)
        okm = (Qm[:, 2] > 0) & (um >= 0) & (um < W // 4) & (vm >= 0) & (vm < H // 4)
        np.minimum.at(zb, (vm[okm].astype(int), um[okm].astype(int)), Qm[okm, 2])
        zb = cv2.erode(np.where(np.isinf(zb), 1e9, zb).astype(np.float32), np.ones((5, 5), np.uint8))
        ok = (Q[:, 2] > 0) & (u >= 0) & (u < W - 2) & (v >= 0) & (v < H - 2)
        zt = zb[np.clip((v / 4).astype(int), 0, zb.shape[0] - 1), np.clip((u / 4).astype(int), 0, zb.shape[1] - 1)]
        zmed = (np.median(np.abs(Qm[okm, 2])) if okm.any() else 1)
        ok &= Q[:, 2] <= zt + 0.02 * zmed; t = fsub("zbuffer", t)
        # EDGE guard (2026-10-16): near the model's outline and its self-occlusion edges (jaw over the neck, ear, nose in
        # a side view) a small model / photo misalignment puts the WRONG surface's pixels on the texel (ghost jaw lines
        # and ear shapes on the neck, woo01). Samples there get a weight ramp from 0 at the edge to 1 at --edge-guard.
        edge_w = None
        if a.edge_guard > 0 and okm.any():
            zz = np.where(zb > 1e8, 10 * zmed, zb).astype(np.float32)
            k3 = np.ones((3, 3), np.uint8)
            jump = (cv2.dilate(zz, k3) - cv2.erode(zz, k3)) > 0.04 * zmed
            dist = cv2.distanceTransform((~jump).astype(np.uint8), cv2.DIST_L2, 3) * 4     # full-res px
            iod_px = f * (np.linalg.norm(V[ids[33]] - V[ids[263]]) if a.fit_json else 0.1 * zmed) / zmed
            dq = dist[np.clip((v / 4).astype(int), 0, dist.shape[0] - 1), np.clip((u / 4).astype(int), 0, dist.shape[1] - 1)]
            edge_w = np.clip(dq / (a.edge_guard * iod_px), 0, 1) ** 2
        if pmask_dir:
            # only pixels on the PERSON (selfie segmentation, slightly shrunk): the enlarged head outline (cranium fit)
            # otherwise picks up wall / background colour at its silhouette
            pm = person_mask(im.name)
            if pm is not None:
                okp = ok.copy(); okp[ok] = pm[v[ok].astype(int), u[ok].astype(int)] > 0
                ok = okp
            if face_tex is not None and PM.get(im.name) is not None:
                # face / ear / neck: only pixels that are skin in THIS photo (hair strands, glasses frames, clothes rejected)
                from outline_obs import skin_mask, CHEEK_LM
                Qc = V[np.array(ids_l)[CHEEK_LM]] @ Rm.T + tv
                ref = np.c_[f * Qc[:, 0] / Qc[:, 2] + cx, f * Qc[:, 1] / Qc[:, 2] + cy]
                skm = skin_mask(img, PM[im.name], ref, min_area=2000, classes=CMk.get(im.name))
                if skm is not None:
                    skm = cv2.erode(skm, np.ones((5, 5), np.uint8))
                    ft = (face_w[sel] > 0) & ok
                    bad = np.zeros_like(ok); bad[ft] = skm[v[ft].astype(int), u[ft].astype(int)] == 0
                    rejected = int((bad & face_tex[sel]).sum())
                    wmul = np.where(bad, 1 - face_w[sel], 1.0)
                    ok &= wmul > 1e-3
        uu, vv = u[ok], v[ok]; t = fsub("masks", t)
        if lwarp is not None:
            # read the photo where it SHOWS the feature (nostril, eye corner, lip edge), not where the model put it
            fld = lwarp.field(img, V, vn, Rm, tv, f, cx, cy)
            if fld is not None:
                from tex_align import _remap_pts
                du = _remap_pts(np.ascontiguousarray(fld[..., 0]), uu.astype(np.float32), vv.astype(np.float32))
                dv = _remap_pts(np.ascontiguousarray(fld[..., 1]), uu.astype(np.float32), vv.astype(np.float32))
                uu = np.clip(uu + du, 0, W - 2.001); vv = np.clip(vv + dv, 0, H - 2.001)
        t = fsub("feature_warp", t)
        idx = sel[ok]
        wsm = wv_s[ok].astype(np.float32)                              # = wv[idx]
        if wmul is not None: wsm = wsm * wmul[ok].astype(np.float32)
        if edge_w is not None: wsm = wsm * edge_w[ok].astype(np.float32)
        # frame SHARPNESS (motion blur, focus, compression): variance of the Laplacian on the face area of this frame.
        # The area from the SKIN samples only: the eye groups hold about as many texels, and which eye surface a shared
        # eye texel samples (eye_front_last) must not move the skin's frame weights (S15P31B204-569)
        su, sv = uu[idx < n0_], vv[idx < n0_]
        if len(su) > 1000:
            x0_, x1_ = int(np.percentile(su, 5)), int(np.percentile(su, 95)); y0_, y1_ = int(np.percentile(sv, 5)), int(np.percentile(sv, 95))
            gface = cv2.cvtColor(img[max(0, y0_):y1_, max(0, x0_):x1_], cv2.COLOR_BGR2GRAY)
            sharp_k = float(cv2.Laplacian(gface, cv2.CV_32F).var()) if gface.size > 100 else 0.0
        else:
            sharp_k = 0.0
        t = fsub("sharpness", t)
        col = None
        if fgeo is not None:
            try: col = fgeo.sample(img, uu, vv)
            except Exception as ex: gpu_fail(ex)
        if col is None or CHECK:
            col_c = sample(img, uu, vv)
            if col is None: col = col_c
            else: check("sample", np.array_equal(col, col_c))
        fsub("sample", t)
        return [idx, col, wsm, cos_s[ok].astype(np.float32)], Rm, sharp_k, rejected     # cos_s[ok] = cosv[idx]
    # frames are independent (OpenCV / NumPy / MediaPipe release the GIL): a thread pool, results in frame order
    for res in pool.map(one_frame, frames):
        if res is None: continue
        samples.append(res[0]); Rs.append(res[1]); sharps.append(res[2]); skin_rejected += res[3]
    pool.shutdown(); tick("frames"); gpu_rep["frames_sub_sec"] = {k: round(v, 2) for k, v in FT.items()}
    n0 = offs[1]
    if sharps and a.sharp_weight > 0:
        sh = np.array(sharps); med = np.median(sh[sh > 0]) if (sh > 0).any() else 1.0
        sfac = np.clip((sh / max(med, 1e-6)) ** a.sharp_weight, 0.5, 1.5)
        for k, smp in enumerate(samples): smp[2] = smp[2] * np.float32(sfac[k])
    else:
        sfac = np.ones(len(samples))
    if a.mv_light and neck_cut is not None:
        # GPU: [report] (the report itself may be None); a GPU failure comes before the samples are corrected
        r_ = bake_gpu.stage(gpu_rep, "mv_light", lambda: [mv_light_correct(samples, Rs, allP, allN, n0, chin, upv, hgt, gdev)]) if gdev else None
        rep_light = r_[0] if r_ is not None else mv_light_correct(samples, Rs, allP, allN, n0, chin, upv, hgt)
    else:
        rep_light = None
    tick("mv_light")
    delit = []
    if a.delight:
        # remove each photo's own low-frequency shading (2nd-order spherical harmonics of the surface normal, fitted to the
        # skin luminance of that photo, robust to hair / brows / lips): colour = skin colour only, so the 3D shape makes the
        # shading in the viewer (and an edited nose gets its own shadows)
        for sm in samples:
            idx, c, w, cs = sm
            sk = idx < n0
            if sk.sum() < 500: delit.append(None); continue
            n = allN[idx]; x, y, z = n[:, 0], n[:, 1], n[:, 2]
            Bsh = np.stack([np.ones_like(x), x, y, z], 1)  # 1st-order only: broad light direction, robust to normal noise
            Y = c.mean(1); rw = np.sqrt(w)
            for _ in range(3):
                Lc, *_ = np.linalg.lstsq(Bsh[sk] * rw[sk, None], Y[sk] * rw[sk], rcond=None)
                r = Y[sk] - Bsh[sk] @ Lc; sc = 1.4826 * np.median(np.abs(r)) + 1e-6
                rw_s = np.sqrt(w[sk]) / (1 + (r / (2 * sc)) ** 2); rw = rw.copy(); rw[sk] = rw_s
            shade = Bsh @ Lc; ref_s = np.median(shade[sk])
            ratio = np.clip(shade / max(ref_s, 1e-6), 0.75, 1.33)  # mild: never amplify more than 1.33x
            c[sk] = c[sk] / ratio[sk, None]
            delit.append(float(np.std(ratio[sk])))
    # GPU (S15P31B204-69, pipeline/bake_gpu.py): same steps in float32; None (no GPU / the GPU stage failed) -> NumPy below
    gains = bake_gpu.stage(gpu_rep, "gains", lambda: bake_gpu.gains(samples, len(allP), n0, gdev)) if gdev else None
    if gains is None:
        gains = np.ones((len(samples), 3), np.float32)
        for _ in range(3):
            acc = np.zeros((len(allP), 3)); ws = np.zeros(len(allP))
            for k, (idx, c, w, cs) in enumerate(samples):
                acc[idx] += c * gains[k] * w[:, None]; ws[idx] += w
            ref = acc / np.maximum(ws, 1e-9)[:, None]
            for k, (idx, c, w, cs) in enumerate(samples):
                good = (w > 0.1) & (ws[idx] > 0.3) & (idx < n0)
                if good.sum() > 500:
                    gains[k] = np.clip(np.median(ref[idx[good]] / np.maximum(c[good], 5), 0), 0.6, 1.6)
            gains /= np.median(gains, 0)
    tick("gains")
    align_rep = {}
    if a.align > 0:
        # texture-space registration of the frames (pipeline/tex_align.py): a feature that one frame paints a few mm
        # off (side views, ear, jaw line) is moved onto where the other frames put it before the blend
        from tex_align import align
        align(samples, gains, groups[0]["valid"], n0_, groups[0]["S"], iters=a.align, rep=align_rep)
    tick("tex_align")
    gpu_blend = None
    if gdev and a.blend == "average":
        gpu_blend = bake_gpu.stage(gpu_rep, "blend", lambda: bake_gpu.blend(samples, gains, len(allP), n0, not a.no_robust, a.shadow_robust, gdev))
    if gpu_blend is not None:
        acc, ws, rob_sigma = gpu_blend
    else:
        acc = np.zeros((len(allP), 3)); ws = np.zeros(len(allP))
        if a.blend == "best":
            # sharp: each texel takes (almost only) its most frontal photo; neighbouring texels switch smoothly (soft arg-max)
            cmax = np.zeros(len(allP), np.float32)
            for idx, c, w, cs in samples: cmax[idx] = np.maximum(cmax[idx], cs)
            for k, (idx, c, w, cs) in enumerate(samples):
                wb = np.exp(-(cmax[idx] - cs) / 0.04) * (w > 0.02)
                acc[idx] += c * gains[k] * wb[:, None]; ws[idx] += wb
            have_w = ws > 0.05
            ws_full = np.zeros(len(allP))
            for idx, c, w, cs in samples: ws_full[idx] += w
            ws = np.where(ws_full > 0.05, np.maximum(ws, 1e-6), 0)
        else:
            for k, (idx, c, w, cs) in enumerate(samples):
                acc[idx] += c * gains[k] * w[:, None]; ws[idx] += w
            if not a.no_robust:
                # robust blend: samples that disagree with the texel's consensus colour (mouth / expression change between
                # frames, slightly misregistered views, shine) get less weight -> fewer blotches on the lower face
                for _ in range(2):
                    ref = (acc / np.maximum(ws, 1e-9)[:, None]).astype(np.float32)
                    dev = lambda k, idx, c: np.abs(c * gains[k] - ref[idx]).mean(1)
                    dd = np.concatenate([dev(k, idx[idx < n0][::9], c[idx < n0][::9]) for k, (idx, c, w, cs) in enumerate(samples)])
                    sig = max(4.0, 1.4826 * float(np.median(dd)))
                    acc = np.zeros((len(allP), 3)); ws = np.zeros(len(allP))
                    for k, (idx, c, w, cs) in enumerate(samples):
                        wr = w / (1 + (dev(k, idx, c) / (2 * sig)) ** 2)
                        if a.shadow_robust:
                            # samples DARKER than the consensus on the skin = in a shadow in that frame (e.g. the nose blocks
                            # the side light when the head is turned away): extra down-weight, so frames where the same
                            # spot was lit win. Brighter samples are not favoured (no extra weight for shine).
                            sd = (c * gains[k] - ref[idx]) @ np.array([0.114, 0.587, 0.299], np.float32)
                            dark = (idx < n0) & (sd < 0)
                            wr[dark] = wr[dark] / (1 + (sd[dark] / sig) ** 2)
                        acc[idx] += c * gains[k] * wr[:, None]; ws[idx] += wr
                rob_sigma = sig
    rob_sigma = locals().get('rob_sigma', 0.0)
    # DETAIL from the sharpest frontal view (multi-band blending, Burt & Adelson): the weighted average above keeps the
    # colour stable but averages away pores / fine lines (and every residual misalignment blurs them more). Per texel the
    # best view (facing x sharpness, soft arg-max) gives the HIGH frequencies; the average gives the rest. 2026-10-16
    tick("blend")
    det_acc = det_ws = None
    if a.detail > 0:
        cmax = np.zeros(len(allP), np.float32)
        for k, (idx, c, w, cs) in enumerate(samples):
            cmax[idx] = np.maximum(cmax[idx], (cs * sfac[k]).astype(np.float32) * (w > 0.02))   # idx unique per frame
        det_acc = np.zeros((len(allP), 3), np.float32); det_ws = np.zeros(len(allP), np.float32)
        for k, (idx, c, w, cs) in enumerate(samples):
            sc_ = (cs * sfac[k]).astype(np.float32)
            wb = np.exp(-(cmax[idx] - sc_) / 0.03) * (w > 0.02)
            det_acc[idx] += (c * gains[k] * wb[:, None]).astype(np.float32); det_ws[idx] += wb.astype(np.float32)
    base = os.path.basename(a.out); rep = {"frames": len(samples), "gain_range": [float(gains.min()), float(gains.max())], "groups": {},
                                       "delit": bool(a.delight), "blend": a.blend, "mv_light": rep_light,
                                       "robust_sigma": (round(rob_sigma, 2) if not a.no_robust and a.blend == "average" else None),
                                       "shading_removed_std_median": float(np.median([d for d in delit if d is not None])) if delit else None}
    rep.update(align_rep); rep.update(gpu_rep)
    if lwarp is not None: rep["feature_warp"] = lwarp.report()
    rep["skin_only_rejected_samples"] = int(skin_rejected) if face_tex is not None else None
    tick("detail")
    mtl = []; hair_tone = None
    for gi, g in enumerate(groups):
        S, sl = g["S"], slice(offs[gi], offs[gi + 1])
        have = ws[sl] > 1e-4   # grazing-only texels count as seen (fallback weight)
        vals = np.zeros((len(g["P"]), 3)); vals[have] = acc[sl][have] / ws[sl][have, None]
        if gi == 0 and neck_cut is not None:
            # below the neck line: skin tone of the lower face (chin..nose band), shaded a little, with a soft transition
            hr = (g["P"] - chin) @ upv / hgt
            face_seen = have & (hr > -0.05) & (hr < a.face_top)
            band = have & (hr > 0.05) & (hr < 0.35)
            tone = np.median(vals[band], 0) if band.sum() > 50 else np.median(vals[have], 0)
            # 0 above the line .. 1 at 0.25 h below it (0.1 h left a visible line across the neck, 2026-10-16), and only a
            # little darker than the face (the natural-light viewer shades the neck by its own form)
            alpha = np.clip((-a.neck - hr) / 0.25 + 1, 0, 1)[:, None]
            vals = np.where(have[:, None], vals * (1 - alpha) + tone * 0.94 * alpha, tone * 0.94)
            have = have | neck_cut
            # unseen head top / back (outside the captured head turn): hair colour of the seen head region, not an
            # inpaint from the surrounding (which smeared wall / skin colours over a large area)
            # applied AFTER the inpaint as a soft blend (inpaint near the seen edge -> hair tone further away): no hard
            # seam and no jagged grazing samples (2026-10-15)
            if face_tex is not None:
                # face / ear / neck skin seen only weakly (grazing views, or hidden by hanging hair in most frames: few
                # samples, the ear / hair edges of misaligned views leave ghost bands on the neck) or not at all: blend
                # toward the colour of the CONFIDENTLY seen face skin around it (normalized blur in the UV image)
                fw = face_w[:len(have)]
                conf = np.clip(ws[sl] / 0.35, 0, 1) * have
                src = (conf > 0.99) & (fw > 0.5) & ~neck_cut
                img_v = np.zeros((S, S, 3), np.float32); img_m = np.zeros((S, S), np.float32)
                tmpv = np.zeros((len(have), 3), np.float32); tmpv[src] = vals[src]
                img_v[g["valid"]] = tmpv; img_m[g["valid"]] = src
                fill = np.zeros((len(have), 3)); done = np.zeros(len(have), bool)
                for sg in (0.01, 0.025, 0.06, 0.15):
                    num = cv2.GaussianBlur(img_v, (0, 0), sg * S); den = cv2.GaussianBlur(img_m, (0, 0), sg * S)
                    cur = (num / np.maximum(den, 1e-6)[..., None])[g["valid"]]; dv = den[g["valid"]]
                    put = ~done & (dv > 0.05)
                    fill[put] = cur[put]; done |= put
                tgt = (fw > 0) & ~src & done & ~neck_cut
                al = (fw * (1 - conf))[:, None]                  # how much of the fill: weak evidence + face weight
                vals[tgt] = vals[tgt] * (1 - al[tgt]) + fill[tgt] * al[tgt]
                newly = tgt & ~have & (fw > 0.5)
                have = have | newly
                rep["face_skin_filled_texels"] = int(newly.sum()); rep["face_skin_blended_texels"] = int((tgt & have).sum())
            hairz = (hr > 0.6) & ~have
            seen_hair = have & (hr > 0.75)
            if hairz.any() and seen_hair.sum() > 200 and not a.no_hair_fill:
                hv = vals[seen_hair]; lum = hv.mean(1)
                hair_tone = np.median(hv[lum <= np.percentile(lum, 40)], 0)       # the darker part = hair, not forehead
                # soft in height too (0 at hr 0.6 .. 1 at hr 0.85): no hard line where the hair tone starts
                hair_img = np.zeros((S, S), np.float32)
                hair_img[g["valid"]] = (~have) * np.clip((hr - 0.6) / 0.25, 0, 1) * (1 if face_tex is None else ~face_tex[:len(have)])
                rep["hair_filled_texels"] = int(hairz.sum())
        tex = np.zeros((S, S, 3), np.float32); tex[g["valid"]] = vals
        if gi == 0 and det_acc is not None:
            dws = det_ws[sl]; dhave = (dws > 1e-3) & have
            if dhave.sum() > 1000:
                Bimg = np.zeros((S, S, 3), np.float32); Bm = np.zeros((S, S), np.float32)
                Bimg[g["valid"]] = np.where(dhave[:, None], det_acc[sl] / np.maximum(dws, 1e-6)[:, None], 0); Bm[g["valid"]] = dhave
                sgd = max(1.0, a.detail_sigma * S)
                low = cv2.GaussianBlur(Bimg * Bm[..., None], (0, 0), sgd) / np.maximum(cv2.GaussianBlur(Bm, (0, 0), sgd), 1e-3)[..., None]
                hp = (Bimg - low) * Bm[..., None]
                Am = np.zeros((S, S), np.float32); Am[g["valid"]] = have
                lowA = cv2.GaussianBlur(tex * Am[..., None], (0, 0), sgd) / np.maximum(cv2.GaussianBlur(Am, (0, 0), sgd), 1e-3)[..., None]
                inner = cv2.erode(Bm, np.ones((5, 5), np.uint8))                 # no detail across the coverage border
                # only where the best view shows the SAME thing as the average (a strand of hair or a misplaced ear in
                # that one view must not be pasted in as "detail")
                agree = np.clip(1 - np.linalg.norm(low - lowA, axis=2) / 14.0, 0, 1) * (inner > 0)
                tex = np.where((inner > 0)[..., None], lowA + (tex - lowA) * (1 - agree[..., None]) + a.detail * hp * agree[..., None], tex)
                rep["detail_layer"] = {"texels": int(inner.sum()), "sigma_px": round(sgd, 1), "gain": a.detail,
                                       "frame_sharpness_p10_p90": [round(float(np.percentile(sharps, 10)), 1), round(float(np.percentile(sharps, 90)), 1)] if sharps else None}
        tick("post_fill_detail")
        seen = np.zeros((S, S), bool); seen[g["valid"]] = have
        tex8 = cv2.inpaint(np.clip(tex, 0, 255).astype(np.uint8), (~seen).astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
        if gi == 0 and hair_tone is not None:
            # also the empty texels between UV islands next to hair (texture filtering samples them at the seams: a
            # skin-coloured line along the crown seam otherwise)
            vimg = g["valid"]; k = max(3, int(0.008 * S)) | 1
            hair_img = np.maximum(hair_img, cv2.dilate(hair_img, np.ones((k, k), np.uint8)) * (~vimg))
            dist = cv2.distanceTransform((~seen).astype(np.uint8), cv2.DIST_L2, 5)
            al = np.clip(dist / (0.025 * S), 0, 1) * hair_img
            al = cv2.GaussianBlur(al, (0, 0), 0.006 * S)[..., None]
            tex8 = np.clip(tex8 * (1 - al) + hair_tone[None, None] * al, 0, 255).astype(np.uint8)
        tick("post_inpaint")
        if gi == 0 and neck_cut is not None and a.even_light > 0:
            tex8 = even_light(tex8, g["valid"], face_seen, a.even_light, rep)
        if gi == 0 and neck_cut is not None and (a.skin_even > 0 or a.occlusion > 0):
            prot = protect_uv_mask(S, V, F, UV, UT, ids)
            from mesh_ao import vertex_ao
            ao = vertex_ao(V, F, vn)
            if a.keep_nose_creases > 0:
                # 2026-10-22 option: the alar groove (and the other concave grooves around the nose) is a real shadow line,
                # but skin evening read it as a dark blotch and the occlusion lift as a cavity: together they painted
                # it BRIGHTER than the photo (me01: photo L 112, samples 117, final 154; both off 117). Concave grooves
                # near the nose join the protected mask (like lips / eyes / brows).
                from scipy.sparse import coo_matrix, diags as sdiags
                from gnm_model import GNM, template_map
                ii_ = np.r_[F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]; jj_ = np.r_[F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]]
                Aj = coo_matrix((np.ones(len(ii_)), (ii_, jj_)), shape=(len(V), len(V))).tocsr(); Aj.data[:] = 1
                Mx = sdiags(1 / np.maximum(np.asarray(Aj.sum(1)).ravel(), 1)) @ Aj
                iod_ = np.linalg.norm(V[ids[33]] - V[ids[263]])
                conc = ((Mx @ V - V) * vn).sum(1) / iod_ * 100                  # + = concave (neighbours in front)
                for _ in range(2): conc = 0.5 * conc + 0.5 * (Mx @ conc)
                Gm_ = GNM(); o2g_ = template_map()[0]; gq = lambda nm: (Gm_.groups[Gm_.group_names.index(nm)] > 0.3)[o2g_]
                near_nose = gq("skin_exterior") & (mat == 0) & (np.linalg.norm(V - V[ids[1]], axis=1) < 0.45 * iod_) & ~gq("upper_lip") & ~gq("eyes")
                wc = np.clip((conc - 0.03) / 0.12, 0, 1) * near_nose * a.keep_nose_creases
                Cuv, _ = raster(S, g["tris"], np.c_[wc, wc, wc], vn, F, UV, UT)
                cuv = cv2.GaussianBlur(np.nan_to_num(Cuv[..., 0], nan=0.0).astype(np.float32), (0, 0), 0.002 * S)
                prot = np.maximum(prot, np.clip(cuv, 0, 1))
                rep["nose_creases_kept"] = {"vertices": int((wc > 0.5).sum()), "texels": int((cuv > 0.5).sum())}
            if a.occlusion > 0:
                AOuv, _ = raster(S, g["tris"], np.c_[ao, ao, ao], vn, F, UV, UT)
                tex8 = occlusion_lift(tex8, np.nan_to_num(AOuv[..., 0], nan=1.0), g["valid"], face_seen, prot, a.occlusion, rep)
            if a.skin_even > 0:
                tex8 = skin_even(tex8, g["valid"], face_seen, a.skin_even, prot, rep)
        tick("post_ao_skin_even")
        if gi == 0 and "components" in d:
            # eye-socket skin INSIDE the eyeball (pushed there by template_fit's eye-opening cleanup) shows through the
            # thin gap between the iris disc and the sclera as a skin-coloured ring: paint it as a dark socket instead
            comp = d["components"]; inner = np.zeros(len(F), bool)
            for cid in (1, 2):
                eb = np.where((comp == cid) & (mat == 4))[0]
                if len(eb) < 20: continue
                Pe = V[eb]; sol = np.linalg.lstsq(np.c_[2 * Pe, np.ones(len(Pe))], (Pe ** 2).sum(1), rcond=None)[0]
                ce = sol[:3]; re_ = np.sqrt(max(sol[3] + ce @ ce, 1e-12))
                dv = np.linalg.norm(V - ce, axis=1) / re_
                inner |= (dv[F] < 0.985).all(1)
            inner &= np.isin(mat[F], [0]).all(1)
            for t in np.where(inner)[0]:
                uv = UV[UT[t]] * (S - 1); uv[:, 1] = (S - 1) - uv[:, 1]
                cv2.fillPoly(tex8, [np.round(uv).astype(np.int32)], (30, 28, 38))
            rep["eye_socket_faces_darkened"] = int(inner.sum())
        if gi == 0 and a.nostril_dark > 0 and ids is not None:
            # 2026-10-21 option: the nostril interior (GNM skin that is not exterior skin, near the nose tip) is seen by no
            # photo at a useful angle; its walls took skin-coloured samples (bright streaks inside the nostrils seen from
            # below, me01). Fade it to the nostril's own darkest baked tone: the rim keeps the photo colour, darker inward.
            try:
                from gnm_model import GNM, template_map
                from scipy.spatial import cKDTree
                Gm = GNM(); o2g = template_map()[0]; gp = lambda nm: (Gm.groups[Gm.group_names.index(nm)] > 0.5)[o2g]
                tip = V[ids[1]]; iod_ = np.linalg.norm(V[ids[33]] - V[ids[263]])
                inner_v = gp("skin") & ~gp("skin_exterior") & ~gp("mouth_sock") & ~gp("eye_sockets") & (mat == 0)                     & (np.linalg.norm(V - tip, axis=1) < 0.3 * iod_)
                ext_v = gp("skin_exterior") & (mat == 0) & (np.linalg.norm(V - tip, axis=1) < 0.4 * iod_)
                if inner_v.sum() >= 20 and ext_v.sum() >= 20:
                    # v2 (10/22, user: "dark and bright mixed inside"): depth = distance ALONG the surface from the rim
                    # (straight-line distance to the nearest exterior skin was short on the columella wall: thin tissue)
                    from scipy.sparse import coo_matrix
                    from scipy.sparse.csgraph import dijkstra
                    e = np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]
                    e = e[inner_v[e[:, 0]] & inner_v[e[:, 1]]]
                    ln = np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1)
                    Gs = coo_matrix((np.r_[ln, ln], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(len(V), len(V))).tocsr()
                    ee = np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]
                    rim = np.unique(np.r_[ee[inner_v[ee[:, 0]] & ext_v[ee[:, 1]], 0], ee[inner_v[ee[:, 1]] & ext_v[ee[:, 0]], 1]])
                    dg = dijkstra(Gs, indices=rim, min_only=True) if len(rim) else np.full(len(V), np.inf)
                    # the change happens on the rim itself (exterior 0 -> rim 0.7), fully dark 0.006 IOD inside it: no light
                    # band left inside the opening (a 0.012 IOD ramp from 0 still showed one, me01 10/22)
                    dgf = np.nan_to_num(dg, nan=1.0, posinf=1.0)
                    wv = np.where(inner_v, 0.7 + 0.3 * np.clip(dgf / (0.006 * iod_), 0, 1), 0.0)
                    # the exterior ring right at the opening faces INTO the nostril (GNM calls it exterior skin; occluded):
                    # a light streak stayed there (me01 10/22). Strongly occluded ring vertices are painted too; the
                    # columella underside / alar outside (less occluded) keep the photo colour
                    if 'ao' not in dir():
                        from mesh_ao import vertex_ao
                        ao = vertex_ao(V, F, vn)
                    ring = np.zeros(len(V), bool); ring[np.r_[ee[inner_v[ee[:, 0]] & ext_v[ee[:, 1]], 1], ee[inner_v[ee[:, 1]] & ext_v[ee[:, 0]], 0]]] = True
                    wv = np.maximum(wv, np.where(ring, a.nostril_ring * np.clip((0.50 - ao) / 0.15, 0, 1), 0.0))
                    rep_ring = int((ring & (ao < 0.5)).sum())
                    Wuv, _ = raster(S, g["tris"], np.c_[wv, wv, wv], vn, F, UV, UT)
                    wt = np.nan_to_num(Wuv[..., 0], nan=0.0).astype(np.float32)
                    sel = wt > 0.5
                    if sel.sum() >= 50:
                        lum = tex8[sel].astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32)
                        dark = np.median(tex8[sel][lum <= np.percentile(lum, 15)].astype(np.float32), 0)
                        k = a.nostril_dark * wt[..., None]
                        tex8 = np.clip(tex8 * (1 - k) + dark[None, None] * k, 0, 255).astype(np.uint8)
                        nostril_k, nostril_tone = k, dark       # the albedo (자연광) map gets the same paint below
                        rep["nostril_dark"] = {"texels": int((wt > 0.01).sum()), "tone_bgr": [round(float(c), 1) for c in dark],
                                               "vertices": int(inner_v.sum()), "occluded_ring_vertices": rep_ring}
            except Exception as ex:
                print("nostril darkening skipped:", ex, file=sys.stderr)
        if gi == 0 and a.nose_black > 0 and ids is not None:
            # S15P31B204-413: black photo nostril colour on the nose / nostril walls (nose_black_clean). Region: GNM nose
            # region + nostril interior (as --nostril-dark); reference: open exterior nose skin (AO above 0.6)
            try:
                from gnm_model import GNM, template_map
                Gb = GNM(); o2g_b = template_map()[0]; gb = lambda nm, t: (Gb.groups[Gb.group_names.index(nm)] > t)[o2g_b]
                tip = V[ids[1]]; iod_ = np.linalg.norm(V[ids[33]] - V[ids[263]]); near = lambda r: np.linalg.norm(V - tip, axis=1) < r * iod_
                inner_b = gb("skin", 0.5) & ~gb("skin_exterior", 0.5) & ~gb("mouth_sock", 0.5) & ~gb("eye_sockets", 0.5) & (mat == 0) & near(0.3)
                if 'ao' not in dir():
                    from mesh_ao import vertex_ao
                    ao = vertex_ao(V, F, vn)
                tx = lambda f: np.nan_to_num(raster(S, g["tris"], np.c_[f, f, f], vn, F, UV, UT)[0][..., 0], nan=0.0)
                region = tx(((gb("nose_region", 0.3) & (mat == 0)) | inner_b).astype(np.float64)) > 0.5
                ref_src = tx((gb("skin_exterior", 0.5) & (mat == 0) & near(0.4) & (ao > 0.6)).astype(np.float64)) > 0.99
                tex8, nb = nose_black_clean(tex8, region, ref_src, a.nose_black)
                rep["nose_black"] = {"ratio": a.nose_black, "texels": nb, "nose_texels": int(region.sum())}
            except Exception as ex:
                print("nose black clean skipped:", ex, file=sys.stderr)
        if g["name"] == "eye" and a.sclera_clean > 0 and "components" in d:
            ang, th_i = eye_angle_map(S, g["tris"], V, F, UV, UT, mat, d["components"])
            tex8, ns = sclera_spill_clean(tex8, ang, th_i, a.sclera_clean)
            rep["sclera_clean"] = {"ratio": a.sclera_clean, "iris_edge_deg": None if th_i is None else round(th_i, 1), "texels": ns}
        cv2.imwrite(f"{a.out}_{g['name']}.png", tex8)
        if gi == 0 and a.albedo and neck_cut is not None:
            # lighting-free colour for the viewer's own lighting ("자연광" mode, relighting later)
            if 'ao' not in dir():
                from mesh_ao import vertex_ao
                ao = vertex_ao(V, F, vn)
            prot_ = prot if 'prot' in dir() else protect_uv_mask(S, V, F, UV, UT, ids)
            alb = albedo_from_texture(tex8, g["valid"], V, F, UV, UT, g["tris"], ao, face_seen, prot_, rep)
            if 'nostril_k' in dir():
                # the shading division lifts the dark nostril again (low shade there): paint it after the division too
                alb = np.clip(alb * (1 - nostril_k) + nostril_tone[None, None] * nostril_k, 0, 255).astype(np.uint8)
            cv2.imwrite(f"{a.out}_{g['name']}_albedo.png", alb)
        tick("post_albedo_write")
        mtl.append(f"newmtl {g['name']}\nKd 1 1 1\nmap_Kd {base}_{g['name']}.png\n")
        rep["groups"][g["name"]] = {"size": S, "texels": int(g["valid"].sum()), "seen": int(have.sum())}
    mtl.append("newmtl other\nKd 0.75 0.6 0.6\n")
    open(a.out + ".mtl", "w").write("".join(mtl))
    used = np.zeros(len(F), bool)
    with open(a.out + ".obj", "w") as fh:
        fh.write(f"mtllib {base}.mtl\n")
        for p in V: fh.write(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
        for t in UV: fh.write(f"vt {t[0]:.6f} {t[1]:.6f}\n")
        for g in groups:
            fh.write(f"usemtl {g['name']}\n"); used[g["tris"]] = True
            for t in g["tris"]: fh.write("f " + " ".join(f"{F[t, k] + 1}/{UT[t, k] + 1}" for k in range(3)) + "\n")
        fh.write("usemtl other\n")
        for t in np.where(~used)[0]: fh.write("f " + " ".join(f"{F[t, k] + 1}/{UT[t, k] + 1}" for k in range(3)) + "\n")
    tick("obj_write"); rep["timing_sec"] = TIMING
    json.dump(rep, open(a.out + ".bake.json", "w"), indent=1); print(json.dumps(rep))


if __name__ == "__main__":
    main()
