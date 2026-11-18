"""W7-eye E2~E4 (2026-10-20): fit the RESTORATION eye parameters of pipeline/eye_parts.py to the E0 measurements and write
the candidate `gnme` = base fit (gnm) + eye displacement. OPTION ONLY: scan_to_model.py --eye-parts; no default changes.

targets (tools/parts_measure_v1.measure on the BASE mesh, photo-side values are mesh independent), per eye, all x eye width:
  E2 crease   photo crease curve (median height per upper-lid column, 5 columns outer -> inner)  ->  crease heights at
              u = 0.2 / 0.5 / 0.8 by linear least squares on the interpolation (a column with no detection: target 0 for
              the columns nasal of the last detected one when the type is 속쌍꺼풀 후보 = the fold tapers into the lash
              line; not constrained otherwise). Type "uncertain" -> all 0 (GNM mean lid, 만두 decision pending).
              The photo height is measured from MediaPipe's upper-lid point; the model's lid vertices sit eyelid_offset
              (x eye width, x column taper) above it, so that offset is subtracted first (height above the MODEL lash).
              depth / bulge are NOT fitted: the photos give the line, not the groove's width / depth (that needs the
              dark-band profile of E2's shading, W5) -> global constants DEPTH / BULGE (E1' preview values; recorded).
  E3 fullness side-profile signed distance per 5 height bins (% IOD, + model outside = fuller), relative to the forehead
              band of the same frames (brow-bone reference: a shift common to lid and forehead is a pose / outline
              offset, not lid volume) -> fullness[3] (bands 1/6, 1/2, 5/6 of lash -> brow) by least squares on the
              band interpolation x sin taper. Needed displacement = -d / 100 x IOD / eye width. Only when that side has
              >= 3 frames AND the frames agree in sign (|signed median| >= 0.5 x |abs median|); clamped to +-FULL_MAX.
              FITTED AND RECORDED ONLY unless --fullness: the brow / orbital silhouette did not move with the lid skin in
              the first runs (see --fullness help), so the measurement cannot yet confirm the displacement.
  E4 epicanthus  caruncle fold overhang past the inner corner (x eye width, >= 0) -> cover; covering-edge slope du/dv over
              the 5 rows -> angle_deg (+ = the edge runs down and out). Only when >= 5 frames and at most half of them
              "weak signal" (3 Mbps videos: woo / zu). The model has no caruncle patch (W8), so cover is the only knob.
outputs  model/fit_gnme.ply (+ .fit.json = base fit json + eye_parts summary), model/eye_parts.json (measurement file,
         targets, parameters, confidence, residuals, checks, crease-line vertex ids for the E2 evaluation, timings),
         model/eye_parts_measure_<base>.json (the E0 measurement of the base mesh)
checks   zero displacement outside the eye patch, lid edge / landmarks held, eyeball untouched, no vertex inside the
         eyeball, flipped faces (normal size), crease index (tools/qa_check.crease: FACE regions as qa uses, and FACE +
         orbital regions) of base and gnme against gnmb -> whether the intended crease is counted as a wrinkle.
usage: python pipeline/eye_parts_fit.py --work work/<id> [--base gnm] [--out gnme] [--sparse <model>]
"""
import argparse, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
RENDER_WORKERS = min(8, os.cpu_count() or 1)   # per-frame renders of the fit loop (results read back in frame order)
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(ROOT, "tools"))
from eye_parts import EyeBasis, CREASE_U, crease_nodes, nodes_of, zero_params, flipped_faces, inside_eyeball

# global constants (x eye width), NOT per person. Rationale in QA-CRITERIA.md (W7-눈 E2~E4):
DEPTH, BULGE = 0.010, 0.003      # groove depth / pretarsal push: E1' preview values; the photos do not measure them yet
FULL_MAX = 0.05                  # |fullness| cap: the basis is for small corrections, the side profile is noisy (E0: ~3 % IOD between captures)
FULL_MIN_FRAMES, FULL_SIGN_AGREE = 3, 0.5
EPI_MIN_FRAMES, EPI_WEAK_MAX = 5, 0.5
BIN_REL = np.array([0.1, 0.3, 0.5, 0.7, 0.9])        # centres of the 5 side-profile height bins (0 lash .. 1 brow)
BAND_REL = np.array([1 / 6, 0.5, 5 / 6])            # fullness band nodes (eye_parts._targets)
NAME = {"R": "right", "L": "left"}


def interp_matrix(x, nodes):
    """rows: linear-interpolation weights of x on the nodes (np.interp with edge clamping, as eye_parts uses)"""
    A = np.zeros((len(x), len(nodes)))
    for j in range(len(nodes)):
        e = np.zeros(len(nodes)); e[j] = 1; A[:, j] = np.interp(x, nodes, e, left=e[0], right=e[-1])
    return A


LID_TAPER = [0.9, 1.0, 1.0, 1.0, 0.9]
WEAK_TAPER_MAX = 0.35                       # --weak-taper: longest end fade of a weak fold (u)
SHADE_LO, SHADE_HI = 0.20, 0.40            # --depth-from-shade: photo crease darkness at which the fold strength is 0 / full (10/24)
DARK_WIN = (0.04, 0.06)                     # --loop-ref dark: search below / above the photo crease (x eye width)
GROOVE_K, GROOVE_NEAR, GROOVE_TREND = 4.0, 0.06, 0.10   # --loop-ref groove: depth-buffer scale (px per photo px), search / trend half-widths x eye width
LOOP_STEP, LOOP_FLOOR = 0.02, 0.3          # --loop-bands: max node change per pass / lowest share of the photo-fitted height (10/23)      # eyelid_offset.py taper over the 5 inner upper-lid columns (7 points: 0.6 .. 0.6)


TAPER7 = [0.6, 0.9, 1.0, 1.0, 1.0, 0.9, 0.6]        # eyelid_offset.py taper over the 7 upper-lid points


def model_lid_targets(fdet, S, V, lid, poses, proj, n_cols):
    """10/23 --lash-ref model: per column, median over the frontal frames of (photo crease v - projected MODEL upper-lid v)
    in the photo's eye frame (x eye width) = the crease height above the model's own lid line that puts the crease at the
    photo position, whatever the error of the model's lid shape (chae01 inner half -0.05..-0.07). None where < 3 frames."""
    from parts_measure_v1 import eye_frame, to_eye, lid_line, EYE as PM_EYE
    up = PM_EYE[S]["up"]; ring = [PM_EYE[S]["c"][0]] + up + [PM_EYE[S]["c"][1]]; per = [[] for _ in range(n_cols)]
    for n, fd in fdet.items():
        e = fd.get(S)
        if not e or e.get("pose", "frontal") != "frontal" or n not in poses or len(e["crease_heights"]) != n_cols: continue
        Lp = np.zeros((468, 2)); Lp[e["lid_ids"]] = np.array(e["lid_px"]); fr = eye_frame(Lp, S)
        if fr is None: continue
        pl = lid_line(Lp, S, fr); op = np.arange(len(pl))                  # same base line as the measurement (10/23 fix)
        ml = to_eye(proj(V, poses[n]["R"], poses[n]["t"])[lid[ring]], fr); om = np.argsort(ml[:, 0])
        for k, (u, h) in enumerate(zip(e["column_u"], e["crease_heights"])):
            if h is None: continue
            per[k].append(float(np.interp(u, pl[op, 0], pl[op, 1]) + h - np.interp(u, ml[om, 0], ml[om, 1])))
    return [float(np.median(v)) if len(v) >= 3 else None for v in per]


DIRECT_RAMP, DIRECT_MED, DIRECT_AVG = 0.06, 5, 5     # --crease-curve direct: 0-ramp beyond the line ends (x eye width), smoothing windows


def drop_outlier_frames(fdet, tol=0.05):
    """10/24 (만두: gyu01 frame 00656 - the photo crease was traced on the 눈두덩이 boundary 0.38-0.43 above the lash, the
    consensus is 0.08-0.12): per eye, a frame whose median height offset from the per-column consensus (median over frames)
    exceeds tol (= parts_measure_v1 CR_FRAME_OUTLIER, the rule the summary already used) is left out of the closed loop.
    -> (filtered frame_detail, {eye: [dropped frame names]})"""
    out = {n: dict(e) for n, e in fdet.items()}; dropped = {}
    for S in ("R", "L"):
        rows = {n: e[S] for n, e in fdet.items() if S in e}
        if len(rows) < 5: continue
        us = {round(u, 3) for r in rows.values() for u in r["column_u"]}; cols = sorted(us)
        A = np.array([[np.nan] * len(cols) for _ in rows]); idx = {u: i for i, u in enumerate(cols)}
        for k, r in enumerate(rows.values()):
            for u, h in zip(r["column_u"], r["crease_heights"]):
                if h is not None: A[k, idx[round(u, 3)]] = h
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning); med = np.nanmedian(A, 0); dev = np.nanmedian(A - med, 1)
        bad = [n for n, d in zip(rows, dev) if np.isfinite(d) and abs(d) > tol]
        for n in bad: out[n].pop(S, None)
        if bad: dropped[S] = bad
    return {n: e for n, e in out.items() if e}, dropped


