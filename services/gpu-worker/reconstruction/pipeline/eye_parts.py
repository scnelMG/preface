"""W7-eye E1' (2026-10-20): RESTORATION eye deformation basis - parameters -> displacement of the skin around the eyes.
Used by pipeline/eye_parts_fit.py (E2~E4, 2026-10-20) for the OPTIONAL candidate `gnme` (scan_to_model.py --eye-parts);
nothing here changes a default. Shares the biharmonic spread with face_rig.py (the viewer's edit sliders keep working on
top of whatever this adds: restoration goes into the base shape, edits are relative to it).

Parameters per eye ("L" / "R" = the subject's side), every length a FRACTION OF THE EYE WIDTH (outer -> inner corner of
that eye), so there is no per-person constant anywhere; 0 = GNM mean lid (nothing moves):
  crease   heights [outer, mid, inner]  crease-line height above the lash line at u = 0.2 / 0.5 / 0.8 (0 = no crease
                                        there; a tapered fold = inner 0, 속쌍꺼풀 후보 of parts_v1)
           depth                        groove depth along the inward normal in a 2-3 vertex band on the line
           bulge                        forward push of the lid skin between the lash line and the crease (pretarsal show)
           fold                         OVERHANG (2026-10-20, 만두: a groove alone reads as a dent, not a fold): the skin band
                                        just above the groove (0.5-3 band widths) is pushed forward by `fold` and down by
                                        fold_sag x fold (default 0.3), so it hangs over the groove like the real upper-lid
                                        fold (anatomy, 만두 10/20: the levator pulls the crease skin IN toward the eyeball, the
                                        skin above drapes down over the pretarsal skin, which stays on the tarsal plate)
           mode                         "lid" (2026-11-13, pipeline/lid_fold.py: one step in the lid's front skin, the
                                        lining behind the lid and the lid margin held), "groove" (groove band on the line +
                                        fold band above) or "tuck" (2026-10-20,
                                        anatomy, 만두: the levator pulls the crease skin in and the PRETARSAL skin (lash ->
                                        crease) rolls in and up UNDER the skin above, which stays): displacement inward
                                        growing from 0 at the lash line to `depth` at the crease, blended out over one band
                                        above it, plus an upward tuck of tuck_up x depth. No skin is pushed forward.
           tuck_up                      upward share of the tuck (ratio of depth, default 0.3, tuck mode)
           curve                        "linear" (default: piecewise-linear through the 3 heights, a kink at u 0.5) or "smooth"
                                        (cosine-eased between the nodes, 2026-10-21 만두: the line looked bumpy)
           fold_sag                     downward share of the overhang (ratio of fold, default 0.3)
           fold_width                   height of the thickened band above the groove (x eye width, default 0.12): the folded
                                        skin doubles up, so the lid ABOVE the crease gains volume (만두 10/20), thickest just
                                        above the groove and fading toward the brow
         The groove / bulge / fold all FADE with the crease height (weight (h / 0.06)^0.5, 0 at h = 0) so an in-out fold
         melts into the lash line instead of ending in a kink (만두 10/20: the line looked unnatural). REMOVED for new fits
         10/23 (만두): eye_parts_fit writes crease.fade_min 0 (no fade); files without the key keep the 0.06 fade.
  fullness [low, mid, high]             upper-lid depth profile in 3 height bands lash -> brow (+ fuller, - hollower, along
                                        the normal), the E3 target
  epicanthus cover                      skin at the inner corner moved toward the nose (covers the caruncle), E4 target
           angle_deg                    tilt of the covering edge (+ = the fold runs down-and-out)
Rules: the lid EDGE (upper / lower lid landmark vertices) and all other landmarks are held, the eyeball (components 1 / 2)
never moves, and no skin vertex may end up inside the eyeball surface (radial clamp at 1.5 % outside, as eye_fit drapes
the lids). Displacements are spread with a constrained biharmonic solve on the skin graph near the eyes.

API    EyeBasis(V, F, mat, comp, lid)  ->  .displace(params) -> D (n, 3);  .apply(params) -> V + D
       params = {"L": {...}, "R": {...}} (missing keys = 0);  zero_params()
usage  python pipeline/eye_parts.py --selftest                      (template mean: zero -> 0, flips 0, symmetry)
       python pipeline/eye_parts.py --apply work/<id> [--params p.json | --from-parts] --out work/<id>/model/eye_parts_test.ply [--render x.png]
"""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)

EYE = {"R": {"up": [246, 161, 160, 159, 158, 157, 173], "lo": [7, 163, 144, 145, 153, 154, 155], "c": (33, 133),
             "brow_lo": [46, 53, 52, 65, 55], "comp": 2},
       "L": {"up": [466, 388, 387, 386, 385, 384, 398], "lo": [249, 390, 373, 374, 380, 381, 382], "c": (263, 362),
             "brow_lo": [276, 283, 282, 295, 285], "comp": 1}}
