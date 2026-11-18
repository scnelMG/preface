"""Canonical face frame + automatic nose landmarks (with manual override).

Canonical frame (stored as a 4x4 source->canonical rigid transform, no scaling, det=+1, never mirrored):
  origin  = pronasale (nose tip) of the ORIGINAL scan
  +X      = normal of the estimated mid-sagittal symmetry plane, pointing to the viewer's right in front view
            (= subject's anatomical LEFT). Landmark names carry anatomical sides explicitly.
  +Y      = up: the declared scan up axis (up_hint), orthogonalised to +X. Pitch is NOT estimated automatically
            (a landmark-defined pitch oscillated in tests); a manual 'up' override can be given per case.
  +Z      = forward = X x Y (out of the face)

Landmark definitions (geometric definitions for this PoC; NOT clinical definitions):
  pronasale   most forward point of the mid-sagittal mesh section near the face centre
  nasion      deepest (min z) point of the mid-sagittal section between pronasale and the forehead peak
              (searched upward until z rises again by `drop`)
  subnasale   first significant local minimum of the mid-sagittal section below the pronasale
  D           nasion.y - subnasale.y  (vertical nose height; relative unit when mm is unknown)
  alar_crease_<side>  on the horizontal section y = sn + 0.25D, the most concave point of z(x) in 0.2D<|x|<0.9D
  tip_lat_<side>      on the horizontal section y = prn.y, first point where z drops 0.12D below pronasale z
All sections are exact plane/mesh intersections (not vertex strips).
"""
import numpy as np

try:
    from scipy.spatial import cKDTree
except Exception:  # pragma: no cover
    cKDTree = None


def nn_query(ref, q):
    if cKDTree is not None:
        d, i = cKDTree(ref).query(q)
        return d, i
    best_d = np.full(len(q), np.inf); best_i = np.zeros(len(q), int)
    for s in range(0, len(ref), 2048):
        dd = ((q[:, None, :] - ref[None, s:s + 2048, :]) ** 2).sum(-1)
        k = dd.argmin(1); v = dd[np.arange(len(q)), k]
        m = v < best_d; best_d[m] = v[m]; best_i[m] = k[m] + s
    return np.sqrt(best_d), best_i


def rigid_fit(A, B, w=None):
    """Least-squares R,t with R@A+t ~ B (Kabsch)."""
    if w is None:
        w = np.ones(len(A))
    w = w / w.sum()
    ca, cb = (A * w[:, None]).sum(0), (B * w[:, None]).sum(0)
    H = ((A - ca) * w[:, None]).T @ (B - cb)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    return R, cb - R @ ca


def icp(src, dst, iters=30, trim=0.85, init=None):
    R, t = (np.eye(3), np.zeros(3)) if init is None else init
    for _ in range(iters):
        p = src @ R.T + t
        d, i = nn_query(dst, p)
        keep = d <= np.quantile(d, trim)
        R2, t2 = rigid_fit(p[keep], dst[i[keep]])
        R, t = R2 @ R, R2 @ t + t2
    p = src @ R.T + t
    d, _ = nn_query(dst, p)
    return R, t, d


def axis_vec(spec):
    if not isinstance(spec, str):
        v = np.asarray(spec, float)
        return v / np.linalg.norm(v)
    if "," in spec:  # explicit vector "x,y,z" (e.g. from the frontal camera of a head-turn capture)
        v = np.array([float(t) for t in spec.split(",")])
        return v / np.linalg.norm(v)
    sgn = -1.0 if spec.startswith("-") else 1.0
    return sgn * np.eye(3)["XYZ".index(spec[-1].upper())]


def section(p, f, axis, value, samples=4):
    """Points on the intersection polyline of the mesh with plane p[:,axis]==value."""
    d = p[:, axis] - value
    df = d[f]
    sgn = np.sign(df)
    crosses = (sgn.min(1) < 0) & (sgn.max(1) > 0)
    pts = []
    for tri in f[crosses]:
        dd = d[tri]
        ends = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if dd[a] * dd[b] < 0:
                t = dd[a] / (dd[a] - dd[b])
                ends.append(p[tri[a]] + t * (p[tri[b]] - p[tri[a]]))
        if len(ends) == 2:
            for s in np.linspace(0, 1, samples):
                pts.append(ends[0] * (1 - s) + ends[1] * s)
    return np.array(pts).reshape(-1, 3)