def direct_curve(us, tu, th, ramp_inner=None):
    """10/23 --crease-curve direct (만두: the yellow line itself into the model): heights at the measured columns = the
    column targets (gaps inside the detected stretch interpolated), median + moving-average smoothed, ramped to 0 within
    DIRECT_RAMP beyond where the line starts / ends (an inline fold hidden in the lash line, the start of an in-out fold)"""
    us = np.asarray(us, float); tu = np.asarray(tu, float); th = np.asarray(th, float)
    det = th > 0
    if det.sum() < 3: return [0.0] * len(us)
    u0, u1 = tu[det].min(), tu[det].max()
    h = np.interp(us, tu[det], th[det])
    from scipy.ndimage import median_filter, uniform_filter1d
    inside = (us >= u0) & (us <= u1)
    hi = h[inside]
    if len(hi) >= DIRECT_MED: hi = uniform_filter1d(median_filter(hi, size=DIRECT_MED, mode="nearest"), size=DIRECT_AVG, mode="nearest")
    h[inside] = hi
    lo_v, hi_v = hi[0], hi[-1]
    h = np.where(us < u0, lo_v * np.clip(1 - (u0 - us) / DIRECT_RAMP, 0, 1), h)
    if ramp_inner and ramp_inner > DIRECT_RAMP:
        # 10/24 option (만두, chae01 A10: the line rose abruptly at the inner end - 0.06-0.07 to 0 within 0.04-0.06 u): beyond
        # the line's inner end the height eases to 0 over ramp_inner (smoothstep), as an inline fold slides under the skin
        w_ = np.clip(1 - (us - u1) / ramp_inner, 0, 1); h = np.where(us > u1, hi_v * w_ * w_ * (3 - 2 * w_), h)
    else:
        h = np.where(us > u1, hi_v * np.clip(1 - (us - u1) / DIRECT_RAMP, 0, 1), h)
    return [round(float(x), 4) for x in h]


def fit_crease(de, lash_off=0.0, lash_ref="offset", lash_cols=None, n_nodes=3, model_tgt=None, direct=False, end_cut=False, ramp_inner=None):
    """de: parts_v1 double_eyelid[<side>], lash_off: eyelid_offset of this eye (x eye width; the model's lid vertices
    were fitted that far ABOVE MediaPipe's upper-lid points, where the photo crease height was measured from)
    -> (heights[3] above the MODEL lash line, info)"""
    info = {"type": de.get("type"), "frames": de.get("frames"), "frame_detected_pct": de.get("frame_detected_pct"), "lash_offset_x_ew": lash_off, "lash_ref": lash_ref,
            "lash_cols": lash_cols}
    edge = de.get("lid_edge_offset_x_eye_width") or [None] * 7
    if de.get("type") not in ("outer", "inner_candidate"):
        info["decision"] = "uncertain -> 0 (GNM mean lid)"; return [0.0] * n_nodes, info
    us = de.get("column_u_outer_to_inner") or [0.1, 0.2, 0.38, 0.57, 0.77]; cur = de.get("curve_height_x_eye_width") or []
    tu, th, tw = [], [], []
    last = max([k for k, h in enumerate(cur) if h is not None], default=-1)
    nc = len(cur)
    if nc not in (0, 5):   # 10/23 dense columns (parts_measure_v1 --crease-columns N, --crease-trace): N columns between points 1..5
        lu = de.get("lid_point_u")                                          # u of the 7 lid points (10/23): map columns by u
        if lu and len(lu) == 7:
            pts7 = lambda arr, k: (lambda ok: float(np.interp(us[k], [lu[i] for i in ok], [arr[i] for i in ok])) if len(ok) >= 2 else None)([i for i in range(7) if arr[i] is not None])
            taper = lambda k: float(np.interp(us[k], lu, TAPER7))
        else:                                                               # older measurement: columns between points 2..6 by position
            pos = lambda k: 4.0 * k / (nc - 1)
            pts7 = lambda arr, k: (lambda ok: float(np.interp(1 + pos(k), ok, [arr[i] for i in ok])) if len(ok) >= 2 else None)([i for i in range(1, 6) if arr[i] is not None])
            taper = lambda k: float(np.interp(pos(k), range(5), LID_TAPER))
        rate = de.get("column_rate_outer_to_inner") or [None] * nc
        n_model = 0
        for k, (u, h) in enumerate(zip(us, cur)):
            if h is not None:
                if lash_ref == "model" and model_tgt is not None and k < len(model_tgt) and model_tgt[k] is not None:
                    tu.append(u); th.append(max(model_tgt[k], 0.0)); tw.append(1.0); n_model += 1; continue
                off = lash_off * taper(k)
                if lash_cols is not None and pts7(lash_cols, k) is not None: off = pts7(lash_cols, k)
                if lash_ref == "edge" and pts7(edge, k) is not None: off = pts7(edge, k)
                tu.append(u); th.append(max(h - off, 0.0)); tw.append(1.0)
            elif k > last and last >= 0 and rate[k] is not None and rate[k] < 0.25:
                # nasal of the last detection and (almost) never seen there: the fold meets the lash line (inline / tapered),
                # decided per column from the photos instead of the type name (만두 10/23: types are coarse, lines vary)
                tu.append(u); th.append(0.0); tw.append(0.5)
        info["model_ref_columns"] = n_model
        if direct:                                                          # the measured curve itself (10/23)
            det_t = [(u_, h_) for u_, h_, w_ in zip(tu, th, tw) if w_ >= 1.0]
            # 10/23 --crease-end frames (G1, 만두: chae01 A8 line still ended high): a column enters the curve when >= 25 % of
            # the frames saw the line there, so the few frames whose trace ran on (chae01 R 6 / L 14 of 37-40 frames, to
            # u 0.84-0.88) set the end at their flat height (0.10) while the frames END at a median u 0.69 / 0.72 - at that
            # same height, the trace stops where the fold goes under the lid (it never comes down to the lash). The curve is
            # cut at the frames' median start / end (line_start_u / line_end_u) and ramps to 0 beyond them as before
            if end_cut and de.get("line_end_u") is not None and de.get("line_start_u") is not None:
                c0_, c1_ = float(de["line_start_u"]), float(de["line_end_u"]); n0_ = len(det_t)
                det_t = [(u_, h_) for u_, h_ in det_t if c0_ - 1e-6 <= u_ <= c1_ + 1e-6]
                info["end_cut"] = {"start_u": round(c0_, 3), "end_u": round(c1_, 3), "columns_cut": n0_ - len(det_t)}
            if len(det_t) < 3:
                info["decision"] = "direct: fewer than 3 detected columns -> 0"; return [0.0] * nc, info
            hs = direct_curve(us, *zip(*det_t), ramp_inner=ramp_inner); info.update(decision=f"direct: measured curve on {nc} columns", nodes_u=[round(float(x), 4) for x in us],
                                                           line_start_u=round(min(u_ for u_, _ in det_t), 3), line_end_u=round(max(u_ for u_, _ in det_t), 3))
            return hs, info
        us = []; cur = []                                                   # handled above
    for k, (u, h) in enumerate(zip(us, cur)):
        if h is not None:
            # photo height (from the MediaPipe point) -> height above the MODEL lash line: the model lid vertices sit
            # eyelid_offset x taper above the point ("offset"), or, with --lash-ref edge, the per-column image edge offset
            # measured in this capture (where the lid edge really is; equals the model lash only if the lid was fitted to it)
            off = lash_off * LID_TAPER[min(k, 4)]
            # the base fit placed the lid vertices at per-column lash edges (template_fit --eyelid-cols): the crease height
            # must be measured from the same per-column reference (2026-10-21: one offset per eye left chae01 R 0.09 too high)
            if lash_cols is not None and lash_cols[min(k + 1, 6)] is not None: off = float(lash_cols[min(k + 1, 6)])
            if lash_ref == "edge" and edge[min(k + 1, 6)] is not None: off = float(edge[min(k + 1, 6)])
            tu.append(u); th.append(max(h - off, 0.0)); tw.append(1.0)
        elif de["type"] == "inner_candidate" and k > last: tu.append(u); th.append(0.0); tw.append(0.5)   # tapered fold: 0 nasal of the last detection
        elif de["type"] == "outer" and k > last and last >= 0:                                           # outer fold: continue the last detected height
            tu.append(u); th.append(max(float(cur[last]) - lash_off * LID_TAPER[min(last, 4)], 0.0)); tw.append(0.3)   # (weak; a free node drifted to 0.12 on stacked input, 10/21)
    if len(tu) < 2:
        info["decision"] = "fewer than 2 target columns -> 0"; return [0.0] * n_nodes, info
    nodes = crease_nodes(n_nodes); nn = len(nodes)
    A = interp_matrix(np.array(tu), nodes) * np.sqrt(np.array(tw))[:, None]; b = np.array(th) * np.sqrt(np.array(tw))
    # ridge so an unconstrained node follows its neighbours instead of going free
    lam = 1e-3; A2 = np.vstack([A, lam * (np.eye(nn) - np.roll(np.eye(nn), 1, 0))[:nn - 1]]); b2 = np.r_[b, np.zeros(nn - 1)]
    from scipy.optimize import nnls
    hs = nnls(A2, b2)[0]                                               # heights are non-negative (0 = no crease there)
    fitted = interp_matrix(np.array(tu), nodes) @ hs
    info.update(decision=f"{de['type']}: least squares on {len(tu)} column targets", target_u=[round(x, 3) for x in tu], target_h=[round(x, 3) for x in th],
                fitted_h=[round(float(x), 3) for x in fitted], residual_abs_median=round(float(np.median(np.abs(fitted - th))), 4),
                residual_abs_max=round(float(np.abs(fitted - th).max()), 4))
    return [round(float(h), 4) for h in hs], info