RING = {"R": [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
        "L": [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]}
CREASE_U = np.array([0.2, 0.5, 0.8])               # where the three crease heights are given (eye-width coordinate)


def nodes_of(c):
    """u of the height nodes of a crease param dict: explicit "u" (10/23 --crease-curve direct: the measured columns) or
    crease_nodes(len(heights))"""
    hs = c.get("heights") or [0, 0, 0]; u = c.get("u")
    return np.asarray(u, float) if u is not None and len(u) == len(hs) else crease_nodes(len(hs))


def crease_nodes(n):
    """u of the crease height nodes for a heights list of length n: 3 = CREASE_U (as before); otherwise n nodes evenly over
    0.1-0.9 (10/23 option, 만두: 3 nodes cannot hold an inline fold that sinks into the lash line nasally - the 0.8 value was
    kept up to u 0.95, so chae01 looked outline / in-out)"""
    return CREASE_U if n == 3 else np.linspace(0.1, 0.9, n)
CREASE_BAND = 0.03                                 # half width of the groove band (x eye width) ~ 2-3 vertices
EYEBALL_CLEAR = 1.015                              # skin stays this far outside the eyeball (radius ratio), as eye_fit
PATCH = 0.75                                       # active region: skin within this x eye width of the eye centre
END_FW_MIN = 0.2                                   # end_shrink: the bulge height never below this share of fold_width at the ends
DRAPE_LO = 0.015                                   # drape mode: lower pocket wall height below the line (x eye width)
SLIDE_SIGMA = 0.07                                 # crease "slide" (10/23 option): reach of the pull toward the crease line (x eye width)
ROLL_RISE = 0.3                                    # fold roll: the underside rises from the groove bottom over this x fold_width (rounded, thick)
ROLL_TOP = 0.55                                    # ... stays at full height until this x fold_width, then fades to the untouched skin
SAG_LIMIT = 0.5                                    # fold sag (down, x eye width) <= this x the vertex's height above the crease line: the draped
                                                   # band never crosses the crease row (2026-10-21: 120 inverted faces on the detail mesh, 0 on base)
RING_HOLD = 0.015                                  # detail layer: skin within this (x eye width) of the eye-opening polyline is held (EyeBasis(ring_hold=...))


def _poly_dist(P, Q):
    """distance of each point of P to the closed polyline Q (any dimension)"""
    out = np.full(len(P), np.inf)
    for i in range(len(Q)):
        a, b = Q[i], Q[(i + 1) % len(Q)]; ab = b - a; L2 = float(ab @ ab) + 1e-12
        s_ = np.clip(((P - a) @ ab) / L2, 0, 1); out = np.minimum(out, np.linalg.norm(P - (a + s_[:, None] * ab), axis=1))
    return out


def zero_params():
    e = {"crease": {"heights": [0.0, 0.0, 0.0], "depth": 0.0, "bulge": 0.0, "fold": 0.0}, "fullness": [0.0, 0.0, 0.0],
         "epicanthus": {"cover": 0.0, "angle_deg": 0.0}}
    return {"L": json.loads(json.dumps(e)), "R": json.loads(json.dumps(e))}


def _get(p, *ks, default=0.0):
    for k in ks:
        p = p.get(k) if isinstance(p, dict) else None
        if p is None: return default
    return p


def slide_above(above, h, amt, sig=SLIDE_SIGMA):
    """10/23 option crease "slide" (G6, gyu01: on the base mesh the seen groove stayed on one vertex row 0.04-0.056 above the
    photo lash for ANY crease height from -0.03 to +0.045 around the fitted one - no row near the photo crease 0.08-0.10, the
    groove sat halfway down and its shadow merged with the lid edge's into a wide faint band): lid skin vertices near the
    crease line slide ALONG the surface toward it, so a vertex row lies on the line (no new vertices, same topology / UV).
    above' = above - amt (above - h) exp(-((above - h) / sig)^2): monotone for amt < 1 (no vertex passes another in a
    column), 0 at the lid margin (taper over 0.008-0.028 above the lash) and where the line ends (h -> 0)"""
    x = (above - h) / sig; mv = amt * (above - h) * np.exp(-x * x)
    tl = np.clip((above - 0.008) / 0.02, 0, 1); tl = tl * tl * (3 - 2 * tl)
    return above - mv * tl * np.clip(h / 0.02, 0, 1) * (h > 0.005)


def _sphere(P):
    sol = np.linalg.lstsq(np.c_[2 * P, np.ones(len(P))], (P ** 2).sum(1), rcond=None)[0]
    c = sol[:3]; return c, float(np.sqrt(max(sol[3] + c @ c, 1e-12)))


class EyeBasis:
    def __init__(self, V, F, mat, comp, lid, ring_hold=0.0, normal_smooth=0, target_mask=None, hold_below_lash=False, patch=PATCH):
        """ring_hold (x eye width): also hold skin vertices within this 3-D distance of the eye-opening polyline (the detail
        layer inserts vertices between the ring landmarks; 0 = landmarks only = base behaviour). normal_smooth: passes of
        neighbour averaging of the vertex normals used as displacement directions (0 = raw normals = base behaviour; the
        detail layer needs ~3: raw normals turn ~90 deg across the lid fold within a few fine faces and fold the band).
        target_mask: bool per vertex - targets are set only on these vertices, the others are interpolated by the biharmonic
        solve (detail layer: targets on the BASE vertices only -> the fine vertices follow a smooth field instead of a
        per-vertex analytic value that folds small faces; None = all vertices). hold_below_lash (detail layer, 2026-10-21):
        skin BELOW the lash line inside the patch (the eye_fit drape inside the opening: sliver faces that flip under any
        displacement differential) is held at 0 - the crease / fold never targets it, so the base result is unchanged.
        patch (x eye width, default PATCH): radius of the active region; S2.5 lid volume uses 1.1 so the lateral orbital rim
        / brow bone that forms the oblique outline is inside (the depth limit widens with it)"""
        from face_rig import _graph, _bilap
        from render import vertex_normals
        self.V = np.asarray(V, np.float64); self.F = np.asarray(F, np.int64); self.mat = np.asarray(mat); self.comp = np.asarray(comp)
        self.lid = np.asarray(lid, np.int64); self.n = len(self.V)
        L = self.V[self.lid]
        x = L[263] - L[33]; x /= np.linalg.norm(x); up = L[10] - L[152]; up -= x * (up @ x); up /= np.linalg.norm(up)
        fw = np.cross(x, up); fw *= np.sign((L[1] - L[[33, 263]].mean(0)) @ fw)
        self.axes = {"right": x, "up": up, "fwd": fw}
        self.skin = self.mat == 0
        skinF = self.F[self.skin[self.F].all(1)]
        self.N = vertex_normals(self.V, skinF)
        _, e = _graph(self.V, skinF); self.Bi, self.active = _bilap(self.n, e)
        self.ring_hold, self.normal_smooth, self.hold_below_lash = float(ring_hold), int(normal_smooth), bool(hold_below_lash)
        patch_r = float(patch); self.patch_r = patch_r
        self.target_mask = None if target_mask is None else np.asarray(target_mask, bool)
        if self.normal_smooth > 0:
            from scipy.sparse import coo_matrix, diags
            A = coo_matrix((np.ones(2 * len(e)), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(self.n, self.n)).tocsr(); A.data[:] = 1.0
            Mavg = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A; Ns = self.N.copy()
            for _ in range(self.normal_smooth): Ns = Mavg @ Ns; Ns /= np.linalg.norm(Ns, axis=1, keepdims=True) + 1e-12
            self.N = Ns
        self.active &= self.skin
        self.eyes = {}
        for S, e_ in EYE.items():
            a, b = L[e_["c"][0]], L[e_["c"][1]]; ew = float(np.linalg.norm(b - a)); t = (b - a) / ew
            u = up - t * (up @ t); u /= np.linalg.norm(u)
            ball = np.where((self.comp == e_["comp"]) & (self.mat == 4))[0]
            cen, r = _sphere(self.V[ball]) if len(ball) >= 20 else (None, None)
            P = (self.V - a) / ew; uv = np.c_[P @ t, P @ u]; depth = P @ fw
            lash = L[e_["up"]]; lash_uv = np.c_[(lash - a) @ t, (lash - a) @ u] / ew
            brow = L[e_["brow_lo"]]; brow_uv = np.c_[(brow - a) @ t, (brow - a) @ u] / ew
            # the 7 upper-lid landmark VERTICES are unevenly placed on the template (chae01 / eun02: v 0.24 at u 0.44, 0.18 at
            # 0.57, 0.18 at 0.78 - the same pattern on every fit = the 468 -> vertex map), so the lash reference is a smooth
            # parabola through them and the two corners (v = 0 at u = 0 / 1), as MediaPipe's own lid arc is (E2, 2026-10-20)
            lu = np.r_[lash_uv[:, 0], 0.0, 1.0]; lv = np.r_[lash_uv[:, 1], 0.0, 0.0]
            lash_pc = np.polyfit(lu, lv, 2); lash_v = np.polyval(lash_pc, uv[:, 0])
            brow_v = np.polyval(np.polyfit(brow_uv[:, 0], brow_uv[:, 1], 2), uv[:, 0])
            centre = (a + b) / 2 + u * 0.15 * ew
            patch = self.active & (np.linalg.norm(self.V - centre, axis=1) < patch_r * ew) & (depth > -0.6 * patch_r / PATCH)
            from scipy.spatial import cKDTree
            ring = self.lid[RING[S]]; ring_d = cKDTree(uv[ring]).query(uv)[0]      # eye-width distance to the opening
            # W8b detail layer (2026-10-20): the eye-opening ring must also hold the vertices that subdivision inserted
            # BETWEEN the ring landmarks (midpoints of ring edges), or they move while their neighbours stay (105 flipped
            # faces on chae01 detail). Vertices within RING_HOLD of the ring polyline are held; on the base mesh no other
            # vertex is that close (spacing 0.065), so the base behaviour is unchanged
            if ring_hold > 0: ring = np.unique(np.r_[ring, np.where(self.skin & (_poly_dist(self.V, self.V[ring]) < ring_hold * ew))[0]])   # 3-D distance
            # 10/24: beyond the outer corner (u < 0) the lash reference of a crease that runs on past it (--crease-continue) is
            # the FACE-horizontal line through the corner, like the photo measurement's screen-horizontal extension
            x_slope = float((x @ u) / (x @ t)) if abs(x @ t) > 1e-6 else 0.0
            self.eyes[S] = {"a": a, "t": t, "u": u, "ew": ew, "uv": uv, "lash_v": lash_v, "lash_pc": lash_pc, "x_slope": x_slope, "brow_v": brow_v, "patch": patch,
                            "ball_c": cen, "ball_r": r, "ring": ring, "ring_d": ring_d, "inner": b}
        self.held = np.unique(self.lid)                      # every landmark vertex is a (zero) constraint unless targeted
        # B (2026-10-20): the lash reference is the skin mesh's own EYE-OPENING boundary loop (edges used by one skin
        # triangle, near the eye), not the 7 unevenly placed landmark vertices: parabola through its upper vertices + corners
        E_ = np.sort(np.vstack([skinF[:, [0, 1]], skinF[:, [1, 2]], skinF[:, [2, 0]]]), axis=1)
        _, inv, cnt = np.unique(E_, axis=0, return_inverse=True, return_counts=True)
        bnd = np.unique(E_[cnt[inv] == 1])
        for S, e_ in self.eyes.items():
            uv = e_["uv"]; cand = bnd[e_["patch"][bnd] & (e_["ring_d"][bnd] < 0.15)]
            up_ = cand[(uv[cand, 1] > 0.01) & (uv[cand, 0] > 0.05) & (uv[cand, 0] < 0.95)]
            e_["open_up"] = up_; e_["lash_source"] = "landmarks"
            if len(up_) >= 6:
                lu = np.r_[uv[up_, 0], 0.0, 1.0]; lv = np.r_[uv[up_, 1], 0.0, 0.0]
                e_["lash_pc"] = np.polyfit(lu, lv, 2); e_["lash_v"] = np.polyval(e_["lash_pc"], uv[:, 0]); e_["lash_source"] = f"opening loop ({len(up_)} vertices)"
            if self.hold_below_lash:          # skin INSIDE the eye-opening polygon (the drape), not the lower lid
                from matplotlib.path import Path
                poly = Path(uv[self.lid[RING[S]]]); inside = poly.contains_points(uv)
                below = np.where(self.skin & e_["patch"] & inside & (uv[:, 1] < e_["lash_v"] - 0.005))[0]
                e_["ring"] = np.unique(np.r_[e_["ring"], below]); e_["held_below_lash"] = int(len(below))

    # ---- per-eye targets: {vertex: displacement} --------------------------------------------------------------------
    def _targets(self, S, p):
        e = self.eyes[S]; uv, N, ew = e["uv"], self.N, e["ew"]
        T = {}
        def add(idx, d):
            for i, dd in zip(idx, d): T[int(i)] = T.get(int(i), 0) + dd
        patch = np.where(e["patch"] & (self.target_mask if self.target_mask is not None else True))[0]
        u, v = uv[patch, 0], uv[patch, 1]; above = v - e["lash_v"][patch]        # height above the lash line
        brow_h = e["brow_v"][patch] - e["lash_v"][patch]
        # crease: groove band on the line v = lash + h(u), h interpolated from the 3 heights (0 = no crease there)
        hs = np.asarray(_get(p, "crease", "heights", default=[0, 0, 0]), float)
        depth, bulge, fold = float(_get(p, "crease", "depth")), float(_get(p, "crease", "bulge")), float(_get(p, "crease", "fold"))
        sag = float(_get(p, "crease", "fold_sag", default=0.3)); fw_ = float(_get(p, "crease", "fold_width", default=0.12))
        mode = _get(p, "crease", "mode", default="groove") or "groove"; tuck_up = float(_get(p, "crease", "tuck_up", default=0.3))
        curve = _get(p, "crease", "curve", default="linear") or "linear"
        nd_ = nodes_of(p.get("crease") or {}) if isinstance(p, dict) else crease_nodes(len(hs))
        u_lo, u_hi = (0.03, 0.97) if len(hs) > 7 else (0.05, 0.95)          # direct curve reaches nearer the corners (10/23)
        if len(nd_) and nd_[0] < 0 and (hs[np.asarray(nd_) < 0] > 0).any():  # 10/24: the line continues past the outer corner
            u_lo = float(nd_[0]) - 1e-6
            above = np.where(u < 0, v - (float(np.polyval(e["lash_pc"], 0.0)) + e["x_slope"] * u), above)
        # 10/23 options (묶음 B, 만두: the seen line sat 0.02-0.05 above the yellow line, gyu's low fold looked faint):
        # line "edge" = the given height is where the fold EDGE shows (the middle of the roll's underside), so the groove row
        # goes down by half the underside rise (ROLL_RISE x fold_width / 2) - crease_line() still reports the given height;
        # fade_min = the height below which groove / fold melt away (0.06 before: a fold 0.02-0.04 above the lash lost up to
        # half its depth all along)
        line_edge = (_get(p, "crease", "line", default="groove") or "groove") == "edge"
        fade_min = float(_get(p, "crease", "fade_min", default=0.06))   # key absent = files written before 10/23 (old behaviour)
        # 10/23 (만두: "흐림 규칙 제거"): eye_parts_fit now writes fade_min 0 = no height fade (the measured curve's 0-ramp
        # beyond the line ends does the end smoothing); 0.06 stays the value for parameter files without the key
        fade_of = lambda h_: (np.clip(h_ / fade_min, 0, 1) ** 0.5) if fade_min > 0 else (h_ > 0).astype(float)
        edge_shift = 0.5 * ROLL_RISE * fw_ if (line_edge and fold != 0) else 0.0
        def h_of(uq):
            if curve == "smooth":
                k = np.clip(np.searchsorted(nd_, uq) - 1, 0, len(nd_) - 2); tt = np.clip((uq - nd_[k]) / np.maximum(nd_[k + 1] - nd_[k], 1e-9), 0, 1)
                w = 0.5 - 0.5 * np.cos(np.pi * tt); hk = hs[k] * (1 - w) + hs[k + 1] * w
                return np.where(uq < nd_[0], hs[0], np.where(uq > nd_[-1], hs[-1], hk))
            return np.interp(uq, nd_, hs, left=hs[0], right=hs[-1])
        slide = float(_get(p, "crease", "slide", default=0.0) or 0.0)
        # 10/23 option crease "push" "forward" (G6, gyu01 faint line): the tuck / roll move along the face's forward axis
        # instead of the vertex normal. On the upper lid the normal leans down, so the inward push (-N) also LIFTED the crease
        # row (+0.009..0.019 x ew in the photos, the tuck_up share another +0.012..0.015); the closed loop lowered the
        # heights by that lift, which squeezed gyu01's pretarsal band (photo 0.08) to 0.02-0.04 - a backward-sloping, shaded
        # ramp from the lid edge into the groove, one wide soft band instead of a bright strip and a line
        if (_get(p, "crease", "push", default="normal") or "normal") == "forward": N = np.broadcast_to(self.axes["fwd"], N.shape)
        # 10/24 option crease "end_taper" (만두: both people's line ENDS rose above the yellow points): the groove kept its full
        # depth right to where the line stops (gyu01 / chae01 outer end: height 0.13-0.24 at u 0.03, then nothing), so the cut
        # end showed as a dark cap rising from the groove; the depth (not the height) now fades out over this much u at both
        # ends of the line (0 = as before)
        etp = float(_get(p, "crease", "end_taper", default=0.0) or 0.0)
        def end_w(uq, rng=None):
            rng = etp if rng is None else rng
            if rng <= 0: return np.ones_like(uq)
            ug = np.linspace(0, 1, 401); on_ = (h_of(ug) * (ug > u_lo) * (ug < u_hi)) > 0.005
            if not on_.any(): return np.ones_like(uq)
            a_, b_ = ug[on_].min(), ug[on_].max(); w_ = np.clip((uq - a_) / rng, 0, 1) * np.clip((b_ - uq) / rng, 0, 1)
            return w_ * w_ * (3 - 2 * w_)
        # 10/24 option crease "end_shrink" (만두, chae01 fwdEcST1 circled at both OUTER ends: the skin bulge above the line kept
        # its full height (fold_width) to where the line stops, so its end outline curved UP above the yellow end): with
        # end_taper, the bulge's height also narrows toward the line ends (fold_width x the end weight, at least END_FW_MIN)
        # - the overhang thins out toward the canthus and its outline closes onto the line's end. Value = the u range of that
        # narrowing (True = end_taper's range; the first try with 0.1 left the bulge at full size from u 0.08 on)
        _es = _get(p, "crease", "end_shrink", default=0.0)
        e_rng = (etp if _es is True else float(_es or 0.0)); e_shrink = e_rng > 0
        if (hs > 0).any() and mode == "lid" and depth != 0:
            import lid_fold
            add(*lid_fold.targets(self, S, p))
        elif (hs > 0).any() and mode == "tuck" and depth != 0:
            h = h_of(u) * (u > u_lo) * (u < u_hi)
            ewt = end_w(u); fade = fade_of(h) * ewt
            fwv = fw_ * np.clip(end_w(u, e_rng), END_FW_MIN, 1.0) if e_shrink else np.full(len(u), fw_)
            if e_shrink: fade = fade_of(h) * np.minimum(ewt, end_w(u, e_rng) ** 0.5)      # the bulge's height fades with it
            if edge_shift: h = np.where(h > 0, np.maximum(h - edge_shift, 0.4 * h), 0.0)      # groove row under the shown edge
            if slide > 0:                     # vertices slide along the surface toward the line; the profile is evaluated where they land
                a2 = slide_above(above, h, slide); mvd = (a2 - above) * ew; sl_ = np.abs(mvd) > 1e-9
                tu_ = e["u"][None] - N[patch] * (N[patch] @ e["u"])[:, None]; tu_ /= np.linalg.norm(tu_, axis=1, keepdims=True) + 1e-12
                add(patch[sl_], tu_[sl_] * mvd[sl_, None]); above = a2
            lowr = (h > 0.005) & (above > 0.008) & (above <= h)                      # pretarsal skin: 0 at the lash -> depth at the crease
            # 10/23 option crease "tuck_pow" (G6, gyu01: with the loop-lowered heights 0.02-0.04 the whole pretarsal strip
            # sloped into the groove and faced away from the light - one wide dark band 0.04-0.06 above the lash in the gray
            # render instead of a bright strip and the line at 0.08): a higher power keeps the strip on the lid and dives
            # only just below the crease (1.5 = as before)
            wl = (np.clip(above[lowr] / np.maximum(h[lowr], 1e-6), 0, 1) ** float(_get(p, "crease", "tuck_pow", default=1.5) or 1.5)) * fade[lowr]
            add(patch[lowr], -N[patch[lowr]] * (depth * ew * wl)[:, None] + e["u"][None] * (tuck_up * depth * ew * wl)[:, None])
            if fold == 0:
                upr = (h > 0.005) & (above > h) & (above < h + CREASE_BAND)          # blend back to the untouched skin above
                wu = np.cos(np.pi / 2 * np.clip((above[upr] - h[upr]) / CREASE_BAND, 0, 1)) * fade[upr]
                add(patch[upr], -N[patch[upr]] * (depth * ew * wu)[:, None] + e["u"][None] * (tuck_up * depth * ew * wu)[:, None])
            else:
                # 2026-10-21 (만두: the skin over the crease looked paper-thin, "folded like a sheet"): the fold is a ROLL with
                # thickness. From the groove bottom (crease row, pushed back by depth) the surface rises FORWARD over a short
                # run (ROLL_RISE x fold_width: the rounded underside, thickness = depth + fold), stays at +fold for the roll's
                # top, then fades up over fold_width. The underside hangs down (sag) over the groove, never past the crease
                # row (SAG_LIMIT). Replaces the old thin flap (rel^0.3 peak right above the groove) in tuck mode.
                over = (h > 0.005) & (above > h) & (above < h + fwv)
                s_ = np.clip((above[over] - h[over]) / np.maximum(fwv[over], 1e-6), 0, 1)
                rise = np.clip(s_ / ROLL_RISE, 0, 1); rise = rise * rise * (3 - 2 * rise)               # smoothstep underside
                top = np.where(s_ < ROLL_TOP, 1.0, np.cos(np.pi / 2 * np.clip((s_ - ROLL_TOP) / max(1 - ROLL_TOP, 1e-6), 0, 1)))
                wo = rise * top * fade[over]
                wb_ = (1 - rise) * fade[over]                      # the groove bottom continues under the roll, fading with the rise
                sagw = np.clip(1 - s_ / ROLL_RISE, 0, 1) * fade[over]
                sagd = np.minimum(sag * fold * sagw, SAG_LIMIT * (above[over] - h[over]))
                add(patch[over], N[patch[over]] * ((fold * wo - depth * wb_) * ew)[:, None] + e["u"][None] * ((tuck_up * depth * wb_ - sagd) * ew)[:, None])
        elif (hs > 0).any() and mode == "drape" and depth != 0:
            # 10/24 mode "drape" (만두: the double lid is the levator pulling the skin in so the 눈두덩이 skin folds over it;
            # EyeWiki / Lei & Tan 2023: on opening, the pretarsal skin moves WITH the tarsus as one flat unit back and up, the
            # crease line invaginates, the loose preseptal skin above does not follow and drapes down over it). The tuck mode
            # instead sloped the whole pretarsal strip into the groove (a shaded band below the line) and only bulged the skin
            # above (+0.03, no cover). Here, in the face frame (back = -forward axis, up = eye up):
            #   below the line - DRAPE_LO: untouched (the flat pretarsal unit, as fitted to the open-eye photos)
            #   lower pocket wall (line - DRAPE_LO .. line): back by depth, up by tuck_up x depth (smoothstep)
            #   above the line (0 .. fold_width): the pocket bottom continues under the lip and fades over the underside
            #   (ROLL_RISE), the lip comes forward by fold and the skin hangs DOWN by cover (largest at the lip, fading up),
            #   so it overhangs the pocket - the photo line = that lip (the cover hides the pocket mouth)
            h = h_of(u) * (u > u_lo) * (u < u_hi)
            cover = float(_get(p, "crease", "cover", default=0.03))
            if slide > 0:
                a2 = slide_above(above, h, slide); mvd = (a2 - above) * ew; sl_ = np.abs(mvd) > 1e-9
                Nn = self.N[patch]; tu_ = e["u"][None] - Nn * (Nn @ e["u"])[:, None]; tu_ /= np.linalg.norm(tu_, axis=1, keepdims=True) + 1e-12
                add(patch[sl_], tu_[sl_] * mvd[sl_, None]); above = a2
            fwd, upv = self.axes["fwd"], e["u"]; on = h > 0.005
            lw = on & (above > h - DRAPE_LO) & (above <= h) & (above > 0.008)
            w = np.clip((above[lw] - (h[lw] - DRAPE_LO)) / DRAPE_LO, 0, 1); w = w * w * (3 - 2 * w)
            add(patch[lw], (-fwd[None] * depth + upv[None] * (tuck_up * depth)) * (ew * w)[:, None])
            ov = on & (above > h) & (above < h + fw_)
            s_ = np.clip((above[ov] - h[ov]) / max(fw_, 1e-6), 0, 1)
            rise = np.clip(s_ / ROLL_RISE, 0, 1); rise = rise * rise * (3 - 2 * rise)
            top = np.where(s_ < ROLL_TOP, 1.0, np.cos(np.pi / 2 * np.clip((s_ - ROLL_TOP) / max(1 - ROLL_TOP, 1e-6), 0, 1)))
            back = (1 - rise) * depth; lip = rise * top * fold; hang = cover * (1 - s_) ** 2
            add(patch[ov], (fwd[None] * (lip - back)[:, None] + upv[None] * (tuck_up * back - hang)[:, None]) * ew)
        elif (hs > 0).any() and (depth != 0 or bulge != 0 or fold != 0):
            h = h_of(u) * (u > u_lo) * (u < u_hi)
            fade = fade_of(h)                                          # (before 10/23: (h / 0.06)^0.5, melting into the lash line)
            on = (h > 0.005) & (np.abs(above - h) <= CREASE_BAND)
            w = np.cos(np.pi / 2 * np.clip(np.abs(above[on] - h[on]) / CREASE_BAND, 0, 1)) * fade[on]
            add(patch[on], -N[patch[on]] * (depth * ew * w)[:, None])
            below = (h > 0.005) & (above > 0.01) & (above < h - CREASE_BAND)
            wb = np.sin(np.pi * np.clip(above[below] / np.maximum(h[below] - CREASE_BAND, 1e-6), 0, 1)) * fade[below]
            add(patch[below], N[patch[below]] * (bulge * ew * wb)[:, None])
            if fold != 0:   # folded skin above the groove: thickest just above it, fading up over fold_width; sags down over the groove
                over = (h > 0.005) & (above > h + 0.5 * CREASE_BAND) & (above < h + fw_)
                rel = np.clip((above[over] - h[over] - 0.5 * CREASE_BAND) / max(fw_ - 0.5 * CREASE_BAND, 1e-6), 0, 1)
                wo = (rel ** 0.3) * ((1 - rel) ** 1.2)
                if len(wo) and wo.max() > 0: wo = wo / wo.max() * fade[over]
                sagw = wo * np.clip(1 - rel / 0.5, 0, 1)                # only the lower part of the band drapes down
                sagd = np.minimum(sag * fold * sagw, SAG_LIMIT * (above[over] - h[over]))
                add(patch[over], N[patch[over]] * (fold * ew * wo)[:, None] - e["u"][None] * (ew * sagd)[:, None])
        N = self.N                                                     # (crease "push" forward applies to the crease only)
        # fullness: 3 height bands between the lash line and the brow lower edge, values interpolated by band centre
        f = np.asarray(_get(p, "fullness", default=[0, 0, 0]), float)
        if (f != 0).any():
            # S2.5 (2026-10-21): the bands cover the WHOLE upper-lid volume the oblique outline observes - laterally past the
            # outer corner (u < 0) and up to the brow bone ridge (rel ~ 1), tapered only at the lash and far outside;
            # before, the support stopped at u 0..1 / below the brow and never reached the outline vertices
            rel_all = above / np.maximum(brow_h, 1e-6)
            sel = (rel_all > 0.05) & (rel_all < 1.25) & (u > -0.45) & (u < 1.35)
            rel = rel_all[sel]; uu = u[sel]
            tl = np.clip((rel - 0.05) / 0.4, 0, 1); tl = tl * tl * (3 - 2 * tl)       # lash taper over 0.4 x lid height (a 0.1 x ew step over 0.04 inverted fine faces)
            taper = tl * np.clip((1.25 - rel) / 0.3, 0, 1) * np.clip(1 - np.maximum(np.maximum(-uu, uu - 1), 0) / 0.4, 0, 1)
            amp = np.interp(rel, [1 / 6, 0.5, 5 / 6], f) * taper
            add(patch[sel], N[patch[sel]] * (amp * ew)[:, None])
        # epicanthus: inner-corner skin toward the nose (- t), tilted edge, feathered over 0.2 x eye width
        cover, ang = float(_get(p, "epicanthus", "cover")), np.radians(float(_get(p, "epicanthus", "angle_deg")))
        if cover != 0:
            du = u - 1.0; sel = (du > -0.2) & (du < 0.15) & (np.abs(v) < 0.2)
            w = np.clip(1 - np.abs(du[sel] + 0.03) / 0.17, 0, 1) * np.clip(1 - np.abs(v[sel]) / 0.2, 0, 1)
            w = w * np.clip(e["ring_d"][patch[sel]] / 0.06, 0, 1)            # fades to 0 at the held eye-opening ring
            skew = 1 + np.tan(ang) * v[sel]
            add(patch[sel], (-e["t"] * cover * ew)[None] * (w * skew)[:, None])
        return T

    def crease_line(self, S, p, tol=0.012):
        """E2 evaluation (2026-10-20): skin vertex ids on the CORE of the crease groove of eye S for params p (within tol
        x eye width of the line v = lash + h(u), where h > 0.02), outer -> inner order. Empty when p makes no crease.
        parts_measure_v1 projects these into the photos and measures their distance to the photo crease curve."""
        e = self.eyes[S]; uv = e["uv"]; patch = np.where(e["patch"])[0]
        hs = np.asarray(_get(p, "crease", "heights", default=[0, 0, 0]), float)
        if not (hs > 0).any(): return np.zeros(0, np.int64)
        if _get(p, "crease", "mode", default="groove") == "lid":
            import lid_fold
            return lid_fold.line_vertices(self, S, p, tol)
        u, v = uv[patch, 0], uv[patch, 1]; above = v - e["lash_v"][patch]
        u_lo, u_hi = (0.03, 0.97) if len(hs) > 7 else (0.05, 0.95)
        nd2 = nodes_of(p.get("crease") or {})
        if len(nd2) and nd2[0] < 0 and (hs[np.asarray(nd2) < 0] > 0).any():          # 10/24 continuation past the outer corner
            u_lo = float(nd2[0]) - 1e-6; above = np.where(u < 0, v - (float(np.polyval(e["lash_pc"], 0.0)) + e["x_slope"] * u), above)
        h = np.interp(u, nd2, hs, left=hs[0], right=hs[-1]) * (u > u_lo) * (u < u_hi)
        sl = float(_get(p, "crease", "slide", default=0.0) or 0.0)
        if sl > 0: above = slide_above(above, h, sl)                        # where the slid vertices are (10/23 option)
        on = (h > 0.02) & (np.abs(above - h) <= tol)
        idx = patch[on]; return idx[np.argsort(u[on])]

    def displace(self, params, smooth_iters=0):
        """smooth_iters > 0 (2026-10-20, 만두: the crease line looked jagged): the displacement field is averaged over the
        skin-graph neighbours that many times inside the eye patch before the eyeball clamp (held vertices stay 0)"""
        from face_rig import _solve_constrained
        T = {}
        for S in ("L", "R"):
            for k, d in self._targets(S, params.get(S, {})).items(): T[k] = T.get(k, 0) + d
        # the lid edge / eye opening (ring) and the landmark vertices stay exactly where the fit put them
        ring = np.concatenate([e["ring"] for e in self.eyes.values()])
        for k in ring: T.pop(int(k), None)
        if not T: return np.zeros((self.n, 3))
        tgt = np.array(sorted(T)); held = np.unique(np.r_[self.held[~np.isin(self.held, tgt)], ring])
        lid_eyes = [S_ for S_ in ("L", "R") if _get(params.get(S_) or {}, "crease", "mode", default="groove") == "lid"
                    and (np.asarray(_get(params.get(S_) or {}, "crease", "heights", default=[0]), float) > 0).any()]
        if lid_eyes:                                          # the lining behind the lid is not part of a fold: held (an
            import lid_fold                                   # eye without a crease is left exactly as before)
            hid = lid_fold.hidden(self, lid_eyes); held = np.unique(np.r_[held, hid[~np.isin(hid, tgt)]])
        cidx = np.r_[tgt, held]; cval = np.r_[np.array([T[int(k)] for k in tgt]), np.zeros((len(held), 3))]
        active = np.zeros(self.n, bool)
        for e in self.eyes.values(): active |= e["patch"]
        D = _solve_constrained(self.Bi, active, cidx, cval)
        D[~active] = 0; D[~self.skin] = 0
        if smooth_iters > 0:
            if not hasattr(self, "_adj"):
                from scipy.sparse import coo_matrix, diags
                skinF = self.F[self.skin[self.F].all(1)]
                e_ = np.vstack([skinF[:, [0, 1]], skinF[:, [1, 2]], skinF[:, [2, 0]]])
                A = coo_matrix((np.ones(2 * len(e_)), (np.r_[e_[:, 0], e_[:, 1]], np.r_[e_[:, 1], e_[:, 0]])), shape=(self.n, self.n)).tocsr(); A.data[:] = 1.0
                self._adj = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
            keep = ~active | np.isin(np.arange(self.n), held)
            for _ in range(int(smooth_iters)):
                Ds = self._adj @ D; Ds[keep] = D[keep]; D = Ds
            D[~active] = 0; D[~self.skin] = 0
        cms = {((params.get(S_) or {}).get("crease") or {}).get("clamp") for S_ in ("R", "L")}
        if "radius" in cms: self.clamp_mode = "radius"                 # the old (buggy) rule, only when a parameter file asks for it
        elif "clearance" in cms: self.clamp_mode = "clearance"
        return self._clamp(D)

    def _clamp(self, D):
        """no skin vertex inside the eyeball: radial push back onto EYEBALL_CLEAR x radius (eye_fit's drape rule).
        10/24 (만두: a low crease still deep?): want = max(r0, clearance) kept every vertex at LEAST at its original distance
        from the ball centre, so any inward move was undone - chae01 / gyu01 A8 / drape: solved 0.04-0.05 deep, after this
        clamp median 0.002-0.02 while the skin was 0.09-0.12 x eye width outside the ball. Option clamp "clearance"
        (self.clamp_mode): a vertex may go in down to the clearance (min(r0, clearance) for one that was already closer)"""
        fw = self.axes["fwd"]
        for e in self.eyes.values():
            if e["ball_c"] is None: continue
            idx = np.where(e["patch"] & (np.linalg.norm(D, axis=1) > 0))[0]
            r0 = np.linalg.norm(self.V[idx] - e["ball_c"], axis=1)
            front = ((self.V[idx] - e["ball_c"]) @ fw) > 0
            keep = front & (r0 >= e["ball_r"] * (1 - 1e-9)); idx = idx[keep]; r0 = r0[keep]   # skin in FRONT, outside the ball
            P = self.V[idx] + D[idx]; dv = P - e["ball_c"]; r = np.linalg.norm(dv, axis=1)
            # DEFAULT since 2026-10-24 (만두: "버그 있던 거는 없애야지"): clearance; "radius" = the old rule (reproduction only)
            want = (np.minimum(r0, e["ball_r"] * EYEBALL_CLEAR) if getattr(self, "clamp_mode", "clearance") == "clearance"
                    else np.maximum(r0, e["ball_r"] * EYEBALL_CLEAR)); bad = r < want
            if bad.any():
                P[bad] = e["ball_c"] + dv[bad] / r[bad, None] * want[bad, None]
                D[idx[bad]] = P[bad] - self.V[idx[bad]]
        return D

    def apply(self, params):
        return self.V + self.displace(params)


def eye_view(basis, yaw_deg=0.0, pitch_deg=0.0):
    """render.render() view matrix (rows: screen right, screen up, toward camera) that looks at the FACE: the fitted mesh is
    in SfM world coordinates, so a world-axis view (yaw, pitch) showed the ears (만두 2026-10-20). yaw + = camera to the
    subject's left side, pitch - = camera below."""
    R_, U_, F_ = basis.axes["right"], basis.axes["up"], basis.axes["fwd"]
    y, p_ = np.radians(yaw_deg), np.radians(pitch_deg)
    cam = np.cos(y) * np.cos(p_) * F_ + np.sin(y) * np.cos(p_) * R_ + np.sin(p_) * U_      # toward camera
    cam /= np.linalg.norm(cam)
    right = np.cross(U_, cam); right /= np.linalg.norm(right); up = np.cross(cam, right)
    return np.vstack([right, up, cam])


# ---- checks ---------------------------------------------------------------------------------------------------------
def flipped_faces(V0, V1, F, min_area=0.05):
    """(flipped faces of normal size, flipped DEGENERATE faces): a fitted mesh carries near-zero-area slivers from the
    lid draping (eye_fit) that flip under any motion (chae01: areas 0.000-0.05 x median at 0.0007 x eye width), so
    they are counted apart - the basis is judged on faces with at least min_area x the median area"""
    n0 = np.cross(V0[F[:, 1]] - V0[F[:, 0]], V0[F[:, 2]] - V0[F[:, 0]]); n1 = np.cross(V1[F[:, 1]] - V1[F[:, 0]], V1[F[:, 2]] - V1[F[:, 0]])
    a0 = np.linalg.norm(n0, axis=1); flip = (n0 * n1).sum(1) < 0; big = a0 >= min_area * np.median(a0)
    return int((flip & big).sum()), int((flip & ~big).sum())


def params_from_parts_v1(parts, depth=0.010, bulge=0.003):
    """PREVIEW mapping of the E0 measurement to parameters (E2 replaces this with a fit): crease heights from the median
    curve (columns at u 0.1/0.2/0.38/0.57/0.77 -> 0.2/0.5/0.8), 0 where the column was not detected or the type is
    uncertain; fullness / epicanthus 0 (their targets need the E3/E4 fit)."""
    p = zero_params(); de = parts.get("double_eyelid", {})
    for S, key in (("R", "right"), ("L", "left")):
        e = de.get(key) or {}
        if e.get("type") not in ("outer", "inner_candidate"): continue
        us = e.get("column_u_outer_to_inner") or [0.1, 0.2, 0.38, 0.57, 0.77]; cur = e.get("curve_height_x_eye_width") or []
        pts = [(u, h) for u, h in zip(us, cur) if h is not None]
        if len(pts) < 2: continue
        uu, hh = zip(*pts)
        hs = [float(np.interp(x, uu, hh, left=hh[0], right=hh[-1])) if x <= max(uu) + 0.15 else 0.0 for x in CREASE_U]
        p[S]["crease"] = {"heights": [round(h, 3) for h in hs], "depth": depth, "bulge": bulge}
    return p


def inside_eyeball(basis, V1):
    """skin vertices in front of the eyeball centre that moved INTO the ball (were outside before)"""
    out = 0; fw = basis.axes["fwd"]
    for e in basis.eyes.values():
        if e["ball_c"] is None: continue
        idx = np.where(e["patch"])[0]; r0 = np.linalg.norm(basis.V[idx] - e["ball_c"], axis=1); r1 = np.linalg.norm(V1[idx] - e["ball_c"], axis=1)
        front = ((basis.V[idx] - e["ball_c"]) @ fw) > 0
        out += int((front & (r0 >= e["ball_r"]) & (r1 < e["ball_r"])).sum())
    return out


def test_params(scale=1.0):
    p = zero_params()
    for S in ("L", "R"):
        p[S]["crease"] = {"heights": [0.20 * scale, 0.17 * scale, 0.14 * scale], "depth": 0.010 * scale, "bulge": 0.004 * scale, "fold": 0.01 * scale}
        p[S]["fullness"] = [0.02 * scale, -0.015 * scale, 0.01 * scale]
        p[S]["epicanthus"] = {"cover": 0.03 * scale, "angle_deg": 20.0}
    return p


def selftest():
    import time
    from gnm_model import GNM, template_map
    t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz"))
    V = np.asarray(t["vertices"], np.float64); F = t["triangles"].astype(np.int64); mat = t["materials"]; comp = t["components"]
    lid = np.array(json.load(open(os.path.join(HERE, "..", "assets", "gnm_mp468.json")))["vertex"], np.int64)
    # symmetrize: the mean template is only nearly symmetric (max 0.09 x eye width) and the landmark ids were picked by
    # MediaPipe on a render (left / right ids differ), so the symmetry check needs a truly symmetric input
    G = GNM(); o2g = template_map()[0]; g2o = {int(g): i for i, g in enumerate(o2g)}
    mirror = np.array([g2o.get(int(G.mirror[g]), -1) for g in o2g]); ok = mirror >= 0
    Vm = V[mirror].copy(); Vm[:, 0] *= -1; V = np.where(ok[:, None], (V + Vm) / 2, V)
    # the landmark ids this basis uses are made exactly mirror-symmetric (known MediaPipe left/right pairs), and the
    # held set is the right-side landmark vertices plus their mirrors; production uses the fit's own 468 ids as they are
    pairs = {33: 263, 133: 362, 246: 466, 161: 388, 160: 387, 159: 386, 158: 385, 157: 384, 173: 398,
             7: 249, 163: 390, 144: 373, 145: 374, 153: 380, 154: 381, 155: 382, 46: 276, 53: 283, 52: 282, 65: 295, 55: 285}
    lid = lid.copy()
    for r_, l_ in pairs.items(): lid[l_] = mirror[lid[r_]]
    rep = {"template_vertices": int(len(V)), "landmarks_symmetrized": len(pairs)}
    t0 = time.time(); B = EyeBasis(V, F, mat, comp, lid); rep["build_sec"] = round(time.time() - t0, 2)
    right = lid[V[lid, 0] * np.sign(V[lid[33], 0]) > 0.02 * B.eyes["R"]["ew"]]
    B.held = np.unique(np.r_[right, mirror[right]])
    # 1. zero parameters -> zero displacement
    D0 = B.displace(zero_params()); rep["zero_max_disp"] = float(np.abs(D0).max())
    # 2. test parameters: no flipped faces, nothing inside the eyeballs, eye edge held, moved vertex count
    t0 = time.time(); D = B.displace(test_params()); rep["solve_sec"] = round(time.time() - t0, 2)
    V1 = V + D; ew = B.eyes["R"]["ew"]
    skinF = F[(mat[F] == 0).all(1)]
    rep["flipped_faces"], rep["flipped_degenerate_faces"] = flipped_faces(V, V1, skinF); rep["inside_eyeball"] = inside_eyeball(B, V1)
    ring = np.concatenate([e["ring"] for e in B.eyes.values()]); rep["lid_edge_max_disp_x_ew"] = float(np.abs(D[ring]).max() / ew)
    rep["moved_vertices"] = int((np.linalg.norm(D, axis=1) > 1e-4 * ew).sum()); rep["max_disp_x_ew"] = round(float(np.linalg.norm(D, axis=1).max() / ew), 4)
    rep["eyeball_moved"] = float(np.abs(D[np.isin(comp, [1, 2])]).max())
    # 3. symmetric input -> symmetric output (mirror through the GNM mirror indices)
    Dm = D[mirror[ok]].copy(); Dm[:, 0] *= -1                    # the template's x axis is the mirror axis
    sym_err = np.linalg.norm(D[ok] - Dm, axis=1)
    rep["mirror_mapped_pct"] = round(100 * ok.mean(), 1); rep["symmetry_err_max_x_ew"] = round(float(sym_err.max() / ew), 4)
    rep["symmetry_err_median_x_ew"] = round(float(np.median(sym_err[np.linalg.norm(D[ok], axis=1) > 1e-6]) / ew), 5) if (np.linalg.norm(D[ok], axis=1) > 1e-6).any() else 0.0
    # 4. linearity in one parameter (depth doubled -> groove doubled at the band)
    p1 = zero_params(); p1["R"]["crease"] = {"heights": [0.2, 0.17, 0.14], "depth": 0.01, "bulge": 0.0}
    p2 = json.loads(json.dumps(p1)); p2["R"]["crease"]["depth"] = 0.02
    d1, d2 = B.displace(p1), B.displace(p2); m = np.linalg.norm(d1, axis=1) > 1e-6
    rep["depth_linearity_ratio"] = round(float(np.median(np.linalg.norm(d2[m], axis=1) / np.linalg.norm(d1[m], axis=1))), 3)
    rep["pass"] = bool(rep["zero_max_disp"] == 0 and rep["flipped_faces"] == 0 and rep["inside_eyeball"] == 0 and rep["eyeball_moved"] == 0
                       and rep["lid_edge_max_disp_x_ew"] < 1e-9 and rep["symmetry_err_max_x_ew"] < 0.002 and abs(rep["depth_linearity_ratio"] - 2) < 0.01)
    print(json.dumps(rep, indent=1)); return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true"); ap.add_argument("--apply", help="work/<id>: apply --params to the chosen fit")
    ap.add_argument("--params", help="json {L:{...},R:{...}} (default: test_params)"); ap.add_argument("--out", help="output ply (never the fit itself)")
    ap.add_argument("--render", help="optional gray render png of before / after (front + 35 deg)")
    ap.add_argument("--from-parts", action="store_true", help="PREVIEW: crease heights from model/parts_v1.json (E2 will fit them properly)")
    a = ap.parse_args()
    if a.selftest:
        rep = selftest(); sys.exit(0 if rep["pass"] else 1)
    if a.apply:
        import meshio
        M = os.path.join(a.apply, "model"); ch = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")).get("chosen", "gnm")
        fit = meshio.read_any(os.path.join(M, f"fit_{ch}.ply")); V = np.asarray(fit["vertices"], np.float64); F = np.asarray(fit["faces"], np.int64)
        t = np.load(os.path.join(HERE, "..", "assets", "gnm-template-v2.npz")); mat = t["materials"]; comp = t["components"]
        lid = np.array(json.load(open(os.path.join(M, f"fit_{ch}.fit.json")))["landmark_vertex_ids"])
        if a.params: p = json.load(open(a.params, encoding="utf-8"))
        elif a.from_parts: p = params_from_parts_v1(json.load(open(os.path.join(M, "parts_v1.json"), encoding="utf-8")))
        else: p = test_params()
        B = EyeBasis(V, F, mat, comp, lid); D = B.displace(p); V1 = V + D; ew = B.eyes["R"]["ew"]
        out = a.out or os.path.join(M, "eye_parts_test.ply")
        if os.path.abspath(out) == os.path.abspath(os.path.join(M, f"fit_{ch}.ply")): raise SystemExit("refusing to overwrite the fit")
        meshio.write_ply(out, V1, F, fit.get("colors"))
        skinF = F[(mat[F] == 0).all(1)]
        rep = {"out": out, "moved_vertices": int((np.linalg.norm(D, axis=1) > 1e-4 * ew).sum()), "max_disp_x_ew": round(float(np.linalg.norm(D, axis=1).max() / ew), 4),
               "inside_eyeball": inside_eyeball(B, V1), "eye_width_model": round(ew, 4), "params": p}
        rep["flipped_faces"], rep["flipped_degenerate_faces"] = flipped_faces(V, V1, skinF)
        if a.render:
            from render import render, save_png, contact_sheet
            imgs = []
            for Vx in (V, V1):
                c = B.eyes["R"]["a"] * 0.5 + B.eyes["L"]["a"] * 0.5
                for view in ((0, 0), (35, 0)):
                    imgs.append(render(Vx[:, :], skinF, view=eye_view(B, *view), size=420, center=c, extent=1.6 * B.eyes["R"]["ew"]))
            save_png(a.render, contact_sheet(imgs, ["before 0", "before 35", "after 0", "after 35"], cols=2)); rep["render"] = a.render
        print(json.dumps(rep))


if __name__ == "__main__":
    main()