def outer_profile(u, z, lo, hi, nbins):
    """max z per bin of coordinate u in [lo,hi]; returns bin centres, z (nan where empty)."""
    edges = np.linspace(lo, hi, nbins + 1)
    c = 0.5 * (edges[1:] + edges[:-1])
    zb = np.full(nbins, np.nan)
    idx = np.digitize(u, edges) - 1
    ok = (idx >= 0) & (idx < nbins)
    for b in np.unique(idx[ok]):
        zb[b] = z[ok][idx[ok] == b].max()
    good = ~np.isnan(zb)
    if good.sum() >= 2:
        zb = np.interp(c, c[good], zb[good])
    k = np.array([1, 2, 3, 2, 1], float); k /= k.sum()
    zs = np.convolve(np.pad(zb, 2, mode="edge"), k, mode="valid")
    return c, zs, good


def first_min(z, start, direction, min_rise):
    n = len(z)
    i, best = start, start
    while 0 <= i < n:
        if z[i] < z[best]:
            best = i
        if z[i] - z[best] >= min_rise and best != start:
            return best
        i += direction
    return best


def profile_landmarks(p, f, tip, search_r, seeds=None):
    """tip: current tip estimate (canonical-ish frame). Returns landmarks (same frame) and D.
    seeds: optional absolute y of MediaPipe landmarks {"n","sn","prn"} (mp_seed.py) used as search windows."""
    sec = section(p, f, 0, tip[0])
    q = sec - tip
    m = (np.abs(q[:, 1]) < search_r) & (q[:, 2] > -search_r)
    c, zs, good = outer_profile(q[m, 1], q[m, 2], -search_r, search_r, 200)
    # refine tip = profile max near the estimate
    win = np.abs(c) < 0.25 * search_r
    if seeds:
        # tip = most anterior profile point near the MediaPipe tip height (at +15 deg pitch the global max drifts
        # up the dorsum)
        cp = seeds["prn"] - tip[1]
        win = np.abs(c - cp) < 0.2 * max(seeds["n"] - seeds["prn"], 0.05 * search_r)
        if not win.any():
            win = np.abs(c) < 0.25 * search_r
    i0 = int(np.argmax(np.where(win, zs, -np.inf)))
    rise = 0.012 * search_r
    i_n = first_min(zs, i0, +1, rise)
    if seeds:
        # deepest profile point (nasion) inside a window around the MediaPipe nasion height
        # nasion = deepest concavity behind the chord (lower dorsum -> above the MediaPipe glabella). A chord-relative
        # depth is pitch-robust; the raw z-minimum is not (dorsal hump / forehead slope win when the pitch is off).
        cn, cg = seeds["n"] - tip[1], seeds["g"] - tip[1]
        span = max(cn - c[i0], 0.05 * search_r)
        c_lo, c_hi = max(cn - 0.35 * span, c[i0] + 0.1 * span), cg + 0.2 * span
        j_lo, j_hi = int(np.argmin(np.abs(c - c_lo))), int(np.argmin(np.abs(c - c_hi)))
        if j_hi > j_lo + 2:
            a_ = np.array([c[j_lo], zs[j_lo]]); b_ = np.array([c[j_hi], zs[j_hi]])
            d_ = (b_ - a_) / max(np.linalg.norm(b_ - a_), 1e-12)
            n_ = np.array([-d_[1], d_[0]])          # normal with +z component (d_ goes up in c)
            if n_[1] < 0:
                n_ = -n_
            idx = np.arange(j_lo, j_hi + 1)
            dist = (np.stack([c[idx], zs[idx]], 1) - a_) @ n_
            i_n = int(idx[np.argmin(dist)])
    N = c[i_n] - c[i0]
    # upper lip (labrale superius): first local max >=0.4N below the tip, after the profile dropped >= 0.15N, rising >=0.05N;
    # subnasale: profile point between tip and lip farthest behind the tip->lip chord (max concavity)
    i_ls, lowest = None, zs[i0]
    for j in range(i0 - 1, 0, -1):
        lowest = min(lowest, zs[j])
        if c[i0] - c[j] >= 0.4 * N and zs[i0] - lowest >= 0.15 * N and zs[j] - lowest >= 0.05 * N and zs[j] >= zs[j - 1]:
            i_ls = j
            break
        if c[i0] - c[j] > 2.0 * N:
            break
    if seeds:
        # subnasale = max concavity behind the chord tip -> (point well below the seed), within a window around the
        # MediaPipe subnasale height; robust to +-15 deg pitch where the plain profile extrema jump
        csn = seeds["sn"] - tip[1]
        h = max(c[i0] - csn, 0.05 * search_r)
        lo_c = csn - 0.8 * h
        j_lo = int(np.argmin(np.abs(c - lo_c)))
        a = np.array([c[i0], zs[i0]]); b = np.array([c[j_lo], zs[j_lo]])
        dvec = (b - a) / max(np.linalg.norm(b - a), 1e-12)
        nvec = np.array([dvec[1], -dvec[0]])
        idx = np.where((np.abs(c - csn) < 0.45 * h) & (c < c[i0]))[0]
        if len(idx):
            dist = (np.stack([c[idx], zs[idx]], 1) - a) @ nvec
            # "behind the chord" = toward the face (smaller z): orient nvec toward +z, then the most negative is deepest
            if nvec[1] < 0:
                dist = -dist
            i_sn = int(idx[np.argmin(dist)])
        else:
            i_sn = first_min(zs, i0, -1, rise)
    elif i_ls is None:
        i_sn = first_min(zs, i0, -1, rise)
    else:
        a = np.array([c[i0], zs[i0]]); b = np.array([c[i_ls], zs[i_ls]])
        dvec = (b - a) / np.linalg.norm(b - a)
        nvec = np.array([dvec[1], -dvec[0]])
        idx = np.arange(i_ls, i0 + 1)
        pts = np.stack([c[idx], zs[idx]], 1) - a
        dist = pts @ nvec
        if np.mean(dist) > 0:
            dist = -dist
        i_sn = int(idx[np.argmin(dist)])
    base = np.array([tip[0], tip[1], tip[2]])
    prn = base + [0, c[i0], zs[i0]]
    nas = base + [0, c[i_n], zs[i_n]]
    sn = base + [0, c[i_sn], zs[i_sn]]
    D = float(nas[1] - sn[1])
    lm = {"pronasale": prn, "nasion": nas, "subnasale": sn}
    for name, yy, mode in (("alar_crease", sn[1] + 0.25 * D, "crease"), ("tip_lat", prn[1], "drop")):
        hs = section(p, f, 1, yy)
        hs = hs[(np.abs(hs[:, 0] - prn[0]) < 1.1 * D) & (hs[:, 2] > prn[2] - 1.0 * D)]
        for sgn in (1, -1):
            s = (hs[:, 0] - prn[0]) * sgn > 0
            xx, zz = (hs[s, 0] - prn[0]) * sgn, hs[s, 2]
            cc, zb, good = outer_profile(xx, zz, 0, 1.0 * D, 60)
            if mode == "crease":
                d2 = np.gradient(np.gradient(zb, cc), cc)
                w = (cc > 0.2 * D) & (cc < 0.9 * D) & good
                k = int(np.argmax(np.where(w, d2, -np.inf)))
            else:
                below = zb < prn[2] - 0.12 * D
                k = int(np.argmax(below)) if below.any() else len(cc) - 1
            anat = "subject_left" if sgn > 0 else "subject_right"
            lm[f"{name}_{anat}"] = np.array([prn[0] + sgn * cc[k], yy, zb[k]])
    return lm, D