def fit_fullness(up_side, iod_over_ew):
    """up_side: parts_v1 upper_lid_profile[<camera side>] whose near_eye is this eye -> (fullness[3], info)"""
    info = {"frames": (up_side or {}).get("frames", 0)}
    if not up_side or (up_side.get("frames") or 0) < FULL_MIN_FRAMES or not up_side.get("profile_bins_pct_iod"):
        info["decision"] = f"fewer than {FULL_MIN_FRAMES} side frames -> 0"; return [0.0, 0.0, 0.0], info
    sm, am = up_side.get("signed_median_pct_iod"), up_side.get("abs_median_pct_iod")
    if sm is None or am is None or am < 1e-6 or abs(sm) < FULL_SIGN_AGREE * am:
        info.update(decision="frames disagree in sign -> 0 (uncertain)", signed_median=sm, abs_median=am); return [0.0, 0.0, 0.0], info
    bins = np.array([np.nan if b is None else b for b in up_side["profile_bins_pct_iod"]], float)
    ref = up_side.get("forehead_band_pct_iod"); ref = 0.0 if ref is None else float(ref)
    ok = np.isfinite(bins)
    if ok.sum() < 2:
        info["decision"] = "fewer than 2 height bins -> 0"; return [0.0, 0.0, 0.0], info
    d = -(bins[ok] - ref) / 100.0 * iod_over_ew                        # needed normal displacement, x eye width
    A = interp_matrix(BIN_REL[ok], BAND_REL) * np.sqrt(np.sin(np.pi * BIN_REL[ok]))[:, None]
    f = np.linalg.lstsq(A, d, rcond=None)[0]; capped = bool((np.abs(f) > FULL_MAX).any()); f = np.clip(f, -FULL_MAX, FULL_MAX)
    fitted = A @ f
    info.update(decision="least squares on the side-profile bins relative to the forehead band", signed_median=sm, abs_median=am, forehead_ref_pct_iod=ref,
                target_disp_x_ew=[round(float(x), 4) for x in d], fitted_disp_x_ew=[round(float(x), 4) for x in fitted],
                residual_abs_median=round(float(np.median(np.abs(fitted - d))), 4), capped=capped)
    return [round(float(x), 4) for x in f], info


def fullness_from_gnmb(B, V, Vb, S):
    """E3 alternative (2026-10-20, 만두: the lid looks sunken): fullness[3] that puts the upper-lid skin bands back at the
    forward position of the STATISTICAL fit gnmb. The landmark residual (gnm) pulls the 32 lid landmarks onto the
    triangulated eye-opening edge = the eyeball surface (chae01 R: the 0.08-0.16 band 0.647 -> 0.553 x eye width in front
    of the ball centre), so the lid skin ends up hugging the ball; this keeps gnmb's lid thickness instead. A rule, not a
    per-person number: target per vertex = (gnmb - gnm) . fwd, least squares on the band interpolation."""
    e = B.eyes[S]; uv = e["uv"]; above = uv[:, 1] - e["lash_v"]; brow_h = e["brow_v"] - e["lash_v"]; ew = e["ew"]
    rel = above / np.maximum(brow_h, 1e-6)
    sel = B.skin & e["patch"] & (uv[:, 0] > 0.15) & (uv[:, 0] < 0.85) & (above > 0.04) & (above < brow_h - 0.04)
    if sel.sum() < 10: return [0.0, 0.0, 0.0], {"decision": "too few band vertices -> 0"}
    d = ((Vb - V) @ B.axes["fwd"])[sel] / ew
    A = interp_matrix(rel[sel], BAND_REL) * np.sqrt(np.sin(np.pi * np.clip(rel[sel], 0, 1)))[:, None]
    f = np.clip(np.linalg.lstsq(A, d, rcond=None)[0], -FULL_MAX * 2, FULL_MAX * 2)
    return [round(float(x), 4) for x in f], {"decision": "lid thickness of the statistical fit (gnmb) restored", "gnmb_minus_gnm_median_x_ew": round(float(np.median(d)), 4),
                                               "band_vertices": int(sel.sum()), "applied": True}


def fit_epicanthus(ca):
    """ca: parts_v1 caruncle[<side>] -> (cover, angle_deg, info)"""
    info = {"frames": (ca or {}).get("frames", 0), "weak_signal_frames": (ca or {}).get("weak_signal_frames")}
    n = (ca or {}).get("frames") or 0
    if n < EPI_MIN_FRAMES or (ca.get("weak_signal_frames") or 0) > EPI_WEAK_MAX * n:
        info["decision"] = "too few frames or mostly weak signal -> 0 (uncertain)"; return 0.0, 0.0, info
    over = ca.get("fold_overhang_x_eye_width")
    cover = max(float(over), 0.0) if over is not None else 0.0
    ang = 0.0
    edge, vs = ca.get("covering_edge_u_at_v") or [], ca.get("edge_v") or []
    pts = [(v, u) for v, u in zip(vs, edge) if u is not None]
    if cover > 0 and len(pts) >= 3:
        v, u = np.array(pts).T; s = np.polyfit(v, u, 1)[0]; ang = float(np.clip(np.degrees(np.arctan(s)), -45, 45))
    info.update(decision="cover = fold overhang past the inner corner (>= 0), angle = covering-edge slope" if cover > 0 else "no overhang -> cover 0",
                overhang=over, slope_points=len(pts))
    return round(cover, 4), round(ang, 1), info


def crease_index(g, Vs, Vref, iod, regions):
    """tools/qa_check.crease (same formula: extra umbrella-Laplacian curvature along the normal vs the smooth gnmb fit,
    p95 / p99 in % IOD) for several meshes and a region list with ONE GNM instance (qa_check reloads it per call)"""
    from scipy.sparse import coo_matrix, diags
    F = g.tri; n = g.V
    ii = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]]); jj = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    A = coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(n, n)).tocsr(); A.data[:] = 1.0
    M = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
    face = np.zeros(n, bool)
    for r in regions: face |= g.group(r)

    def lapn(X):
        fn = np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]]); vn = np.zeros_like(X)
        for k in range(3): np.add.at(vn, F[:, k], fn)
        vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
        return ((M @ X - X) * vn).sum(1)
    ref = lapn(Vref); out = {}
    for k, X in Vs.items():
        d = np.abs(lapn(X) - ref)[face] / iod * 100
        out[k] = {"p95": round(float(np.percentile(d, 95)), 3), "p99": round(float(np.percentile(d, 99)), 3)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True); ap.add_argument("--base", default="gnm"); ap.add_argument("--out", default="gnme")
    ap.add_argument("--sparse", help="COLMAP sparse model for the measurement (default work/<id>/colmap/sparse_lens_anchored)")
    ap.add_argument("--measure", help="use this parts_v1-style measurement json instead of measuring the base mesh")
    ap.add_argument("--stack", type=int, default=0, help="W14 P0: measure with N-frame stacks too (parts_measure_v1 --stack N)")
    ap.add_argument("--crease-method", default="profile", choices=["profile", "ridge"], help="W14 P1': photo crease detector for the measurement (parts_measure_v1 --crease-method)")
    ap.add_argument("--crease-trace", action="store_true", help="10/23 option: measure the crease as one traced curve on the 2-D ridge response (parts_measure_v1 --crease-trace)")
    ap.add_argument("--crease-columns", type=int, default=5, help="10/23 option: crease columns per eye in the measurement (parts_measure_v1 --crease-columns, default 5)")
    ap.add_argument("--crease-shadow-rule", default="on", choices=["on", "off"], help="10/23 option: the 10/21 shadow rule in the measurement (default on)")
    ap.add_argument("--crease-span", default="mp", choices=["mp", "ends", "corners", "inner-ext", "outer-ext"], help="10/23 option: measurement columns between lid points 2..6 (mp), 1..7 (ends), corner to corner (corners) or past the inner corner (inner-ext)")
    ap.add_argument("--crease-ridge-angle", type=float, default=35.0, help="10/23 option: allowed tilt of the ridge line in the measurement (deg)")
    ap.add_argument("--line-at", default="groove", choices=["groove", "edge"], help="10/23 option (묶음 B): the photo line height is the "
                    "groove row (groove, as before) or where the fold EDGE shows (edge: groove row lowered by half the roll's underside rise)")
    ap.add_argument("--fade-min", type=float, default=0.0, help="crease height (x eye width) below which groove / fold fade out. DEFAULT 0 = "
                    "no fade since 2026-10-23 (만두: remove the rule - a fold 0.02-0.06 above the lash lost up to half its depth all along); "
                    "0.06 = the 10/20 behaviour")
    ap.add_argument("--crease-above-lash", type=float, default=0.03, help="10/23 option: lower end of the crease search above the lash edge (measurement)")
    ap.add_argument("--crease-lo-floor", default="always", choices=["always", "no-edge"], help="10/23 option: 0.06 floor always or only without a lash edge (measurement)")
    ap.add_argument("--crease-open-tol", type=float, default=0.0, help="10/23 option: frontal frames with alike eye opening only (share of the median, 0 = off)")
    ap.add_argument("--crease-trim-lash", action="store_true", help="10/23 option: traced line ends where it meets the lash line (measurement)")
    ap.add_argument("--crease-curve", default="nodes", choices=["nodes", "direct"], help="10/23 option: crease heights from N nodes "
                    "(least squares, --crease-nodes) or the measured curve itself on the measurement columns (direct, smoothed, 0-ramp beyond the line ends)")
    ap.add_argument("--crease-slide", type=float, default=0.0, help="10/23 option (G6): lid vertices near the crease line slide along "
                    "the surface toward it by this share (0 = off, < 1; eye_parts.slide_above) so a vertex row lies on the line - on the "
                    "base mesh gyu01's seen groove stayed on one row 0.04-0.056 above the lash for any crease height")
    ap.add_argument("--crease-push", default="normal", choices=["normal", "forward"], help="10/23 option (G6): tuck / roll direction - "
                    "the vertex normal (as before) or the face's forward axis (no lift of the crease row in the photos: the loop no "
                    "longer squeezes the pretarsal band; gyu01 0.08 -> 0.02-0.04 with the normal)")
    ap.add_argument("--eyeball-clamp", default="clearance", choices=["radius", "clearance"], help="eyeball clamp of the displacement - "
                    "clearance (DEFAULT since 2026-10-24, 만두 확인: skin may go in down to 1.015 x the ball radius) or radius (the old rule, "
                    "a bug: no vertex closer to the ball centre than it was = every inward move undone; for reproducing old runs)")
    ap.add_argument("--end-taper", type=float, default=0.0, help="10/24 option (tuck mode): the groove DEPTH fades out over this much u "
                    "at both ends of the line (height unchanged; 0 = full depth to the end as before)")
    ap.add_argument("--depth-from-shade", action="store_true", help="10/24 option (G2): crease depth and fold thickness scaled per eye by the "
                    "photo crease darkness (SHADE_LO..SHADE_HI -> 0..1); off = the same depth for everyone as before")
    ap.add_argument("--shade-lo", type=float, default=SHADE_LO, help="--depth-from-shade: darkness with strength 0")
    ap.add_argument("--shade-hi", type=float, default=SHADE_HI, help="--depth-from-shade: darkness with strength 1")
    ap.add_argument("--weak-taper", action="store_true", help="10/24 option (with --depth-from-shade and --end-taper): a weak fold fades over "
                    "end_taper / strength (at most WEAK_TAPER_MAX) at both ends - a faint line fades in gently in the photos")
    ap.add_argument("--end-shrink", type=float, default=0.0, help="10/24 option (tuck mode): over this much u from each line end the "
                    "skin bulge above the line narrows and flattens (its outline closes onto the end instead of curving up above it); 0 = off")
    ap.add_argument("--cover", type=float, default=0.03, help="10/24 option, --mode drape: how far the skin above the line hangs DOWN at its lip (x eye width)")
    ap.add_argument("--tuck-pow", type=float, default=1.5, help="10/23 option (G6): pretarsal tuck profile (above / h)^p - 1.5 as before; "
                    "higher keeps the strip between the lash and the crease on the lid and dives only just below the crease")
    ap.add_argument("--crease-continue", action="store_true", help="10/24 option (with --crease-span corners): measurement continues the "
                    "traced line past the outer corner by its own bend while the photo still shows a line (parts_measure_v1 CR_CONTINUE); "
                    "the model then carries the crease past the corner (lash reference there = the face-horizontal line through the corner)")
    ap.add_argument("--crease-min-strip", type=float, default=0.0, help="10/24 option: measurement drops a frame's line lying less than this "
                    "above the lash edge = the lid margin of a monolid (parts_measure_v1 CR_MIN_STRIP, e.g. 0.05; 0 = off)")
    ap.add_argument("--crease-type", default="length", choices=["length", "repeat"], help="10/24 option: crease type by the length rules "
                    "(default) or by columns seen at the same place in >= half of the near-frontal frames (parts_measure_v1 CR_TYPE)")
    ap.add_argument("--ramp-inner", type=float, default=0.0, help="10/24 option (--crease-curve direct): the height eases to 0 over this much u "
                    "past the line's INNER end (smoothstep; 0 = the 0.06 linear ramp as before)")
    ap.add_argument("--drop-outlier-frames", action="store_true", help="10/24 option: frames whose photo crease is > 0.05 x eye width off the "
                    "frames' consensus (a failed trace, gyu01 00656) are left out of the closed loop")
    ap.add_argument("--crease-end", default="columns", choices=["columns", "frames"], help="10/23 option (G1): where the direct curve ends - "
                    "the last column seen in >= 25 %% of the frames (columns, as before) or the median of where each frame's line ends "
                    "(frames; chae01 A8: a few long traces carried the line on at full height past where most frames end)")
    ap.add_argument("--crease-nodes", type=int, default=3, help="10/23 option: crease height nodes (3 = u 0.2/0.5/0.8 as before; "
                    "e.g. 5 = u 0.1/0.3/0.5/0.7/0.9 so an inline fold can sink to 0 nasally)")
    ap.add_argument("--loop-ref", default="aligned", choices=["aligned", "raw", "groove", "seen", "dark"], help="10/23 option: closed-loop offset after a corner "
                    "similarity (aligned, default) or as projected (raw = what the viewer shows; 만두 10/23: chae01 L line looked 0.02-0.03 "
                    "high while the aligned offset was 0), or groove (needs --loop-bands): the deepest point of the displaced mesh's depth "
                    "buffer near the photo line instead of the target vertex row (gyu01 A8: the row read high, the fold sat low and merged with the lid edge)")
    ap.add_argument("--loop-bands", action="store_true", help="10/23 option: closed loop corrects each of the 3 crease nodes from the photo "
                    "columns near it (|u - node| <= 0.15) instead of one offset for the whole eye (one large offset clipped the middle / "
                    "inner nodes to 0 on chae01-gnme5b R)")
    ap.add_argument("--crease-source", default="frame", choices=["frame", "stacked"], help="crease heights from the per-frame measurement "
                    "(default) or from the stacked one (double_eyelid_stacked; needs --stack or a measurement that has it)")
    ap.add_argument("--depth", type=float, default=DEPTH, help="crease groove depth x eye width (default %(default)s). 2026-10-20 chae01 (real "
                    "in-out fold): 0.010 is about one vertex spacing and not visible in the gray render -> compare model/eye_parts_depth_compare_gray.png")
    ap.add_argument("--bulge", type=float, default=BULGE, help="pretarsal forward push x eye width (default %(default)s)")
    ap.add_argument("--fold", type=float, default=0.0, help="overhang of the skin above the groove x eye width (default 0 = groove only; "
                    "2026-10-20 만두: the groove alone looks like a dent -> compare model/eye_parts_fold_compare_gray.png)")
    ap.add_argument("--lash-ref", default="offset", choices=["offset", "edge", "cols", "model"], help="crease height reference (model = 10/23 option, dense columns: photo crease minus the PROJECTED model lid per frame, see model_lid_targets): offset = eyelid_offset x taper "
                    "(where the model lid was fitted, default) or edge = per-column image lid-margin offset of this capture (parts_measure_v1 snap)")
    ap.add_argument("--json-out", default="eye_parts.json", help="name of the summary json in model/ (variants: eye_parts_<tag>.json)")
    ap.add_argument("--mode", default="groove", choices=["groove", "tuck", "drape", "lid"], help="crease shape: lid (2026-11-13, pipeline/lid_fold.py: one step in the lid's front skin; the line is corrected by projecting its vertices into the photos, no renders), groove (default), drape (10/24 option: flat pretarsal unit, the line invaginates back / up, the skin above hangs down over it by --cover) or tuck = pretarsal skin rolls in "
                    "under the skin above (anatomy, 2026-10-20)")
    ap.add_argument("--tuck-up", type=float, default=0.3, help="upward share of the tuck (x depth, tuck mode)")
    ap.add_argument("--curve", default="linear", choices=["linear", "smooth"], help="crease height interpolation between the 3 nodes (smooth = cosine-eased)")
    ap.add_argument("--depth-search", action="store_true", help="multi-angle (2026-10-21, 만두: side views wrong): grid-search a uniform "
                    "upper-lid depth (fullness band) so that the projected crease line fits the photo crease in the frontal AND the 3/4 frames "
                    "(crease lines seen from two angles constrain the lid depth); needs --iters >= 1 and 3/4 detections in the measurement")
    ap.add_argument("--depth-grid", default="-0.04:0.08:0.01", help="depth search grid lo:hi:step (x eye width)")
    ap.add_argument("--iters", type=int, default=0, help="C: closed-loop height correction passes (project the crease line into the frontal "
                    "frames, subtract the corner-aligned signed offset to the photo crease; needs frame_detail in the measurement)")
    ap.add_argument("--fold-sag", type=float, default=0.3, help="downward share of the overhang (x fold, default %(default)s)")
    ap.add_argument("--fold-width", type=float, default=0.12, help="height of the thickened band above the groove (x eye width, default %(default)s)")
    ap.add_argument("--smooth", type=int, default=0, help="smoothing passes of the displacement field inside the eye patch (default 0; 2026-10-20 만두: jagged line)")
    ap.add_argument("--fullness-from", default="", choices=["", "gnmb"], help="E3 alternative: 'gnmb' restores the statistical fit's "
                    "upper-lid thickness that the landmark residual pulled onto the eyeball (2026-10-20 만두: sunken lid). Default off")
    ap.add_argument("--fullness", action="store_true", help="APPLY the E3 fullness fit (default: fitted and recorded only). 2026-10-20 first runs: "
                    "the side silhouette of the brow / orbital band did not respond to the lid displacement (woo01 +0.05 x eye width "
                    "-> silhouette bins unchanged; chae01 -0.03..-0.05 -> 0.0-0.2 %% IOD of the 1.7 %% target), so the target is "
                    "not observable by this measurement yet and the displacement stays 0 until W5 shading / a lid-level observation")
    a = ap.parse_args()
    if a.mode == "lid":
        # the lid step: no roll (fold), and the line is corrected by projecting its vertices into the photos (no renders)
        a.fold, a.loop_ref, a.loop_bands = 0.0, "raw", True
    import meshio
    import parts_measure_v1 as pm_
    from parts_measure_v1 import measure
    pm_.CR_METHOD = "ridge" if a.crease_trace else a.crease_method
    pm_.CR_COLUMNS, pm_.CR_SHADOW_RULE, pm_.CR_TRACE = a.crease_columns, a.crease_shadow_rule == "on", a.crease_trace
    pm_.CR_SPAN, pm_.RIDGE_ANGLE = a.crease_span, a.crease_ridge_angle
    pm_.CR_ABOVE_LASH, pm_.CR_LO_FLOOR_EDGE, pm_.CR_OPEN_TOL, pm_.CR_TRIM_LASH = a.crease_above_lash, a.crease_lo_floor == "always", a.crease_open_tol, a.crease_trim_lash
    if a.crease_continue: pm_.CR_CONTINUE = True
    pm_.CR_MIN_STRIP, pm_.CR_TYPE = a.crease_min_strip, a.crease_type
    T0 = time.time(); tm = {}
    W = a.work; M = os.path.join(W, "model"); P = lambda n: os.path.join(M, n)
    base_ply, base_json = P(f"fit_{a.base}.ply"), P(f"fit_{a.base}.fit.json")
    out_ply, out_json = P(f"fit_{a.out}.ply"), P(f"fit_{a.out}.fit.json")
    if os.path.abspath(out_ply) == os.path.abspath(base_ply): raise SystemExit("refusing to overwrite the base fit")
    fit = meshio.read_any(base_ply); V = np.asarray(fit["vertices"], np.float64); F = np.asarray(fit["faces"], np.int64)
    fj = json.load(open(base_json)); lid = np.array(fj["landmark_vertex_ids"], np.int64)
    t = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); mat = t["materials"]; comp = t["components"]
    # 1. measurement on the base mesh (photo targets + side profile of the base)
    t0 = time.time()
    if a.measure: meas = json.load(open(a.measure, encoding="utf-8")); meas_path = a.measure
    else:
        meas_path = P(f"eye_parts_measure_{a.base}.json")
        meas = measure(W, mesh=base_ply, fit_json=base_json, out_path=meas_path, tag=a.base, sparse=a.sparse, stack=a.stack)
    tm["measure_sec"] = round(time.time() - t0, 1)
    # 2. targets -> parameters
    t0 = time.time(); B = EyeBasis(V, F, mat, comp, lid); tm["basis_sec"] = round(time.time() - t0, 2); B.clamp_mode = a.eyeball_clamp
    iod = float(np.linalg.norm(V[lid[33]] - V[lid[263]]))
    params = zero_params(); info = {}
    eo_all = json.load(open(P("eyelid_offset.json"))) if os.path.exists(P("eyelid_offset.json")) else {}
    eo = eo_all.get("offset", {}); eo_cols = eo_all.get("offset_cols") if (fj.get("eyelid_cols") or a.lash_ref == "cols") else None   # cols = per-column lash edges of eyelid_offset.json
    up = meas.get("upper_lid_profile") or {}
    side_of = {}
    for k in ("left", "right"):
        ne = (up.get(k) or {}).get("near_eye")
        if ne: side_of[ne] = up[k]
    mtgt = {}
    if a.lash_ref == "model":                                               # 10/23: targets from the projected base mesh lid
        import pycolmap
        from frame_check import intrinsics
        fd0 = (meas.get("double_eyelid") or {}).get("frame_detail") or {}
        poses0 = {k: v for k, v in json.load(open(P("frame_poses.json")))["frames"].items() if v["status"] != "dropped"}
        rec0 = pycolmap.Reconstruction(a.sparse or os.path.join(W, "colmap", "sparse_lens_anchored")); f0, cx0, cy0 = intrinsics(list(rec0.cameras.values())[0])
        proj0 = lambda X, R, tt: (lambda Q: np.c_[f0 * Q[:, 0] / Q[:, 2] + cx0, f0 * Q[:, 1] / Q[:, 2] + cy0])(X @ np.asarray(R).T + np.asarray(tt))
        for S in ("R", "L"):
            nc_ = len(((meas.get("double_eyelid") or {}).get(NAME[S]) or {}).get("curve_height_x_eye_width") or [])
            if nc_: mtgt[S] = model_lid_targets(fd0, S, V, lid, poses0, proj0, nc_)
    for S in ("R", "L"):
        ew = B.eyes[S]["ew"]
        de_src = meas.get("double_eyelid_stacked") if a.crease_source == "stacked" and meas.get("double_eyelid_stacked") else meas.get("double_eyelid")
        de_side = dict((de_src or {}).get(NAME[S]) or {})
        if a.crease_source == "stacked" and meas.get("double_eyelid_stacked"):      # the stacked summary has no edge offsets: borrow the per-frame ones
            de_side.setdefault("lid_edge_offset_x_eye_width", ((meas.get("double_eyelid") or {}).get(NAME[S]) or {}).get("lid_edge_offset_x_eye_width"))
        hs, ci = fit_crease(de_side, float(eo.get(S, 0.0) or 0.0), a.lash_ref, (eo_cols or {}).get(S) if eo_cols else None, a.crease_nodes, mtgt.get(S), a.crease_curve == "direct", a.crease_end == "frames", a.ramp_inner); ci["crease_source"] = a.crease_source if meas.get("double_eyelid_stacked") or a.crease_source == "frame" else "frame (no stacked data)"
        params[S]["crease"] = {"heights": hs, "depth": a.depth if max(hs) > 0 else 0.0, "bulge": a.bulge if max(hs) > 0 else 0.0, "fold": a.fold if max(hs) > 0 else 0.0, "fold_sag": a.fold_sag, "fold_width": a.fold_width, "mode": a.mode, "tuck_up": a.tuck_up, "curve": a.curve}
        if a.line_at != "groove": params[S]["crease"]["line"] = a.line_at
        if a.crease_slide > 0: params[S]["crease"]["slide"] = a.crease_slide
        if a.crease_push != "normal": params[S]["crease"]["push"] = a.crease_push
        if a.tuck_pow != 1.5: params[S]["crease"]["tuck_pow"] = a.tuck_pow
        if a.mode == "drape": params[S]["crease"]["cover"] = a.cover
        params[S]["crease"]["clamp"] = a.eyeball_clamp                       # written always (default clearance since 10/24)
        if a.end_taper > 0: params[S]["crease"]["end_taper"] = a.end_taper
        if a.end_shrink > 0: params[S]["crease"]["end_shrink"] = a.end_shrink
        if a.depth_from_shade and max(hs) > 0:
            # 10/24 option (만두: "모든 모델이 같은 깊이 쌍꺼풀인 것은 잘못"): the photo crease is the shadow under the skin that
            # folds over it, so its darkness (parts_measure_v1 crease_shade: how much darker the line is than the skin above,
            # median over the outer / middle / inner bands) sets the fold strength: (darkness - SHADE_LO) / (SHADE_HI - SHADE_LO)
            # clipped to 0..1 scales the groove depth and the fold thickness. 10/24: chae01 0.43-0.54 / gyu01 0.42-0.44 -> full,
            # min01 (a faint inner fold, visible only from below) 0.26 -> 0.3
            sh_ = [v.get("darkness") for v in (de_side.get("crease_shade") or {}).values() if isinstance(v, dict) and v.get("darkness") is not None]
            if sh_:
                dm_ = float(np.median(sh_)); st_ = float(np.clip((dm_ - a.shade_lo) / (a.shade_hi - a.shade_lo), 0.0, 1.0))
                params[S]["crease"]["depth"] = round(params[S]["crease"]["depth"] * st_, 5); params[S]["crease"]["fold"] = round(params[S]["crease"]["fold"] * st_, 5)
                ci["shade_strength"] = {"darkness_bands": [round(float(x), 3) for x in sh_], "darkness_median": round(dm_, 3), "strength": round(st_, 3),
                                        "depth": params[S]["crease"]["depth"], "fold": params[S]["crease"]["fold"], "lo_hi": [a.shade_lo, a.shade_hi]}
                if st_ <= 0:
                    # 10/24 (만두: a line found in only a few photos, or one like min01's - faint, visible only when the camera is
                    # below the face - gets no double eyelid at all): strength 0 = no crease (heights 0), not a 0-depth crease
                    hs = [0.0] * len(hs); params[S]["crease"].update(heights=hs, depth=0.0, fold=0.0, bulge=0.0)
                    ci["decision"] = f"photo line too faint (darkness {dm_:.3f} < {a.shade_lo}) -> no crease"; ci["shade_strength"]["applied"] = False
                if a.weak_taper and a.end_taper > 0 and st_ > 0:
                    # 10/24 (만두, min01: the faint fold started high and abruptly, the photo's line fades in gently): a weak fold
                    # fades out over a longer stretch at both ends - end_taper / strength, at most WEAK_TAPER_MAX
                    params[S]["crease"]["end_taper"] = round(min(WEAK_TAPER_MAX, a.end_taper / max(st_, 1e-3)), 4); ci["shade_strength"]["end_taper"] = params[S]["crease"]["end_taper"]
            else:
                ci["shade_strength"] = {"note": "no crease_shade in the measurement - depth unchanged"}
        params[S]["crease"]["fade_min"] = a.fade_min                         # written always (10/23: default 0 = no height fade)
        if ci.get("nodes_u") and len(ci["nodes_u"]) == len(hs): params[S]["crease"]["u"] = ci["nodes_u"]
        fu, fi = fit_fullness(side_of.get(S), iod / ew); fi["applied"] = bool(a.fullness)
        if not a.fullness: fi["fitted_not_applied"] = fu; fu = [0.0, 0.0, 0.0]
        if a.fullness_from == "gnmb" and os.path.exists(P("fit_gnmb.ply")):
            Vb_ = np.asarray(meshio.read_any(P("fit_gnmb.ply"))["vertices"], np.float64)
            if Vb_.shape == V.shape:
                fu, fi2 = fullness_from_gnmb(B, V, Vb_, S); fi["from_gnmb"] = fi2
        params[S]["fullness"] = fu
        cv, an, ei = fit_epicanthus((meas.get("caruncle") or {}).get(NAME[S]) or {}); params[S]["epicanthus"] = {"cover": cv, "angle_deg": an}
        info[S] = {"eye_width_model": round(ew, 4), "crease": ci, "fullness": fi, "epicanthus": ei}
    # 2b. C: closed loop on the frontal frames (corner-aligned signed offset of the projected crease line -> heights)
    loop = []
    fdet = (meas.get("double_eyelid") or {}).get("frame_detail") or {}
    if a.drop_outlier_frames and fdet:
        fdet, dropped_ = drop_outlier_frames(fdet); info["loop_dropped_frames"] = dropped_
    if a.iters > 0 and fdet:
        import pycolmap
        from frame_check import intrinsics
        from parts_measure_v1 import crease_model_dist, EYE as PM_EYE
        poses = {k: v for k, v in json.load(open(P("frame_poses.json")))["frames"].items() if v["status"] != "dropped"}
        rec = pycolmap.Reconstruction(a.sparse or os.path.join(W, "colmap", "sparse_lens_anchored")); fpx, cx, cy = intrinsics(list(rec.cameras.values())[0])
        proj = lambda X, R, tt: (lambda Q: np.c_[fpx * Q[:, 0] / Q[:, 2] + cx, fpx * Q[:, 1] / Q[:, 2] + cy])(X @ np.asarray(R).T + np.asarray(tt))
        def loop_cost(params_, passes, groups=("frontal", "three_quarter")):
            """run `passes` height passes on a copy of params_, return (params, cost per group, per-pass steps)"""
            pr = json.loads(json.dumps(params_)); steps = []
            for _ in range(passes):
                D_ = B.displace(pr, smooth_iters=a.smooth); Vt_ = V + D_; step_ = {}
                for S in ("R", "L"):
                    hs = np.array(pr[S]["crease"]["heights"], float)
                    if not (hs > 0).any(): continue
                    verts = B.crease_line(S, pr[S]); offs = []
                    for n, fd in fdet.items():
                        if S not in fd or n not in poses: continue
                        L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"])
                        Pn = proj(Vt_, poses[n]["R"], poses[n]["t"])
                        d = crease_model_dist(Pn, L, S, fd[S]["crease_heights"], fd[S]["column_u"], verts, Pn[lid[list(PM_EYE[S]["c"])]])
                        if d and d[4] is not None: offs.append((fd[S].get("pose", "frontal"), d[4]))
                    if len(offs) >= 2:
                        o = float(np.median([v for _, v in offs])); hs = np.where(hs > 0, np.clip(hs - o, 0, None), 0)
                        pr[S]["crease"]["heights"] = [round(float(x), 4) for x in hs]; step_[S] = {"signed_offset": round(o, 4), "frames": len(offs)}
                steps.append(step_)
            # cost after the passes: median |aligned signed offset| per group over both eyes
            D_ = B.displace(pr, smooth_iters=a.smooth); Vt_ = V + D_; per = {g: [] for g in groups}
            for S in ("R", "L"):
                if not (np.array(pr[S]["crease"]["heights"]) > 0).any(): continue
                verts = B.crease_line(S, pr[S])
                for n, fd in fdet.items():
                    if S not in fd or n not in poses: continue
                    L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"])
                    Pn = proj(Vt_, poses[n]["R"], poses[n]["t"])
                    d = crease_model_dist(Pn, L, S, fd[S]["crease_heights"], fd[S]["column_u"], verts, Pn[lid[list(PM_EYE[S]["c"])]])
                    g = "three_quarter" if fd[S].get("pose") == "three_quarter" else "frontal"
                    if d and d[4] is not None and g in per: per[g].append(abs(d[4]))
            cost = {g: (round(float(np.median(v)), 4) if v else None) for g, v in per.items()}
            return pr, cost, steps
        if a.depth_search:
            lo_, hi_, st_ = [float(x) for x in a.depth_grid.split(":")]
            grid = np.round(np.arange(lo_, hi_ + 1e-9, st_), 4); table = []
            for dval in grid:
                pr0 = json.loads(json.dumps(params))
                for S in ("R", "L"): pr0[S]["fullness"] = [float(dval)] * 3
                pr1, cost, _ = loop_cost(pr0, max(1, a.iters))
                tot = np.nanmean([c for c in (cost.get("frontal"), cost.get("three_quarter")) if c is not None]) if any(cost.values()) else np.nan
                table.append({"depth": float(dval), "cost_frontal": cost.get("frontal"), "cost_three_quarter": cost.get("three_quarter"), "cost": round(float(tot), 4) if np.isfinite(tot) else None})
            ok_ = [r for r in table if r["cost"] is not None]
            best = min(ok_, key=lambda r: r["cost"]) if ok_ else None
            if best is not None:
                for S in ("R", "L"): params[S]["fullness"] = [best["depth"]] * 3; info[S]["fullness"]["depth_search"] = best
            loop.append({"depth_search": {"grid": table, "chosen": best, "n_three_quarter_obs": sum(1 for fd in fdet.values() for S in fd if fd[S].get("pose") == "three_quarter")}})
        hs0 = {S: list(params[S]["crease"]["heights"]) for S in ("R", "L")}         # photo-fitted heights (--loop-bands bounds)
        if a.loop_ref in ("groove", "seen", "dark"):
            from render import render as _render
            import parts_measure_v1 as pmg
            ew3 = {S: float(np.linalg.norm(V[lid[PM_EYE[S]["c"][0]]] - V[lid[PM_EYE[S]["c"][1]]])) for S in ("R", "L")}
            gF = {S: F[(np.linalg.norm(V[F] - V[lid[PM_EYE[S]["c"][0]]], axis=2) < 3 * ew3[S]).any(1)] for S in ("R", "L")}

            def seen_cols(Vt_, n, S, fd):
                """10/24 --loop-ref seen (만두: both people's line ends sat above the yellow points; the target vertex row was on
                them +-0.02 but the DARK line one sees - the underside of the skin over the groove - sat +0.04..0.06 higher,
                most at the outer end): the line traced on the untextured render of the displaced mesh from this frame's camera
                (the photo detector), [(u, seen v - photo crease v)] in the photo eye frame, x eye width"""
                L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"]); frp = pmg.eye_frame(L, S)
                ph = [(u, h) for u, h in zip(fd[S]["column_u"], fd[S]["crease_heights"]) if h is not None]
                if frp is None or len(ph) < 3: return []
                pu, phh = map(np.array, zip(*ph)); lash = pmg.lid_line(L, S, frp)
                R_ = np.asarray(poses[n]["R"]); t_ = np.asarray(poses[n]["t"]); Xc = Vt_ @ R_.T + t_; z = Xc[:, 2]
                Lm = np.c_[fpx * Xc[lid, 0] / Xc[lid, 2] + cx, fpx * Xc[lid, 1] / Xc[lid, 2] + cy]; frm = pmg.eye_frame(Lm, S)
                c0 = (Lm[PM_EYE[S]["c"][0]] + Lm[PM_EYE[S]["c"][1]]) / 2; side = int(3.0 * frm[3]); x0, y0 = int(c0[0] - side / 2), int(c0[1] - side * 0.6)
                S_ = 2 * side; k_ = 2.0; Xs = Xc.copy()
                Xs[:, 0] += (k_ * (cx - x0) - S_ / 2) / (k_ * fpx) * z; Xs[:, 1] += (k_ * (cy - y0) - S_ / 2) / (k_ * fpx) * z
                img = _render(Xs, gF[S], view=np.diag([1.0, -1.0, -1.0]), size=S_, center=np.zeros(3), persp=(0.0, k_ * fpx), light=(0.0, 0.4, 1.0),
                              bg=(110, 110, 110), colors=np.full((len(Vt_), 3), 0.8))
                import cv2 as _cv2
                g = _cv2.resize(_cv2.cvtColor(img, _cv2.COLOR_RGB2GRAY), (side, side), interpolation=_cv2.INTER_AREA).astype(np.float32)
                Lr = Lm - [x0, y0]; c = pmg.crease_frame(g, Lr, S, use_prior=False)
                if not c: return []
                frr = pmg.eye_frame(Lr, S)
                pts = [p0 + h * frr[3] * frr[2] for (u, p0, _), h in zip(pmg.crease_columns(Lr, S, frr, None), c[0]) if h is not None]
                if len(pts) < 3: return []
                m = pmg.to_eye(np.array(pts) + [x0, y0], frp); sel = (m[:, 0] >= pu.min()) & (m[:, 0] <= pu.max())
                return [(float(uu), float(vv - np.interp(uu, lash[:, 0], lash[:, 1]) - np.interp(uu, pu, phh))) for uu, vv in m[sel]]

            def dark_cols(Vt_, n, S, fd):
                """10/24 --loop-ref dark (만두, gyu01 A12 screen-left eye: the line end sat high; measured: the model's DARK line
                was +0.03 above the yellow at u 0.15-0.25, ~0 in the middle): per column of this frame the darkest point of
                the untextured render of the displaced mesh within DARK_WIN of the photo crease (never below 0.035 above the
                lid line = the lash band), [(u, dark v - photo crease v)]. Unlike 'seen' (the line DETECTOR on the render,
                biased +0.05 high), this reads the render's own brightness, the way the comparison sheets were judged"""
                L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"]); frp = pmg.eye_frame(L, S)
                ph = [(u, h) for u, h in zip(fd[S]["column_u"], fd[S]["crease_heights"]) if h is not None]
                if frp is None or len(ph) < 5: return []
                pu, phh = map(np.array, zip(*ph)); lash = pmg.lid_line(L, S, frp); pa, tt_, nn_, ew_ = frp
                R_ = np.asarray(poses[n]["R"]); t_ = np.asarray(poses[n]["t"]); Xc = Vt_ @ R_.T + t_; z = Xc[:, 2]
                c0 = (L[PM_EYE[S]["c"][0]] + L[PM_EYE[S]["c"][1]]) / 2; side = int(1.8 * ew_); x0, y0 = int(c0[0] - side / 2), int(c0[1] - side * 0.62)
                k_ = 3.0; S_ = int(k_ * side); Xs = Xc.copy()
                Xs[:, 0] += (k_ * (cx - x0) - S_ / 2) / (k_ * fpx) * z; Xs[:, 1] += (k_ * (cy - y0) - S_ / 2) / (k_ * fpx) * z
                img = _render(Xs, gF[S], view=np.diag([1.0, -1.0, -1.0]), size=S_, center=np.zeros(3), persp=(0.0, k_ * fpx), light=(0.0, 0.4, 1.0),
                              bg=(110, 110, 110), colors=np.full((len(Vt_), 3), 0.8))
                import cv2 as _cv2
                g = _cv2.cvtColor(img, _cv2.COLOR_RGB2GRAY).astype(np.float32); out_ = []
                for u in np.linspace(max(pu.min(), 0.05), pu.max(), 21):
                    vl = float(np.interp(u, lash[:, 0], lash[:, 1])); hy = float(np.interp(u, pu, phh))
                    hs = np.arange(max(0.035, hy - DARK_WIN[0]), hy + DARK_WIN[1], 0.004)
                    if len(hs) < 5: continue
                    px = np.array([(pa + ew_ * (u * tt_ + (vl + h) * nn_) - [x0, y0]) * k_ for h in hs])
                    ok = (px[:, 0] >= 0) & (px[:, 0] < S_) & (px[:, 1] >= 0) & (px[:, 1] < S_)
                    if ok.sum() < 5: continue
                    vals = np.where(ok, g[np.clip(px[:, 1].astype(int), 0, S_ - 1), np.clip(px[:, 0].astype(int), 0, S_ - 1)], 999)
                    i = int(np.argmin(vals))
                    if vals[i] < 150 and 0 < i < len(hs) - 1: out_.append((float(u), float(hs[i] - hy)))   # a real minimum inside the window
                return out_

            def groove_cols(Vt_, n, S, fd):
                """10/23 --loop-ref groove (gyu01 A8: the target vertex row read 0.01-0.02 HIGH while the fold the camera sees sat
                0.015-0.025 LOW of the photo line at u 0.4-1.0 -> the loop pulled the fold down into the lid margin, where its
                shadow merged with the lid edge's into one wide soft band): [(u, model groove v - photo crease v)] in this
                frame's photo eye frame, x eye width. Groove = deepest point of the camera depth minus its local QUADRATIC trend
                (+-GROOVE_TREND) within +-GROOVE_NEAR of the photo line, on the depth buffer of the displaced mesh, and only a
                true local maximum inside that window (first test with a linear trend: the convex lid made the window END the
                deepest point, the offset stuck at the edge and the loop raised gyu01 L by its cap)"""
                L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"]); fr = pmg.eye_frame(L, S)
                ph = [(u, h) for u, h in zip(fd[S]["column_u"], fd[S]["crease_heights"]) if h is not None]
                if fr is None or len(ph) < 3: return []
                pa, tt_, nn_, ew_ = fr; pu, phh = map(np.array, zip(*ph)); lash = pmg.lid_line(L, S, fr)
                R_ = np.asarray(poses[n]["R"]); t_ = np.asarray(poses[n]["t"]); Xc = Vt_ @ R_.T + t_; z = Xc[:, 2]
                c0 = (L[PM_EYE[S]["c"][0]] + L[PM_EYE[S]["c"][1]]) / 2; side = int(2.0 * ew_); x0, y0 = int(c0[0] - side / 2), int(c0[1] - side * 0.62)
                k_ = GROOVE_K; S_ = int(k_ * side); Xs = Xc.copy()
                Xs[:, 0] += (k_ * (cx - x0) - S_ / 2) / (k_ * fpx) * z; Xs[:, 1] += (k_ * (cy - y0) - S_ / 2) / (k_ * fpx) * z
                _, zb, _ = _render(Xs, gF[S], view=np.diag([1.0, -1.0, -1.0]), size=S_, center=np.zeros(3), persp=(0.0, k_ * fpx),
                                   colors=np.full((len(Vt_), 3), 0.8), return_depth=True)
                zb = np.where(np.isfinite(zb), -zb, np.nan) / (np.median(z) / fpx * ew_)
                hs_ = np.arange(-0.02, 0.30, 0.004); out_ = []
                for u in np.linspace(pu.min(), pu.max(), 15):
                    vl = float(np.interp(u, lash[:, 0], lash[:, 1])); hp = float(np.interp(u, pu, phh))
                    px = ((pa + ew_ * (u * tt_ + (vl + hs_)[:, None] * nn_) - [x0, y0]) * k_).astype(int)
                    if not ((px[:, 0] >= 0) & (px[:, 0] < S_) & (px[:, 1] >= 0) & (px[:, 1] < S_)).all(): continue
                    d = zb[px[:, 1], px[:, 0]]
                    if not np.isfinite(d).all(): continue
                    win = (hs_ >= max(0.005, hp - GROOVE_TREND)) & (hs_ <= hp + GROOVE_TREND)
                    if win.sum() < 8: continue
                    rd = d - np.polyval(np.polyfit(hs_[win], d[win], 2), hs_); near = win & (np.abs(hs_ - hp) <= GROOVE_NEAR); nz = np.where(near)[0]
                    if len(nz) < 3: continue
                    i = int(np.argmax(np.where(near, rd, -1e9)))
                    if rd[i] * 1000 >= 0.5 and nz[0] < i < nz[-1] and rd[i] >= rd[i - 1] and rd[i] >= rd[i + 1]: out_.append((float(u), float(hs_[i] - hp)))
                return out_
        lid_loop = {}                                              # --mode lid: per eye the best line distance and its heights
        for it in range(a.iters + (1 if a.mode == "lid" else 0)):   # lid: one more pass that only checks the last correction
            D = B.displace(params, smooth_iters=a.smooth); Vt = V + D; step = {}
            for S in ("R", "L"):
                hs = np.array(params[S]["crease"]["heights"], float)
                if not (hs > 0).any() or lid_loop.get(S, {}).get("done"): continue
                verts = B.crease_line(S, params[S]); offs = []
                for n, fd in fdet.items():
                    if S not in fd or n not in poses: continue
                    L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"])
                    Pn = proj(Vt, poses[n]["R"], poses[n]["t"])
                    d = crease_model_dist(Pn, L, S, fd[S]["crease_heights"], fd[S]["column_u"], verts, Pn[lid[list(PM_EYE[S]["c"])]])
                    if d and d[4] is not None: offs.append(d[4])
                if a.loop_bands:                                       # per node from the photo columns near it (10/23)
                    nodes_full = nodes_of(params[S]["crease"])
                    # dense (direct) curves: offsets on 5 anchors, interpolated to every node (10/23); else per node
                    nodes_ = np.linspace(0.1, 0.9, 5) if len(hs) > 7 else nodes_full
                    bw_ = 0.5 * float(np.diff(nodes_).mean())                 # half the node spacing (0.15 for 3 nodes)
                    ob = [[] for _ in nodes_]
                    if a.loop_ref in ("groove", "seen", "dark"):                 # the fold the camera sees (depth buffer / gray render), per anchor
                        # one render per frame, frames independent: rendered in threads (NumPy / OpenCV release the GIL), read
                        # back in frame order, so the medians are the same as the one-by-one loop (~20 s of 30 s per
                        # eye_parts_fit call on gyu01 were these renders). 'seen' runs the photo crease detector, which reads
                        # parts_measure_v1 module state -> kept one by one
                        cols = {"groove": groove_cols, "seen": seen_cols, "dark": dark_cols}[a.loop_ref]
                        todo = [n for n, fd in fdet.items() if S in fd and n in poses]
                        with ThreadPoolExecutor(1 if a.loop_ref == "seen" else RENDER_WORKERS) as ex:
                            per_frame = list(ex.map(lambda n, Vt=Vt, S=S, cols=cols: cols(Vt, n, S, fdet[n]), todo))
                        for gc in per_frame:
                            for j, uj in enumerate(nodes_):
                                vv = [o_ for u_, o_ in gc if abs(u_ - uj) <= bw_]
                                if vv: ob[j].append(float(np.median(vv)))
                    else:                                                        # 'aligned' / 'raw': distances to the photo crease columns
                        for n, fd in fdet.items():
                            if S not in fd or n not in poses: continue
                            L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"]); Pn = proj(Vt, poses[n]["R"], poses[n]["t"])
                            for j, uj in enumerate(nodes_):
                                hb = [h if (h is not None and abs(u - uj) <= bw_) else None for h, u in zip(fd[S]["crease_heights"], fd[S]["column_u"])]
                                d = crease_model_dist(Pn, L, S, hb, fd[S]["column_u"], verts, Pn[lid[list(PM_EYE[S]["c"])]])
                                v_ = (d[1] if a.loop_ref == "raw" else d[4]) if d else None
                                if v_ is not None: ob[j].append(v_)
                    # damped (nodes share vertices through the interpolated curve; undamped steps oscillated, 10/23 chae01 R
                    # middle -> 0 / inner -> 0.135): half the offset, at most LOOP_STEP per pass, nodes seen in < 3 frames kept,
                    # and a node never leaves [LOOP_FLOOR x, initial + LOOP_STEP x passes] of its photo-fitted height
                    nmin = max(5, 0.4 * max(len(x) for x in ob))     # 10/23: a node seen in few frames is left alone (gyu01 L inner node rose to its cap on 3 frames)
                    if a.mode == "lid":
                        # a correction is kept only while the line gets nearer to the photo line (median over the anchors
                        # of |median offset|; 8 passes without this made 719323cd R's inner half vanish). Worse, or the
                        # line gone: back to the heights before that correction, and this eye is finished
                        seen_ = [abs(float(np.median(x))) for x in ob if len(x) >= nmin]; cost_ = float(np.median(seen_)) if seen_ else None
                        st_ = lid_loop.setdefault(S, {"cost": None, "heights": None})
                        if cost_ is None or (st_["cost"] is not None and cost_ >= st_["cost"]):
                            if st_["heights"] is not None: params[S]["crease"]["heights"] = st_["heights"]
                            st_["done"] = True; step[S] = {"stopped": True, "line_dist": cost_, "kept_line_dist": st_["cost"], "ref": a.loop_ref}; continue
                        st_.update(cost=cost_, heights=list(params[S]["crease"]["heights"]))
                        if it == a.iters: step[S] = {"checked": True, "line_dist": cost_, "ref": a.loop_ref}; continue
                    oj = [float(np.clip(0.5 * np.median(x), -LOOP_STEP, LOOP_STEP)) if len(x) >= nmin else 0.0 for x in ob]
                    if len(hs) > 7: oj = list(np.interp(nodes_full, nodes_, oj))
                    h0 = np.array(hs0[S], float)
                    hs = np.where(hs > 0, np.clip(hs - np.array(oj), LOOP_FLOOR * h0, h0 + LOOP_STEP * a.iters), 0)
                    params[S]["crease"]["heights"] = [round(float(x), 4) for x in hs]
                    step[S] = {"signed_offset_nodes": [round(x, 4) for x in oj], "frames_nodes": [len(x) for x in ob], "ref": a.loop_ref, "heights": params[S]["crease"]["heights"]}
                    continue
                if a.loop_ref == "raw":                                # same loop, offset as projected
                    offs = []
                    for n, fd in fdet.items():
                        if S not in fd or n not in poses: continue
                        L = np.zeros((468, 2)); L[fd[S]["lid_ids"]] = np.array(fd[S]["lid_px"]); Pn = proj(Vt, poses[n]["R"], poses[n]["t"])
                        d = crease_model_dist(Pn, L, S, fd[S]["crease_heights"], fd[S]["column_u"], verts, Pn[lid[list(PM_EYE[S]["c"])]])
                        if d: offs.append(d[1])
                if len(offs) >= 2:
                    o = float(np.median(offs)); hs = np.where(hs > 0, np.clip(hs - o, 0, None), 0)
                    params[S]["crease"]["heights"] = [round(float(x), 4) for x in hs]; step[S] = {"signed_offset": round(o, 4), "frames": len(offs), "heights": params[S]["crease"]["heights"]}
            loop.append(step)
    # 3. displacement + checks
    t0 = time.time(); D = B.displace(params, smooth_iters=a.smooth); V1 = V + D; tm["solve_sec"] = round(time.time() - t0, 2)
    ewr = B.eyes["R"]["ew"]; dn = np.linalg.norm(D, axis=1)
    skinF = F[(mat[F] == 0).all(1)]
    patch = np.zeros(len(V), bool)
    for e in B.eyes.values(): patch |= e["patch"]
    from gnm_model import GNM, template_map
    G = GNM(); o2g = template_map()[0]
    grp = lambda *ns: np.max([(G.groups[G.group_names.index(n)] > 0.3)[o2g] for n in ns], axis=0)
    eye_reg = grp("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region", "left_infraorbital_region", "right_infraorbital_region", "eye_sockets")
    ring = np.concatenate([e["ring"] for e in B.eyes.values()])
    checks = {"moved_vertices": int((dn > 1e-4 * ewr).sum()), "max_disp_x_ew": round(float(dn.max() / ewr), 4),
              "moved_outside_patch": int((dn[~patch] > 0).sum()), "max_disp_outside_eye_regions_x_ew": round(float(dn[~eye_reg].max() / ewr), 6),
              "moved_in_face_regions_of_crease_index": int((dn[grp("forehead_region", "middle_brow_region", "nose_region", "left_cheek_region", "right_cheek_region",
                                                                     "left_infraorbital_region", "right_infraorbital_region", "chin_region")] > 1e-4 * ewr).sum()),
              "lid_edge_max_disp_x_ew": round(float(np.abs(D[ring]).max() / ewr), 8),
              # landmark vertices inside the eye patch may be TARGETS of the fullness / crease bands (eye_parts: "held unless
              # targeted"); every landmark outside the patch must stay (the hold-out landmark score stays comparable)
              "landmark_outside_patch_max_disp_x_ew": round(float(np.abs(D[lid[~patch[lid]]]).max() / ewr), 8) if (~patch[lid]).any() else 0.0,
              "landmark_in_patch_max_disp_x_ew": round(float(np.abs(D[lid[patch[lid]]]).max() / ewr), 5) if patch[lid].any() else 0.0,
              "landmarks_in_patch_moved": int((dn[lid] > 1e-4 * ewr).sum()),
              "eyeball_moved": float(np.abs(D[np.isin(comp, [1, 2])]).max()), "inside_eyeball": inside_eyeball(B, V1)}
    checks["flipped_faces"], checks["flipped_degenerate_faces"] = flipped_faces(V, V1, skinF)
    # 10/24 (drape: the skin folding over the pocket turns faces by design): flipped faces split into those inside the crease
    # band (base position within -0.03..+fold_width of the line) and elsewhere - REPORTED only, the pass rule is unchanged
    _n0 = np.cross(V[skinF[:, 1]] - V[skinF[:, 0]], V[skinF[:, 2]] - V[skinF[:, 0]]); _n1 = np.cross(V1[skinF[:, 1]] - V1[skinF[:, 0]], V1[skinF[:, 2]] - V1[skinF[:, 0]])
    _a0 = np.linalg.norm(_n0, axis=1); _fl = ((_n0 * _n1).sum(1) < 0) & (_a0 >= 0.05 * np.median(_a0)); _band = np.zeros(len(V), bool)
    for S in ("R", "L"):
        e_ = B.eyes[S]; c_ = params[S]["crease"]; hh_ = np.interp(e_["uv"][:, 0], nodes_of(c_), c_["heights"]); ab_ = e_["uv"][:, 1] - e_["lash_v"]
        _band |= e_["patch"] & (hh_ > 0.005) & (ab_ > hh_ - 0.03) & (ab_ < hh_ + float(c_.get("fold_width", 0.12)))
    _inb = _band[skinF].all(1)
    checks["flipped_faces_crease_band"], checks["flipped_faces_elsewhere"] = int((_fl & _inb).sum()), int((_fl & ~_inb).sum())
    # crease index as qa_check computes it (FACE regions vs gnmb) and with the orbital regions added
    cr = {}
    if os.path.exists(P("fit_gnmb.ply")):
        from qa_check import FACE
        Vb = np.asarray(meshio.read_any(P("fit_gnmb.ply"))["vertices"], np.float64)
        if Vb.shape == V.shape:
            orb = ["left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region"]
            cr = {"face": crease_index(G, {"base": V, a.out: V1}, Vb, iod, FACE), "face_plus_orbital": crease_index(G, {"base": V, a.out: V1}, Vb, iod, FACE + orb),
                  "orbital_only": crease_index(G, {"base": V, a.out: V1}, Vb, iod, orb)}
    checks["crease_index_pct_iod"] = cr
    cl_verts = {S: [int(i) for i in B.crease_line(S, params[S])] for S in ("R", "L")}
    checks["crease_line_vertices"] = {S: len(v) for S, v in cl_verts.items()}
    checks["pass"] = bool(checks["moved_outside_patch"] == 0 and checks["inside_eyeball"] == 0 and checks["flipped_faces"] == 0
                          and checks["eyeball_moved"] == 0 and checks["lid_edge_max_disp_x_ew"] < 1e-9 and checks["landmark_outside_patch_max_disp_x_ew"] < 1e-9)
    # 4. write
    meshio.write_ply(out_ply, V1, F, fit.get("colors"))
    fj2 = dict(fj); fj2["eye_parts"] = {"base": a.base, "params": params, "checks": {k: v for k, v in checks.items() if k != "crease_index_pct_iod"}}
    json.dump(fj2, open(out_json, "w"), indent=1)
    tm["total_sec"] = round(time.time() - T0, 1)
    rep = {"work": os.path.basename(os.path.normpath(W)), "base": a.base, "out": a.out, "measurement": os.path.basename(meas_path),
           "constants": {"depth_x_ew": a.depth, "bulge_x_ew": a.bulge, "fold_x_ew": a.fold, "smooth_iters": a.smooth, "stack": a.stack, "crease_source": a.crease_source, "crease_method": a.crease_method, "depth_default": DEPTH, "bulge_default": BULGE, "fullness_cap_x_ew": FULL_MAX, "fullness_min_frames": FULL_MIN_FRAMES,
                         "fullness_sign_agree": FULL_SIGN_AGREE, "epicanthus_min_frames": EPI_MIN_FRAMES, "epicanthus_weak_max": EPI_WEAK_MAX,
                         "note": "depth / bulge are not measured by the photos (no dark-band profile yet) -> E1' preview constants; all x eye width"},
           "params": params, "fit_info": info, "closed_loop": loop, "lash_source": {S: B.eyes[S].get("lash_source") for S in ("R", "L")},
           "checks": checks, "crease_line_vertices": cl_verts, "timing_sec": tm}
    json.dump(rep, open(P(a.json_out), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: rep[k] for k in ("out", "params", "checks", "timing_sec")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