def canonicalize(v, f, up_hint="+Y", fwd_hint="+Z", manual=None, log=None, col=None, seed=True):
    """seed: use MediaPipe front-view landmarks as search windows (pitch robustness, mp_seed.py); falls back to the
    pure profile search when no face is detected or MediaPipe is unavailable."""
    log = log if log is not None else []
    up, fw = axis_vec(up_hint), axis_vec(fwd_hint)
    fw = fw - up * (fw @ up); fw /= np.linalg.norm(fw)  # vector hints need not be exactly orthogonal
    R_total = np.stack([np.cross(up, fw), up, fw])  # rows = canonical axes in source coords
    p = v @ R_total.T
    ext = float((p.max(0) - p.min(0)).max())
    tip = p[np.argmax(p[:, 2])]
    D = None
    for it in range(3):
        rad = 0.30 * ext if D is None else 2.0 * D
        q = p - tip
        patch = q[np.linalg.norm(q, axis=1) < rad]
        mir = patch * np.array([-1, 1, 1])
        Rm, _, _ = icp(mir, patch, iters=25)
        w, V = np.linalg.eig(Rm @ np.diag([-1, 1, 1]))
        n = np.real(V[:, np.argmin(np.real(w))]); n /= np.linalg.norm(n)
        if n[0] < 0:
            n = -n
        # pitch policy: keep the scanner/hint up axis (landmark-defined pitch proved unstable in tests:
        # profile minima move with pitch). Only yaw/roll are refined from the symmetry plane.
        uv = np.array([0.0, 1.0, 0.0])
        uv = uv - n * (uv @ n); uv /= np.linalg.norm(uv)
        fv = np.cross(n, uv)
        Rk = np.stack([n, uv, fv])
        p = p @ Rk.T
        tip = tip @ Rk.T
        R_total = Rk @ R_total
        # midline x: centre of mirrored-ICP is ambiguous -> use x of the tip after rotation
        sd = None
        if seed:
            try:
                import mp_seed
                Dg = D if D else 0.167 * ext
                sd = mp_seed.seeds(p, f, col, tip, Dg)
                if sd is None and D is None:
                    sd = mp_seed.seeds(p, f, col, tip, 0.35 * ext)   # wider view if the first guess missed the face
                if sd and abs(sd["prn"] - tip[1]) > 0.2 * (sd["n"] - sd["sn"]):
                    # the most anterior point was not the nose (chin/lips forward when pitch is off): restart the
                    # search at the MediaPipe tip
                    hh = sd["n"] - sd["sn"]
                    near = (np.abs(p[:, 1] - sd["prn"]) < 0.1 * hh) & (np.abs(p[:, 0] - sd["prn_x"]) < 0.15 * hh)
                    if near.any():
                        tip = p[np.where(near)[0][np.argmax(p[near, 2])]]
                        log.append(f"iter {it}: tip re-seeded from MediaPipe")
            except Exception as e:  # MediaPipe missing etc. -> profile only
                log.append(f"seed unavailable: {type(e).__name__}")
        lm, D = profile_landmarks(p, f, tip, 1.5 * (D if D else 0.167 * ext), seeds=sd)
        if sd:
            log.append(f"iter {it}: mediapipe seeds n={sd['n']:.4g} sn={sd['sn']:.4g} prn={sd['prn']:.4g}")
        tip = lm["pronasale"]
        log.append(f"iter {it}: sym_normal={np.round(n, 4).tolist()} fwd={np.round(fv, 4).tolist()} D={D:.5g}")
    origin = lm["pronasale"].copy()
    lm = {k: val - origin for k, val in lm.items()}
    manual_keys = []
    if manual:
        for k, val in manual.items():  # manual override given in SOURCE coordinates
            lm[k] = (np.asarray(val, float) @ R_total.T) - origin
            manual_keys.append(k)
        log.append("manual landmark override: " + ",".join(manual_keys))
        D = float(lm["nasion"][1] - lm["subnasale"][1])
    T = np.eye(4); T[:3, :3] = R_total; T[:3, 3] = -origin
    assert np.linalg.det(R_total) > 0.999, "canonical transform must be a proper rotation (no mirroring)"
    pc = p - origin
    return pc, T, lm, float(D), log, manual_keys
