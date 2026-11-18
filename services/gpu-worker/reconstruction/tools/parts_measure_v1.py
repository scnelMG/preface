"""W7-eye part measurements v1 (2026-10-20, WORKPLAN W7-눈 E0): MEASURES ONLY, the shape is not changed.
-> work/<id>/model/parts_v1.json  (parts_v0.json from tools/parts_measure.py is kept as it is)

All sizes are ratios of the eye width (outer to inner corner of the same eye) or of the eye distance (IOD); no
per-person numbers anywhere. Holdout frames (model/holdout.txt) are never used for a measurement, only for the E1
evaluation (4.). Frames whose pose was dropped by the pose check are skipped.

  1. double eyelid (쌍꺼풀, E2)  near-frontal frames (|yaw| <= 12, |pitch| <= 10, blink < 0.35). Per upper-lid column
     (5 inner columns of the 7 MediaPipe upper-lid points) ALL dark valleys 0.10-0.40 x eye width above the lid are
     candidates; the search window stops 0.08 x eye width under the brow (brow hair is never a candidate). The valleys
     of the 5 columns are then LINKED into one curve (adjacent columns may differ by at most 0.06 x eye width; a valley
     linked to no neighbour is dropped -> lashes / shadows / brow hairs are removed). Valley depth with hysteresis: a
     clear valley (>= 4 gray levels) starts a curve, a faint one (>= 2) may only continue it (flat lighting, eun02). Per eye: per-column detection rate
     over frames, median crease curve (eye-width coordinates), frame detection rate (>= 3 contiguous columns), TYPE:
       inner_candidate  outer-side columns found (rate >= 0.5), inner-side columns not (rate < 0.25): the fold tapers
                        into the lash line towards the nose (속쌍꺼풀 후보) - checked first
       outer            >= 50 % of frames with a 3-column curve and the median curve has 3 contiguous columns (겉쌍꺼풀)
       uncertain        everything else - a weak video / puffy lid may hide the crease, so "none" is never claimed
     10/24 options: --crease-min-strip drops a frame's line that lies on the lash edge (the lid margin of a monolid);
     --crease-type repeat replaces the rules above with "a run of columns seen at the same place in >= half of the
     near-frontal frames" (outer when found, frontal frames only) - see CR_MIN_STRIP / CR_TYPE.
     3/4 frames (|yaw| 30-60, decision 10/20): the same column search on the eye NEARER the camera (larger projected
     eye width) - the fold casts a stronger shadow seen from the side, and where it meets the lid margin (taper) shows.
     type_frontal = frontal frames only; type (FINAL) = frontal when it is decided, else the 3/4 type when that one is
     decided, else uncertain (type_source says which).
     The current model has no crease (GNM mean lid) -> model_crease = null; the photo curve is the E2~E4 target.
  2. upper-lid side profile (눈두덩이, E3)  side frames (SfM |yaw| 55-95, mostly no face). Photo edge = border of the
     FACE-SKIN class (prep/class_masks_v3) where the outside is background only (border pixels within 6 px of hair /
     clothes / other are dropped). Model edge = silhouette of the skin mesh near the brow + orbital regions. Rows are
     limited to brow lower edge ~ lash line (both from the model's projected landmarks of the eye nearer the camera),
     the brow hair band (brow points and 0.1 x eye width above them) is excluded; a short forehead band just above the
     hair band is reported separately (brow-bone reference). Signed distance in % IOD (+ model outside = fuller,
     - inside = hollower), per 5 height bins (0 = lash line, 1 = brow lower edge) and overall; p90 over frames.
  3. epicanthal fold / caruncle (몽고주름·눈물언덕, E4)  near-frontal frames, blink < 0.35. In a 0.25 x 0.25 eye-width
     ROI around the inner corner (MediaPipe 133 / 362) the Lab a* channel (pink caruncle vs skin, Otsu inside the ROI)
     (pixels at least 3 a* units pinker than the ROI median, Otsu fails on so small a region)
     gives the exposed caruncle region touching the eye opening. Exposed width / eye width, covering-edge curve (nasal
     limit of the exposed region per row, eye-width coordinates), overhang of the fold past the MediaPipe inner corner.
  4. eyelid curve distance (E1)  HOLDOUT frames (|yaw| <= 25): upper / lower lid curves of the photo (MediaPipe) and of
     the model (projected landmark vertices) in the photo's eye-width frame; the photo upper lid is moved to the lash
     line with the eye's eyelid_offset (the model's points were fitted there). Point-to-polyline distance, x eye width,
     as measured and after aligning the model's corners to the photo's (shape only).
  5. crease-line distance (E2, 2026-10-20)  when --eye-parts <eye_parts.json> names the crease-line vertices of the
     measured mesh (pipeline/eye_parts_fit.py), those vertices are projected into every near-frontal frame (training
     frames = in-sample, holdout frontal frames = out-of-sample, reported apart) and compared with that frame's photo
     crease curve in the photo's eye-width frame: |v_model - v_photo(u)| median per frame, x eye width, signed too.
  6. multi-frame stacking (W14 P0, 2026-10-21, --stack N): frames of one angle group (frontal, each pitch bin) are warped
     onto a reference frame by an affine from 3 eye points (outer corner, inner corner, upper-lid middle: aligns position,
     size, rotation AND openness) and averaged N at a time; the crease rules then run on the averaged image with the
     reference landmarks. Reduces compression noise / shadow-edge flicker without a model. Results go to
     "double_eyelid_stacked" next to the per-frame "double_eyelid" (same summary fields) for comparison.
usage: python tools/parts_measure_v1.py work/<id> [--debug] [--stack 5]
       python tools/parts_measure_v1.py work/<id> --mesh model/fit_gnme.ply --fit-json model/fit_gnme.fit.json --tag gnme
                                        [--eye-parts model/eye_parts.json]   -> model/parts_v1_gnme.json (parts_v1.json kept)
"""
import argparse, json, os, sys, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
# MediaPipe face-mesh ids, each list ordered OUTER (temporal) -> INNER (nasal)
EYE = {"R": {"up": [246, 161, 160, 159, 158, 157, 173], "lo": [7, 163, 144, 145, 153, 154, 155], "c": (33, 133),
             "brow_lo": [46, 53, 52, 65, 55], "brow_up": [70, 63, 105, 66, 107]},
       "L": {"up": [466, 388, 387, 386, 385, 384, 398], "lo": [249, 390, 373, 374, 380, 381, 382], "c": (263, 362),
             "brow_lo": [276, 283, 282, 295, 285], "brow_up": [300, 293, 334, 296, 336]}}
TAPER = [0.6, 0.9, 1.0, 1.0, 1.0, 0.9, 0.6]          # eyelid_offset.py taper over the 7 upper-lid points
NAME = {"R": "right", "L": "left"}
# crease search (all x eye width or rates)
CR_LO, CR_HI, CR_BROW_GAP, CR_JUMP = 0.10, 0.40, 0.08, 0.06
# 2026-10-21 (gyu01 left eye missed): the fixed lower bound 0.10 cut off a clear crease at 0.07-0.12 x eye width above the
# MediaPipe point (valley depth 13-33 gray levels; the lash band itself sits at ~0.03). The lower bound is now the lash-band
# edge of that column (lid_edge_snap) + CR_ABOVE_LASH, CR_LO_MIN when no edge is found; CR_LO stays the fallback name.
CR_ABOVE_LASH, CR_LO_MIN = 0.03, 0.06
# 10/23 options (만두: chae's line END marked a little high, gyu's end not found; 규칙 검토 세션: the 0.06 floor applied even
# when the lash edge was found, cutting 17 % of gyu's points): every traced line ENDED on the window's lower bound (end
# height 0.002-0.003 above it, both people) = the fold sinking into the lash line could not go lower.
# CR_LO_FLOOR_EDGE False = the floor CR_LO_MIN only when no lash edge was found (as the comment above says);
# CR_ABOVE_LASH can be narrowed with --crease-above-lash. CR_OPEN_TOL > 0 = frontal frames whose eye opening differs from the
# capture median by more than this share are left out of the crease (gyu L: opening spread 36 % vs chae 18-20 %)
CR_LO_FLOOR_EDGE, CR_OPEN_TOL = True, 0.0
# CR_TRIM_LASH (with a lowered bound the trace sank into the lash line and then RODE its upper edge to the inner corner,
# chae01 end u 0.67 -> 0.91, turning an inline fold into an in-out one): the end runs of the traced path that lie on the
# window's lower bound (within TRIM_TOL) are cut back to their first column = the line ends where it meets the lash line
CR_TRIM_LASH, TRIM_TOL = False, 0.006
# 10/24 options (만두: eun is a monolid - every eun line but one was the lid margin itself, read as a crease since A8 lowered
# the search to lash edge + 0.012; min01's faint fold must not decide by line LENGTH either):
# CR_MIN_STRIP > 0 = a double eyelid shows a skin strip between the lash edge and the fold; a frame whose traced line lies
# less than this above the lash edge (80th percentile over its columns, u 0.05-0.95) is the lid margin -> no line in that
# frame. Measured (A13 settings, eye medians): monolids eun02 / eun03 / min01 one eye 0.024-0.039, creases gyu 0.076-0.078,
# chae 0.096-0.108, min01 faint fold 0.066 -> 0.05 (between 0.039 and 0.066): 14 near-frontal frames each, chae 28/28 and
# gyu 23/28 frames kept (same-place rate 0.71-1.0), eun02 L 4/14 (0.29), 0.04 left eun02 L at exactly 0.50.
# CR_TYPE "repeat" = the type comes from the near-frontal frames only (3/4 and pitch bins are kept as information; the
# chin-up bin -25..-12 showed lines on monolids woo03 / seo01 / by01): a fold is a run of columns that >= CR_REPEAT_RATE of the
# frames saw at the same place, at least CR_REPEAT_MIN x the columns long - no length / outer-side rule, so a short fold that
# shows only near one corner is kept (the 60 % / 40 % rules dropped lines shorter than 0.2-0.4 x eye width)
CR_MIN_STRIP, CR_TYPE, CR_REPEAT_RATE, CR_REPEAT_MIN = 0.0, "length", 0.5, 0.1
# 2026-10-21 (chae01, 만두: "the line was not really captured"): a FOLD line is a thin dark line with bright pretarsal skin
# between it and the lashes (eun03: valley depth 5-8 gray levels, strip recovery 0.25-0.55; gyu01: depth 37-44, recovery
# 0.2-0.4), while chae01's outer-column "valleys" (depth 35-45) are the UPPER EDGE of a shadow that stays dark all the way
# down to the lashes (recovery -0.2..0.17 = hooded-lid / orbital shadow, not a crease). A valley deeper than CR_SHADOW_DEPTH
# is accepted only if the strip between the lash edge + 0.015 and the valley - 0.015 recovers >= CR_STRIP_MIN of the depth.
CR_SHADOW_DEPTH, CR_STRIP_MIN, CR_STRIP_MIN_WIDTH = 15.0, 0.12, 0.04
# W14 P1' (2026-10-21): crease candidates from a 2-D HESSIAN RIDGE response instead of 1-D profile valleys (--crease-method
# ridge). Dark-line response = largest Hessian eigenvalue of the Gaussian-smoothed eye ROI (sigma = RIDGE_SIGMA x eye width,
# scale-normalised by sigma^2 -> gray-level units, so the seed / link thresholds 4 / 2 are shared), kept only where the line
# runs along the lid (eigenvector within RIDGE_ANGLE of the eye normal). Model-free (scipy), commercial-safe.
CR_METHOD = "profile"; RIDGE_SIGMA, RIDGE_ANGLE = 0.02, 35.0
# 2026-10-23 OPTIONS (만두: chae01's inline crease, seen from the pupil outwards, got too few points; defaults unchanged):
# CR_COLUMNS = search columns along the upper lid. 5 = the 5 inner MediaPipe upper-lid points (as before); any other N =
# N columns sampled evenly in u on the lid polyline through the 7 upper-lid points, between the same outer / inner ends,
# lash-edge offset interpolated the same way (MediaPipe cannot give more lid points; the columns only need a base line).
# CR_SHADOW_RULE False = skip strip_valid (the 10/21 shadow rule removed 126 / 209 valley candidates on chae01-gnme5 but
# 6 / 205 on gyu01-gnme5, 10/23 diagnostic).
CR_COLUMNS, CR_SHADOW_RULE = 5, True
# 2026-10-23 OPTION CR_TRACE (만두: chae01's inline crease shows from where the iris starts, the per-column search lost the
# whole stretch above the iris - no 1-D valley there, 1-15 % of columns): trace the crease as ONE curve on the 2-D ridge
# response instead of judging columns separately. Fine columns (~1.5 px) x heights (0.005 x eye width) in the search
# window; dynamic programming picks the single segment maximising sum(response - TRACE_TAU) with |dh| <= TRACE_SLOPE x du
# per column, so a weak stretch is kept only between / next to clear evidence; the segment needs >= TRACE_MIN_SEED fine
# columns with response >= CR_DEPTH_SEED and >= TRACE_MIN_LEN of the span. Heights are reported at the CR_COLUMNS columns.
CR_TRACE = False
# 10/23 OPTION CR_SPAN (만두: gyu01's in-out fold STARTS at the inner corner, measured too high): "mp" = columns between
# MediaPipe upper-lid points 2..6 (u ~0.1-0.8, default); "ends" = between points 1..7 (u ~0.05-0.9) so the start of an
# in-out fold near the inner corner and the outer tail are measured. The fold bends there, so RIDGE_ANGLE (allowed tilt of
# the line against the eye axis) can be widened with --crease-ridge-angle.
CR_SPAN = "mp"
# 10/23 "inner-ext" (만두: gyu's in-out fold continues PAST the inner corner, down toward the nose - drawn by hand on the
# search-window sheet): corners + the lid line extended beyond the inner corner (slope of its last segment) up to
# U_EXT; beyond the corner there is no lash band, so the search there may go EXT_LO below the extended line
U_EXT, EXT_LO = 1.15, -0.06
# "outer-ext" (만두 correction, 10/23: the hand-drawn continuation was at the OUTER corner (눈꼬리), not the inner one - both
# gyu and chae fold lines run on past the lateral canthus; chae's inner part is hidden in a properly open frontal view, so
# the inner extension found a false line, u 1.04): corners + the lid line extended beyond the OUTER corner (slope of its
# first segment) down to U_OUT
U_OUT, OUTER_SLOPE, OUTER_LO = -0.15, 0.0, 0.012
# 10/24 CR_CONTINUE (--crease-continue, with --crease-span corners: + extension columns CONT_U_OUT..0 every 0.02; 만두: the yellow line is right but the real fold runs on a
# little past where it stops - gyu01 to the lid extension, chae01 only slightly): the trace stays inside the corners (the
# direct trace beyond the corner followed a RISING line, 10/23) and the traced line is CONTINUED outward by its own bend - a
# quadratic over its outer CONT_WIN (eye v) - while the photo still shows a line along that path: ridge response within
# +-CONT_BAND of it >= CONT_REL x the traced line's own median response; it stops after CONT_PAT steps (0.005 u) below, or
# CONT_GAP above the lid extension. Checked on photos 10/24: gyu01 ends u -0.12 / -0.11 (만두: length right), chae01 -0.12 /
# -0.08 (the fixed stop at the lid extension made chae -0.25 / -0.20, too long)
CR_CONTINUE, CONT_WIN, CONT_REL, CONT_PAT, CONT_BAND, CONT_GAP, CONT_U_OUT = False, 0.3, 0.15, 4, 0.02, 0.02, -0.25
# 만두 10/23 (outer_ext2 sheet): the horizontal base (OUTER_SLOPE 0) is close on gyu, but chae's L tail ROSE outward ->
# TAIL_MONO: beyond the outer corner the traced height may not increase going outward (the fold tail runs flat or down)
TAIL_MONO = True
# OUTER_BASE (만두 10/23: on chae the tail still went UP): "axis" = along the corner-to-corner axis (OUTER_SLOPE x the lid
# slope added), "screen" = along the SCREEN horizontal through the outer corner - the eye axis is tilted outer-corner-up by
# 8-9 deg on chae01 (4-5 on gyu01), so an axis-straight tail rose on screen
OUTER_BASE = "screen"
# beyond the outer corner the search stays OUTER_LO above the lid line extended along its last slope (= the lash tail): with
# EXT_LO (0.06 below) the trace slid down onto the darker lash tail (line response there 10-20, as strong as the fold
# inside), drawing a tail parallel to the extension (만두: "연장 부정확"); with --crease-trim-lash the tail now ends where the
# fold meets the lash tail
TRACE_TAU, TRACE_SLOPE, TRACE_MIN_SEED, TRACE_MIN_LEN, TRACE_DH = 2.0, 0.5, 3, 0.2, 0.005
# 10/23 (만두: "some parts jump"): the first trace rode the slope limit almost everywhere (zig-zag between neighbouring
# lines). Each height step of TRACE_DH now costs TRACE_STEP_PEN (response units) so a straight continuation wins, and the
# final path is median-filtered over TRACE_MED fine columns (removes 1-2 column spikes)
TRACE_STEP_PEN, TRACE_MED = 1.0, 7
# 10/23 two-pass PRIOR (jumps that stay: a stretch detouring to a parallel line above, gyu01 front 00181 R 0.08 -> 0.13 -> 0.08
# while the other frontal frames stay at 0.08): pass 1 traces every near-frontal frame alone, the per-column median of those
# curves (frames whose mean height is > CR_FRAME_OUTLIER from the median dropped) is the prior; pass 2 subtracts
# TRACE_PRIOR_PEN x (|h - prior| - TRACE_PRIOR_TOL)+ from the response, so the trace follows the line the frames agree on.
# Only for near-frontal frames (|pitch| <= FRONT_PITCH, the prior's own window): a raised / lowered head or a 3/4 view
# changes the projected crease height, those frames are traced alone.
TRACE_PRIOR, TRACE_PRIOR_PEN, TRACE_PRIOR_TOL = {}, 60.0, 0.02
# a penalty alone did not stop the 00181 detour (the line 0.04-0.05 above is real and strong, nothing at the consensus
# height there) -> heights farther than TRACE_PRIOR_BAND from the prior are not allowed at all; the trace bridges such a
# stretch at the consensus height when clear evidence continues on the other side, else the segment ends
TRACE_PRIOR_BAND = 0.035
# 2026-10-21 (만두: ridge jumps up at some angles; chae01 closed-eye frames slipped in): a frame whose mean crease height is
# more than CR_FRAME_OUTLIER from the group median is dropped from the curve; frames whose eye opening (lid gap / eye width
# from the MediaPipe points) is below OPEN_MIN_REL x the capture median are treated as closed (prepare's blink score alone
# let closed eyes through on chae01)
CR_FRAME_OUTLIER, OPEN_MIN_REL = 0.05, 0.6   # the strip is judged only when >= 0.04 x eye width tall (~2.6 px at 65 px)
CR_DEPTH_SEED, CR_DEPTH_LINK = 4.0, 2.0                # gray-level valley depth: a chain starts at >= 4, continues at >= 2 (hysteresis)
FRONT_YAW, FRONT_PITCH, BLINK_MAX, MAX_FRONT = 12.0, 10.0, 0.35, 14
SIDE_YAW = (55.0, 95.0); HOLD_YAW = 25.0
TQ_YAW, MAX_TQ = (30.0, 60.0), 14                      # 3/4 frames: crease of the eye NEARER the camera (decision 10/20)
# PITCH BINS (2026-10-21): the crease shows at a head pitch that differs per person / camera height (gyu01: only with the
# chin UP, pitch -12..-6, 70 % of frames; chae01: better with the chin DOWN, +6..+30, 79 % vs 39 %), so besides the frontal
# window (|pitch| <= 10) every |yaw| <= 15 frame from pitch -25 to +25 is measured in 5 bins and the bin with the highest
# frame detection rate (>= 3 frames) is the third source of the crease type (frontal -> 3/4 -> best pitch bin)
PB_PITCH, PB_YAW, PB_BINS, PB_MIN_FRAMES = (-25.0, 25.0), 15.0, [(-25, -12), (-12, -6), (-6, 0), (0, 6), (6, 25)], 3
CAR_A_STEP = 3.0                                      # Lab a* above the ROI median = exposed caruncle


# ------------------------------------------------------------------ helpers
def detector():
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions
    return mp, vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_buffer=open(os.path.join(ROOT, "assets", "face_landmarker.task"), "rb").read()), num_faces=1))


def landmarks(mp, det, img, full=False):
    """468 face points (px); full=True keeps the 10 iris points 468-477 as well (10/23, overlay iris circle)"""
    import cv2
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
    if not r.face_landmarks: return None
    H, W = img.shape[:2]
    return np.array([[p.x * W, p.y * H] for p in (r.face_landmarks[0] if full else r.face_landmarks[0][:468])])


def eye_open_ratio(L, side):
    """eye opening from the landmarks: mean upper-lower lid gap over the 5 inner columns / eye width (same unit as the crease heights)"""
    fr = eye_frame(L, side)
    if fr is None: return None
    up = to_eye(L[EYE[side]["up"][1:-1]], fr)[:, 1]; lo = to_eye(L[EYE[side]["lo"][1:-1]], fr)[:, 1]
    return float(np.mean(up - lo))


def eye_frame(L, side):
    """(origin = outer corner, unit along the eye, unit 'up' in the image, eye width px); None when the eye is tiny"""
    a, b = L[EYE[side]["c"][0]], L[EYE[side]["c"][1]]; ew = float(np.linalg.norm(b - a))
    if ew < 25: return None
    t = (b - a) / ew; n = np.array([t[1], -t[0]])
    if n[1] > 0: n = -n
    return a, t, n, ew


def to_eye(P, fr):
    a, t, n, ew = fr; d = np.atleast_2d(P) - a
    return np.c_[d @ t, d @ n] / ew


def med(v, nd=3):
    v = [x for x in v if x is not None and np.isfinite(x)]
    return round(float(np.median(v)), nd) if v else None


def pct(v, q, nd=3):
    v = [x for x in v if x is not None and np.isfinite(x)]
    return round(float(np.percentile(v, q)), nd) if v else None


def poly_dist(P, Q):
    """distance of each point of P to the polyline Q (segments)"""
    out = np.full(len(P), np.inf)
    for i in range(len(Q) - 1):
        a, b = Q[i], Q[i + 1]; ab = b - a; L2 = float(ab @ ab) + 1e-12
        s = np.clip(((P - a) @ ab) / L2, 0, 1); out = np.minimum(out, np.linalg.norm(P - (a + s[:, None] * ab), axis=1))
    return out


# ------------------------------------------------------------------ 0. lid-margin edge (2026-10-20, 만두: MediaPipe lid points inaccurate)
SNAP_LO, SNAP_HI, SNAP_MAX = -0.08, 0.10, 0.10   # search window along the eye normal and the largest accepted offset (x eye width)


def lid_edge_snap(gray, L, side):
    """per upper-lid point (7): offset along the eye normal from the MediaPipe point to the lid-margin edge = upper
    half-rise of the dark lash band (see below), + = edge ABOVE the point. MediaPipe's upper-lid points sit inside the opening (chae01 / eun02 10/20: edge 0.03-0.075 above, the
    per-frame jitter 0.006-0.03 does not shrink when the face crop is upscaled 2-3x -> the detector, not the video, is
    the limit). None where no edge is found (|offset| > SNAP_MAX)."""
    fr = eye_frame(L, side)
    if fr is None: return None
    a_, t_, n_, ew = fr; DS = np.linspace(-0.06, 0.16, 56); ds = DS * ew; out = []
    for k in EYE[side]["up"]:
        prof = profile(gray, L[k], n_, ds)
        if prof is None: out.append(None); continue
        # LASH BAND (10/20 comparison on chae01 / eun02 / woo01: frame std 0.025 vs 0.041 for the max-|gradient| snap, still not
        # below MediaPipe's 0.014-0.022): darkest sample in [-0.01, 0.10] = lashes / lid margin, skin level = median 0.03-0.08
        # above it, edge = first half-rise above the dark band (sub-sample); no band (< 6 gray levels) -> None
        sm = np.convolve(prof, np.ones(3) / 3, "same")
        m = (DS >= -0.01) & (DS <= 0.10); i0 = int(np.argmax(np.where(m, -sm, -1e9))); dark = sm[i0]
        up = (DS > DS[i0] + 0.03) & (DS <= DS[i0] + 0.08)
        if up.sum() < 2: out.append(None); continue
        skin = float(np.median(sm[up]))
        if skin - dark < 6: out.append(None); continue
        half = (dark + skin) / 2; j = i0
        while j < len(sm) - 1 and sm[j] < half: j += 1
        x = DS[j - 1] + (half - sm[j - 1]) / (sm[j] - sm[j - 1]) * (DS[j] - DS[j - 1]) if (j > 0 and sm[j] != sm[j - 1]) else DS[j]
        out.append(round(float(x), 4) if abs(x) <= SNAP_MAX + 0.05 else None)
    return out


# ------------------------------------------------------------------ 1. crease curve
def profile(gray, p0, n, ds):
    pts = p0[None] + ds[:, None] * n[None]; prof = []
    for (x, y) in pts:
        xi, yi = int(round(x)), int(round(y))
        if not (2 <= xi < gray.shape[1] - 2 and 2 <= yi < gray.shape[0] - 2): return None
        prof.append(float(gray[yi - 1:yi + 2, xi - 2:xi + 3].mean()))
    return np.convolve(np.array(prof), np.ones(3) / 3, "same")


def ridge_map(gray, L, side):
    """(V, x0, y0): scale-normalised dark-line response on the eye ROI (gray levels), zero where the line is not along the lid"""
    from scipy.ndimage import gaussian_filter
    fr = eye_frame(L, side)
    if fr is None: return None
    a, t, n, ew = fr; c = (L[EYE[side]["c"][0]] + L[EYE[side]["c"][1]]) / 2
    r = int(1.0 * ew); x0, y0 = int(max(0, c[0] - r)), int(max(0, c[1] - r)); x1, y1 = int(min(gray.shape[1], c[0] + r)), int(min(gray.shape[0], c[1] + r))
    roi = gray[y0:y1, x0:x1]
    if roi.shape[0] < 16 or roi.shape[1] < 16: return None
    sg = max(1.2, RIDGE_SIGMA * ew)                                # floor 1.2 px: oblique views shrink the eye (만두 10/21)
    Hxx = gaussian_filter(roi, sg, order=(0, 2)); Hyy = gaussian_filter(roi, sg, order=(2, 0)); Hxy = gaussian_filter(roi, sg, order=(1, 1))
    tr = Hxx + Hyy; det = Hxx * Hyy - Hxy ** 2; disc = np.sqrt(np.maximum(tr ** 2 / 4 - det, 0))
    l1 = tr / 2 + disc                                             # largest eigenvalue: + across a dark line
    # eigenvector of l1: (Hxy, l1 - Hxx); the line runs perpendicular to it, so for a crease along the lid the vector ~ eye normal
    vx, vy = Hxy, l1 - Hxx; nv = np.sqrt(vx ** 2 + vy ** 2) + 1e-9; cosang = np.abs((vx * n[0] + vy * n[1]) / nv)
    V = np.where((l1 > 0) & (cosang >= np.cos(np.radians(RIDGE_ANGLE))), l1 * sg * sg, 0.0)
    return V.astype(np.float32), x0, y0


def ridge_valleys(V, x0, y0, p0, n, ds, fr, lo, hi):
    """peaks of the ridge response along the eye normal through p0 (same window / thresholds as valleys(): (height, response))"""
    out = []; pts = p0[None] + ds[:, None] * n[None]; resp = []
    for (x, y) in pts:
        xi, yi = int(round(x - x0)), int(round(y - y0))
        if not (1 <= xi < V.shape[1] - 1 and 1 <= yi < V.shape[0] - 1): return []
        resp.append(float(V[yi - 1:yi + 2, xi - 1:xi + 2].max()))
    resp = np.array(resp)
    for i in range(1, len(resp) - 1):
        if lo <= fr[i] <= hi and resp[i] >= CR_DEPTH_LINK and resp[i] > resp[i - 1] and resp[i] >= resp[i + 1]: out.append((float(fr[i]), float(resp[i])))
    return out


def valleys(prof, fr, lo, hi):
    """all clear local minima of the gray profile inside [lo, hi] (x eye width): [(height, depth)]"""
    out = []
    for i in range(1, len(prof) - 1):
        if not (lo <= fr[i] <= hi) or not (prof[i] < prof[i - 1] and prof[i] <= prof[i + 1]): continue
        a, b = max(0, i - 5), min(len(prof) - 1, i + 5)
        depth = min(prof[a:i].max(), prof[i + 1:b + 1].max()) - prof[i]
        if depth >= CR_DEPTH_LINK: out.append((float(fr[i]), float(depth)))
    return out


def link(cands):
    """cands: per column list of (height, depth). Best chain = seed from any CLEAR candidate (depth >= CR_DEPTH_SEED),
    extend to both sides taking the neighbour valley closest in height (<= CR_JUMP, one gap allowed; weak valleys
    >= CR_DEPTH_LINK may be linked but not seed). Returns heights per column (None = not linked)."""
    nc = len(cands); best = None
    for c0 in range(nc):
        for h0, d0 in cands[c0]:
            if d0 < CR_DEPTH_SEED: continue
            chain = [None] * nc; chain[c0] = h0; score = d0
            for step in (1, -1):
                ref, gap, c = h0, 0, c0 + step
                while 0 <= c < nc and gap <= 1:
                    near = [(abs(h - ref), h, d) for h, d in cands[c] if abs(h - ref) <= CR_JUMP]
                    if near:
                        _, h, d = min(near); chain[c] = h; ref = h; score += d; gap = 0
                    else: gap += 1
                    c += step
            k = sum(x is not None for x in chain)
            if k >= 2 and (best is None or (k, score) > best[0]): best = ((k, score), chain)
    return best[1] if best else [None] * nc


def strip_valid(prof, hfrac, h, edge):
    """valley at height h: True when it is a thin line (shallow) or the pretarsal strip below it is brighter again"""
    if not CR_SHADOW_RULE: return True
    sm = np.convolve(prof, np.ones(3) / 3, "same"); i = int(np.argmin(np.abs(hfrac - h))); v = sm[i]
    if (h - 0.015) - (edge + 0.015) < CR_STRIP_MIN_WIDTH: return True    # strip too thin to judge (low creases, gyu01 inner columns)
    up = sm[(hfrac > h + 0.03) & (hfrac < h + 0.08)]; strip = sm[(hfrac >= edge + 0.015) & (hfrac <= h - 0.015)]
    if len(up) < 2 or len(strip) < 2: return True                       # cannot judge: keep (old behaviour)
    depth = max(float(np.median(up)), float(np.median(strip))) - v
    if depth <= CR_SHADOW_DEPTH: return True
    return (float(np.median(strip)) - v) / depth >= CR_STRIP_MIN


STACK_PTS = {"R": [33, 133, 161, 160, 159, 158, 157], "L": [263, 362, 388, 387, 386, 385, 384]}   # corners + 5 upper-lid points


def stack_frames(names, cache, side, N):
    """names: frames of one angle group (sorted by pose); cache[n] = (L, gray). Consecutive groups of N are warped onto the
    middle frame of the group with a 3-point affine of eye `side` and averaged. -> [(gray_avg, L_ref, [frames])]"""
    import cv2
    out = []
    for i in range(0, len(names) - N + 1, N):
        grp = names[i:i + N]; ref = grp[len(grp) // 2]; Lr, gr = cache[ref]
        pts = STACK_PTS[side]; imgs = [gr.astype(np.float32)]
        for n in grp:
            if n == ref: continue
            L, g = cache[n]
            A, _ = cv2.estimateAffine2D(np.float32(L[pts]), np.float32(Lr[pts]), method=cv2.LMEDS)   # least-squares affine on 7 lid points
            if A is None: continue
            imgs.append(cv2.warpAffine(g, A, (gr.shape[1], gr.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
        out.append((np.median(np.stack(imgs), axis=0).astype(np.float32), Lr, grp))      # median: robust to one misaligned frame
    return out


def lid_line(L, side, fr):
    """(u, v) of the lid line the crease heights are measured from, sorted by u, in eye coordinates: the 7 upper-lid points,
    plus the two corners (u 0 / 1, v 0) when CR_SPAN == "corners" (10/23 bug fix: the closed loop / model reference / checks
    used the 7 points only, so beyond the outermost point the line stayed flat instead of going down to the corner and the
    photo crease came out too high there - chae01 L outer end +0.04 with --lash-ref model)"""
    uv = to_eye(L[EYE[side]["up"]], fr); uv = uv[np.argsort(uv[:, 0])]
    if CR_SPAN == "inner-ext":
        sl = (0.0 - uv[-1, 1]) / max(1.0 - uv[-1, 0], 1e-3)               # last segment (last lid point -> inner corner)
        return np.vstack([[0.0, 0.0], uv, [1.0, 0.0], [U_EXT, sl * (U_EXT - 1.0)]])
    if CR_SPAN == "outer-ext":
        # beyond the outer corner the base goes ALONG THE EYE AXIS (v 0), not down the lid's last slope: with the slope the
        # trace kept its height above a steeply falling base and drew a tail parallel to it instead of the photo's line
        # (만두 10/23, chae01 L / gyu01 L: "연장 부정확"); OUTER_SLOPE 1 = the old lid-slope extension
        sl = (uv[0, 1] - 0.0) / max(uv[0, 0] - 0.0, 1e-3) * OUTER_SLOPE
        if OUTER_BASE == "screen":
            a_, t_, n_, ew_ = fr; sl = -t_[1] / n_[1] if abs(n_[1]) > 1e-6 else 0.0          # dv/du of the screen horizontal
        return np.vstack([[U_OUT, sl * U_OUT], [0.0, 0.0], uv, [1.0, 0.0]])
    if CR_SPAN == "corners" and CR_CONTINUE:                            # 10/24: + the screen-horizontal extension past the outer corner
        a_, t_, n_, ew_ = fr; sl = -t_[1] / n_[1] if abs(n_[1]) > 1e-6 else 0.0
        return np.vstack([[CONT_U_OUT, sl * CONT_U_OUT], [0.0, 0.0], uv, [1.0, 0.0]])
    return np.vstack([[0.0, 0.0], uv, [1.0, 0.0]]) if CR_SPAN == "corners" else uv


def crease_columns(L, side, fr, snap):
    """search columns: [(u, base point px on the lid, lash-edge offset or None)], outer -> inner. CR_COLUMNS == 5: the 5 inner
    MediaPipe upper-lid points (unchanged); otherwise CR_COLUMNS points on the lid polyline through the 7 upper-lid points"""
    up = EYE[side]["up"]; snap = snap or [None] * len(up)
    if CR_COLUMNS == 5: return [(float(to_eye(L[k], fr)[0, 0]), L[k], snap[i + 1]) for i, k in enumerate(up[1:-1])]
    a, t, n, ew = fr; uv = to_eye(L[up], fr); o = np.argsort(uv[:, 0])
    if CR_SPAN in ("corners", "inner-ext", "outer-ext"):   # 10/23 (만두: the yellow line from where the fold starts to where it ends): corner
        # to corner (inner-ext: on past the inner corner), the lid line = lid_line() (through the two corners)
        us = np.linspace(U_OUT if CR_SPAN == "outer-ext" else 0.02, U_EXT if CR_SPAN == "inner-ext" else 0.98, CR_COLUMNS)
        cont_ = CR_SPAN == "corners" and CR_CONTINUE
        if cont_: us = np.r_[np.arange(CONT_U_OUT, 0.0, 0.02), us]         # 10/24: the corner-to-corner columns unchanged + extension columns
        uvc = lid_line(L, side, fr); sn_ = [snap[i] for i in np.argsort(to_eye(L[up], fr)[:, 0])]
        lead = 2 if (CR_SPAN == "outer-ext" or cont_) else 1                # points before the 7 lid points (ext, corner)
        snap = [None] * lead + sn_ + [None] * (len(uvc) - lead - len(sn_)); uv, o = uvc, np.arange(len(uvc))
    else:
        us = np.linspace(uv[1, 0], uv[-2, 0], CR_COLUMNS) if CR_SPAN == "mp" else np.linspace(uv[0, 0], uv[-1, 0], CR_COLUMNS)
    ok = [i for i in o if snap[i] is not None]
    out = []
    for u in us:
        v = float(np.interp(u, uv[o, 0], uv[o, 1])); p = a + ew * (u * t + v * n)
        e_ = float(np.interp(u, uv[ok, 0], [snap[i] for i in ok])) if (len(ok) >= 2 and 0.0 <= u <= 1.0) else None   # no lash beyond the corners
        out.append((float(u), p, e_))
    return out


def trace_prior(items):
    """items: [(gray, L)] near-frontal frames -> {side: (us, median heights (nan = none))} for TRACE_PRIOR"""
    global TRACE_PRIOR, CR_CONTINUE
    keep, TRACE_PRIOR = TRACE_PRIOR, {}; out = {}
    keep_c, CR_CONTINUE = CR_CONTINUE, False              # 10/24: the consensus is the corner-to-corner trace only (as without the option)
    try:
        for s in ("R", "L"):
            H, U = [], []
            for g, L in items:
                fr = eye_frame(L, s)
                if fr is None: continue
                h, u = crease_trace(g, L, s, fr); H.append([np.nan if x is None else x for x in h]); U.append(u)
            if len(H) < 3: continue
            A = np.array(H, float); fm = np.array([np.nanmean(r) if np.isfinite(r).any() else np.nan for r in A])
            if np.isfinite(fm).sum() >= 3: A[np.isfinite(fm) & (np.abs(fm - np.nanmedian(fm)) > CR_FRAME_OUTLIER)] = np.nan
            med = np.array([np.nanmedian(A[:, c]) if np.isfinite(A[:, c]).sum() >= max(3, 0.3 * len(A)) else np.nan for c in range(A.shape[1])])
            if np.isfinite(med).sum() >= 3: out[s] = (np.median(np.array(U), axis=0), med)
    finally:
        TRACE_PRIOR = keep; CR_CONTINUE = keep_c
    return out


def crease_trace(gray, L, side, fr, use_prior=True):
    """CR_TRACE: one crease curve traced on the ridge response (see CR_TRACE). -> (heights at the CR_COLUMNS columns, us)"""
    from scipy.ndimage import map_coordinates
    a, t, n, ew = fr
    out_cols = crease_columns(L, side, fr, None); us_out = np.array([u for u, _, _ in out_cols])
    rm = ridge_map(gray, L, side)
    if rm is None: return [None] * len(us_out), list(us_out)
    V, x0, y0 = rm
    up = EYE[side]["up"]; uv = to_eye(L[up], fr); o = np.argsort(uv[:, 0])
    snap = lid_edge_snap(gray, L, side) or [None] * len(up); ok = [i for i in o if snap[i] is not None]
    brow = to_eye(L[EYE[side]["brow_lo"]], fr); ob = np.argsort(brow[:, 0])
    us_tr = us_out[us_out >= 0.02 - 1e-9] if CR_CONTINUE else us_out           # 10/24: the trace grid = corner to corner, as before
    nf = max(len(us_tr), int(round((us_tr[-1] - us_tr[0]) * ew / 1.5)) + 1)
    uf = np.linspace(us_tr[0], us_tr[-1], nf); hs = np.arange(EXT_LO if CR_SPAN == "inner-ext" else 0.0, 0.48 + 1e-9, TRACE_DH)
    # 10/23 bug fix: the base line is lid_line() = the one the heights are turned back into positions with (crease_columns,
    # crease_model_dist); it was the 7 lid points only, flat beyond the outermost point, so with the corner spans the line
    # near the corners was traced against a higher base than it was drawn / modelled on
    ll_ = lid_line(L, side, fr); vb = np.interp(uf, ll_[:, 0], ll_[:, 1])
    base = a[None] + ew * (uf[:, None] * t[None] + vb[:, None] * n[None])               # lid line points (px)
    P = base[:, None, :] + (hs[None, :, None] * ew) * n[None, None, :]                  # (nf, nh, 2)
    R = map_coordinates(V, [P[..., 1] - y0, P[..., 0] - x0], order=1, mode="constant", cval=0.0)
    lo_f = np.zeros(len(uf))                                                               # lower bound per fine column (CR_TRIM_LASH)
    for i, u in enumerate(uf):                                                             # same window as the column search
        e_ = float(np.interp(u, uv[ok, 0], [snap[k] for k in ok])) if (len(ok) >= 2 and 0.0 <= u <= 1.0) else None   # no lash beyond the corners
        lo = ((max(CR_LO_MIN, e_ + CR_ABOVE_LASH) if CR_LO_FLOOR_EDGE else e_ + CR_ABOVE_LASH) if e_ is not None else (EXT_LO if u > 1.0 else (OUTER_LO if u < 0.0 else CR_LO)))
        hi = min(CR_HI, float(np.interp(u, brow[ob, 0], brow[ob, 1])) - CR_BROW_GAP)
        R[i, (hs < lo) | (hs > hi)] = -np.inf; lo_f[i] = lo
        if CR_CONTINUE and u < 0.02: R[i] = -np.inf                                       # traced inside the corners only
    if use_prior and side in TRACE_PRIOR:                                                  # pass 2: stay near the frames' consensus
        pu, ph = TRACE_PRIOR[side]; v_ = np.isfinite(ph)
        for i, u in enumerate(uf):
            if pu[v_].min() <= u <= pu[v_].max():
                dv = np.abs(hs - float(np.interp(u, pu[v_], ph[v_])))
                R[i] -= TRACE_PRIOR_PEN * np.maximum(dv - TRACE_PRIOR_TOL, 0.0); R[i, dv > TRACE_PRIOR_BAND] = -np.inf
    S = R - TRACE_TAU; nh = len(hs); w = max(1, int(np.ceil(TRACE_SLOPE * (uf[1] - uf[0] if nf > 1 else 0) / TRACE_DH)))
    best = np.full((nf, nh), -np.inf); back = np.full((nf, nh), -2, int)                 # back -1 = segment starts here
    best[0] = S[0]; back[0] = -1
    for i in range(1, nf):
        prev = best[i - 1]; pm_ = np.full(nh, -np.inf); arg = np.full(nh, -1)
        for d in range(-w, w + 1):                                                         # max over |dh| <= w steps
            if TAIL_MONO and d < 0 and uf[i] <= 0.0: continue                                 # tail: inward never lower = outward never higher
            sh = np.roll(prev, d) - TRACE_STEP_PEN * abs(d)
            if d > 0: sh[:d] = -np.inf
            elif d < 0: sh[d:] = -np.inf
            m = sh > pm_; pm_[m] = sh[m]; arg[m] = (np.arange(nh) - d)[m]
        cont = pm_ > 0                                                                     # continue only a positive prefix
        best[i] = np.where(cont, pm_ + S[i], S[i]); back[i] = np.where(cont, arg, -1)
    best[~np.isfinite(S)] = -np.inf
    i_end, h_end = np.unravel_index(int(np.argmax(best)), best.shape)
    heights = [None] * len(us_out)
    if not np.isfinite(best[i_end, h_end]) or best[i_end, h_end] <= 0: return heights, list(us_out)
    path = {}; i, h = i_end, h_end
    while i >= 0:
        path[i] = h; b = back[i, h]
        if b == -1: break
        h = b; i -= 1
    cols = sorted(path)
    if CR_TRIM_LASH and len(cols) > 2:                                    # 10/23: cut the end runs riding the lash line
        on = [hs[path[c]] - lo_f[c] < TRIM_TOL for c in cols]
        a_, b_ = 0, len(cols) - 1
        while a_ + 1 < b_ and on[a_] and on[a_ + 1]: a_ += 1
        while b_ - 1 > a_ and on[b_] and on[b_ - 1]: b_ -= 1
        cols = cols[a_:b_ + 1]
    resp = np.array([R[c, path[c]] for c in cols])
    if (resp >= CR_DEPTH_SEED).sum() < TRACE_MIN_SEED or (uf[cols[-1]] - uf[cols[0]]) < TRACE_MIN_LEN * (uf[-1] - uf[0]): return heights, list(us_out)
    uc = uf[cols]; hc = hs[[path[c] for c in cols]]
    if TRACE_MED > 1 and len(hc) >= TRACE_MED:
        from scipy.ndimage import median_filter
        hc = median_filter(hc, size=TRACE_MED, mode="nearest")
    for k, u in enumerate(us_out):
        if uc[0] - 1e-9 <= u <= uc[-1] + 1e-9: heights[k] = round(float(np.interp(u, uc, hc)), 4)
    if CR_CONTINUE:
        ok_ = [k for k, h_ in enumerate(heights) if h_ is not None]
        if len(ok_) >= 8:
            pu = np.array([us_out[k] for k in ok_]); pv = np.array([heights[k] for k in ok_]) + np.interp(pu, ll_[:, 0], ll_[:, 1])
            u0 = pu.min(); sel = pu <= u0 + CONT_WIN
            if sel.sum() >= 5:
                cq = np.polyfit(pu[sel], pv[sel], 2); dv_ = np.linspace(-CONT_BAND, CONT_BAND, 9)
                def resp_(uq, vq):
                    P_ = a[None] + ew * (uq * t[None] + (vq + dv_)[:, None] * n[None])
                    return float(map_coordinates(V, [P_[:, 1] - y0, P_[:, 0] - x0], order=1, mode="constant", cval=0.0).max())
                base_r = float(np.median([resp_(uq, vq) for uq, vq in zip(pu[sel], pv[sel])])); low_, end_ = 0, None
                for ue in np.arange(u0, us_out[0] - 1e-9, -0.005):
                    ve = float(np.polyval(cq, ue)); low_ = low_ + 1 if resp_(ue, ve) < CONT_REL * base_r else 0
                    if low_ >= CONT_PAT: end_ = ue + 0.005 * CONT_PAT; break
                    if ve - float(np.interp(ue, ll_[:, 0], ll_[:, 1])) <= CONT_GAP: end_ = ue; break
                end_ = us_out[0] if end_ is None else end_
                for k, u in enumerate(us_out):
                    if end_ - 1e-9 <= u < u0 - 1e-9:
                        hk = float(np.polyval(cq, u)) - float(np.interp(u, ll_[:, 0], ll_[:, 1]))
                        if hk > 0: heights[k] = round(hk, 4)
    return heights, list(us_out)


SHADE_BANDS = ((0.05, 0.35), (0.35, 0.6), (0.6, 0.9))   # outer / middle / inner stretch of the lid (u)


def crease_shade(gray, L, side, heights):
    """10/23 photometric crease cues along a detected crease (for the per-person depth, 만두: depth differs per person):
    per column [u, darkness = (skin above - crease) / skin above, shadow width = full width at half darkness (x eye width),
    strip = (pretarsal strip between lash and crease - crease) / skin above (< 0: the strip is darker than the line = shaded
    by the skin above)]. Ratios to the skin above so exposure / skin tone cancel to first order."""
    fr = eye_frame(L, side)
    if fr is None: return []
    a, t, n, ew = fr; ds = np.linspace(-0.02, 0.30, 65); out = []
    for (u, p0, _), h in zip(crease_columns(L, side, fr, None), heights):
        if h is None: continue
        prof = profile(gray, p0, n, ds * ew)
        if prof is None: continue
        i = int(np.argmin(np.abs(ds - h))); j0, j1 = max(0, i - 3), min(len(ds), i + 4); i = j0 + int(np.argmin(prof[j0:j1])); v = prof[i]
        above = prof[(ds > ds[i] + 0.04) & (ds < ds[i] + 0.10)]; below = prof[(ds > 0.0) & (ds < ds[i] - 0.02)]
        if len(above) < 2: continue
        sk = float(np.median(above)); half = v + (sk - v) / 2; l = r = i
        while l > 0 and prof[l] < half: l -= 1
        while r < len(ds) - 1 and prof[r] < half: r += 1
        out.append([float(u), (sk - v) / max(sk, 1.0), float(ds[r] - ds[l]), (float(np.median(below)) - v) / max(sk, 1.0) if len(below) >= 2 else np.nan])
    return out


def shade_summary(rows):
    """per lid stretch medians of crease_shade rows (all frames pooled)"""
    A = np.array(rows, float) if rows else np.zeros((0, 4)); out = {}
    for lo, hi in SHADE_BANDS:
        m = (A[:, 0] >= lo) & (A[:, 0] < hi) if len(A) else np.zeros(0, bool)
        out[f"u{lo:.2f}-{hi:.2f}"] = {"n": int(m.sum()), "darkness": med(A[m, 1]) if m.sum() >= 5 else None,
                                      "shadow_width_x_ew": med(A[m, 2]) if m.sum() >= 5 else None, "strip_vs_line": med(A[m, 3]) if m.sum() >= 5 else None}
    return out


def crease_frame(gray, L, side, use_prior=True):
    fr = eye_frame(L, side)
    if fr is None: return None
    if CR_TRACE: return crease_trace(gray, L, side, fr, use_prior)
    a, t, n, ew = fr; ds = np.linspace(0.02, 0.48, 47) * ew; hfrac = ds / ew
    brow = to_eye(L[EYE[side]["brow_lo"]], fr)               # (u, v) of the brow lower edge
    cols = crease_columns(L, side, fr, lid_edge_snap(gray, L, side)); cands = []
    rm = ridge_map(gray, L, side) if CR_METHOD == "ridge" else None
    for u, p0, e_ in cols:
        bv = float(np.interp(u, brow[np.argsort(brow[:, 0]), 0], brow[np.argsort(brow[:, 0]), 1]))
        hi = min(CR_HI, bv - CR_BROW_GAP)
        lo = ((max(CR_LO_MIN, e_ + CR_ABOVE_LASH) if CR_LO_FLOOR_EDGE else e_ + CR_ABOVE_LASH) if e_ is not None else (EXT_LO if u > 1.0 else (OUTER_LO if u < 0.0 else CR_LO)))
        prof = profile(gray, p0, n, ds)
        if prof is None or hi - lo < 0.05: vs = []
        elif rm is not None: vs = ridge_valleys(rm[0], rm[1], rm[2], p0, n, ds, hfrac, lo, hi)
        else: vs = valleys(prof, hfrac, lo, hi)
        cands.append([(h_, d_) for h_, d_ in vs if prof is not None and strip_valid(prof, hfrac, h_, e_ if e_ is not None else 0.03)])
    return link(cands), [u for u, _, _ in cols]


def strip_width(heights, us, sn, lid_u):
    """CR_MIN_STRIP: how far the traced line lies above the lash edge - 80th percentile of (line - edge) over the detected
    columns u 0.05-0.95 (edge interpolated between the 7 upper-lid points by u). None when < 5 columns or < 3 edges."""
    ok = sorted((u, e) for u, e in zip(lid_u, sn) if e is not None)
    g = [h - float(np.interp(u, *zip(*ok))) for u, h in zip(us, heights) if h is not None and 0.05 <= u <= 0.95] if len(ok) >= 3 else []
    return round(float(np.percentile(g, 80)), 4) if len(g) >= 5 else None


def strip_check(c, gray, L, s):
    """-> (c with the line removed when it is the lid margin, lash edge offsets, strip width or None)"""
    sn = lid_edge_snap(gray, L, s)
    if CR_MIN_STRIP <= 0: return c, sn, None
    fe_ = eye_frame(L, s); sw = strip_width(c[0], c[1], sn, to_eye(L[EYE[s]["up"]], fe_)[:, 0]) if fe_ is not None else None
    if sw is not None and sw < CR_MIN_STRIP: c = ([None] * len(c[0]),) + tuple(c[1:])
    return c, sn, sw


def contiguous(flags, k=3):
    run = 0
    for f in flags:
        run = run + 1 if f else 0
        if run >= k: return True
    return False


def crease_summary(rows, us):
    """rows: list of per-frame height lists (5 columns). -> per-eye summary + type. Frames whose mean height is more than
    CR_FRAME_OUTLIER from the median of the detected frames are dropped (reported as outlier_frames)."""
    N = len(rows)
    if N == 0: return {"frames": 0, "type": "uncertain", "type_ko": "불확실 (정면 프레임 없음)"}
    A = np.array([[np.nan if h is None else h for h in r] for r in rows], float)
    c0_ = int((np.median(np.array(us), axis=0) < 0).sum()) if us else 0          # 10/24: extension columns (CR_CONTINUE) in front
    fm = np.array([np.nanmean(r[c0_:]) if np.isfinite(r[c0_:]).any() else np.nan for r in A])
    n_out = 0
    if np.isfinite(fm).sum() >= 3:
        med_ = float(np.nanmedian(fm)); out_ = np.isfinite(fm) & (np.abs(fm - med_) > CR_FRAME_OUTLIER); n_out = int(out_.sum())
        if n_out: A[out_] = np.nan; rows = [[None] * A.shape[1] if o else r for r, o in zip(rows, out_)]
    rate = [round(float(np.isfinite(A[:, c]).mean()), 2) for c in range(A.shape[1])]
    # 10/24: the type decision uses the corner-to-corner columns only (CR_CONTINUE adds extension columns at u < 0 in front)
    # 5 columns: 3 contiguous / 2 edge columns as before; N columns (CR_COLUMNS option): the same fractions (60 % / 40 %)
    nc = A.shape[1] - c0_; kc = 3 if nc == 5 else max(3, int(round(0.6 * nc))); ne = 2 if nc == 5 else max(2, int(round(0.4 * nc)))
    frame_det = [contiguous([h is not None for h in r[c0_:]], kc) for r in rows]
    curve = [med(A[np.isfinite(A[:, c]), c]) if np.isfinite(A[:, c]).sum() >= max(2, 0.25 * N) else None for c in range(A.shape[1])]
    allh = A[np.isfinite(A)]
    fd = 100 * sum(frame_det) / N
    rate_c = rate[c0_:]
    if np.mean(rate_c[:ne]) >= 0.5 and np.mean(rate_c[-ne:]) < 0.25:               # outer columns found, inner not: tapered fold
        typ, ko = "inner_candidate", "속쌍꺼풀 후보 (바깥쪽 컬럼만 검출, 안쪽은 접힘선이 속눈썹선에 붙음)"
    elif fd >= 50 and contiguous([h is not None for h in curve[c0_:]], kc):
        typ, ko = "outer", "겉쌍꺼풀"
    elif max(rate) < 0.25:
        typ, ko = "uncertain", "불확실 (접힘선 미검출: 없거나 영상에서 안 보임)"
    else:
        typ, ko = "uncertain", "불확실 (일부 컬럼·프레임에서만 검출)"
    rep_ = None
    if CR_TYPE == "repeat":
        run_ = best_ = 0
        for r_ in rate_c: run_ = run_ + 1 if r_ >= CR_REPEAT_RATE else 0; best_ = max(best_, run_)
        rep_ = {"run_columns": best_, "run_x_columns": round(best_ / max(nc, 1), 3), "type_length_rule": typ}
        typ, ko = (("outer", f"쌍꺼풀 (같은 자리 반복 검출, 이어진 칸 {best_}/{nc})") if best_ >= max(3, CR_REPEAT_MIN * nc)
                   else ("uncertain", "불확실 (같은 자리에서 반복 검출 안 됨)"))
    ends_ =[(min(u_ for u_, h_ in zip(uu, r) if h_ is not None), max(u_ for u_, h_ in zip(uu, r) if h_ is not None))
             for r, uu in zip(rows, us or []) if any(h_ is not None for h_ in r)]                   # 10/23: where the line starts / ends
    return {"line_start_u": med([e_[0] for e_ in ends_]), "line_end_u": med([e_[1] for e_ in ends_]),
            "frames": N, "outlier_frames": n_out, "frame_detected_pct": round(fd, 1), "column_rate_outer_to_inner": rate,
            "column_u_outer_to_inner": [round(u, 2) for u in np.median(np.array(us), axis=0)] if us else None,
            "curve_height_x_eye_width": curve, "crease_height_x_eye_width": med(allh),
            "spread_p25_p75": [pct(allh, 25), pct(allh, 75)] if len(allh) >= 4 else None,
            "columns_detected_pct": round(100 * float(np.isfinite(A).mean()), 1), "type": typ, "type_ko": ko,
            **({"repeat_rule": rep_} if rep_ else {})}


# ------------------------------------------------------------------ 3. caruncle
def caruncle_frame(img, L, side):
    import cv2
    fr = eye_frame(L, side)
    if fr is None: return None
    a, t, n, ew = fr; c = L[EYE[side]["c"][1]]; r = 0.125 * ew
    x0, y0, x1, y1 = int(c[0] - r), int(c[1] - r), int(c[0] + r) + 1, int(c[1] + r) + 1
    H, W = img.shape[:2]
    if x0 < 0 or y0 < 0 or x1 > W or y1 > H or x1 - x0 < 8: return None
    roi = img[y0:y1, x0:x1]; astar = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)[..., 1].astype(np.float32)
    # the caruncle is a few % of the ROI, so Otsu (balanced classes) fails on a 3 Mbps video; the region is what is
    # clearly pinker than the ROI's skin-dominated median (Lab a* step CAR_A_STEP, a fixed colour step, not per person)
    base = float(np.median(astar))
    if float(np.percentile(astar, 99)) - base < CAR_A_STEP: return {"exposed_width": 0.0, "edge": None, "overhang": None, "weak": True}
    reg = (astar >= base + CAR_A_STEP).astype(np.uint8)
    poly = np.round(np.vstack([L[[EYE[side]["c"][0]]], L[EYE[side]["up"]], L[[EYE[side]["c"][1]]], L[EYE[side]["lo"]][::-1]]) - [x0, y0]).astype(np.int32)
    opening = np.zeros_like(reg); cv2.fillPoly(opening, [poly], 1)
    k = max(1, int(round(0.03 * ew))); opening = cv2.dilate(opening, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    nb, lab, st, _ = cv2.connectedComponentsWithStats(reg)
    keep = np.zeros_like(reg)
    for j in range(1, nb):
        if ((lab == j) & (opening > 0)).any() and st[j, cv2.CC_STAT_AREA] >= (0.02 * ew) ** 2: keep[lab == j] = 1
    if keep.sum() == 0: return {"exposed_width": 0.0, "edge": None, "overhang": None, "weak": False}
    ys, xs = np.nonzero(keep); uv = to_eye(np.c_[xs + x0, ys + y0].astype(float), fr)
    edge = []
    for v in (-0.06, -0.03, 0.0, 0.03, 0.06):
        m = np.abs(uv[:, 1] - v) <= 0.012
        edge.append(round(float(uv[m, 0].max()), 3) if m.any() else None)
    return {"exposed_width": float(uv[:, 0].max() - uv[:, 0].min()), "edge": edge, "overhang": float(1.0 - uv[:, 0].max()), "weak": False}


# ------------------------------------------------------------------ 5. crease-line distance (E2)
def crease_model_dist(P2, L, side, heights, us, verts, corners=None):
    """model crease-line vertices (projected px, P2) vs this frame's photo crease curve (heights per column at us,
    both in the photo's eye-width frame): (median |dv|, median signed dv = model - photo, points, |dv| and signed dv
    after a similarity on the two eye corners = shape only, as lid_curves does) or None. corners: model corner px (2, 2)"""
    fr = eye_frame(L, side)
    if fr is None or len(verts) == 0: return None
    pts = [(u, h) for u, h in zip(us, heights) if h is not None]
    if len(pts) < 2: return None
    uu, hh = zip(*pts)
    lash = lid_line(L, side, fr)                                          # same base line as the measurement (10/23)
    photo_v = lambda u: np.interp(u, lash[:, 0], lash[:, 1]) + np.interp(u, uu, hh)     # photo crease v at u
    m = to_eye(P2[verts], fr)

    def dist(mm):
        sel = (mm[:, 0] >= min(uu) - 0.05) & (mm[:, 0] <= max(uu) + 0.05)
        if sel.sum() < 3: return None
        dv = mm[sel, 1] - photo_v(mm[sel, 0]); return float(np.median(np.abs(dv))), float(np.median(dv)), int(sel.sum())
    d = dist(m)
    if d is None: return None
    al = (None, None)
    if corners is not None:
        mc = to_eye(corners, fr); w = (mc[1, 0] - mc[0, 0]) + 1j * (mc[1, 1] - mc[0, 1])      # photo corners are (0,0) -> (1,0)
        if abs(w) > 1e-9:
            r_ = 1.0 / w; mz = ((m[:, 0] - mc[0, 0]) + 1j * (m[:, 1] - mc[0, 1])) * r_
            d2 = dist(np.c_[mz.real, mz.imag]); al = (d2[0], d2[1]) if d2 else (None, None)
    return d[0], d[1], d[2], al[0], al[1]


def frame_yaws(V, lid, poses, prep):
    """per-frame [yaw, pitch] of the camera about the head (view_coverage.coverage without report.json / the file):
    sign aligned with MediaPipe's yaw where both exist"""
    from view_coverage import head_axes
    c, x, up, fw = head_axes(V[lid]); rows = {}
    for n, r in poses.items():
        R = np.asarray(r["R"]); t = np.asarray(r["t"]); cc = -R.T @ t; d = cc - c; d /= np.linalg.norm(d)
        rows[n] = [float(np.degrees(np.arctan2(d @ x, d @ fw))), float(np.degrees(np.arcsin(np.clip(d @ up, -1, 1))))]
    both = np.array([(rows[n][0], prep[n]["yaw"]) for n in rows if n in prep and prep[n].get("yaw") is not None])
    if len(both) >= 5 and np.corrcoef(both[:, 0], both[:, 1])[0, 1] < 0:
        for n in rows: rows[n][0] *= -1
    return rows


# ------------------------------------------------------------------ main
def measure(W, mesh=None, fit_json=None, out_path=None, tag=None, eye_parts=None, sparse=None, debug=False, stack=0):
    """all measurements for work dir W on the chosen fit (default) or on an explicit mesh (+ its fit json).
    out_path default: model/parts_v1.json, or model/parts_v1_<tag>.json when a tag is given. Returns the dict."""
    import cv2, meshio, pycolmap
    from scipy.spatial import cKDTree
    from frame_check import intrinsics
    from gnm_model import GNM, template_map
    T0 = time.time(); tm = {}
    M = os.path.join(W, "model")
    if mesh is None:
        rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8")); ch = rep.get("chosen", "gnm")
        mesh = os.path.join(M, f"fit_{ch}.ply"); fit_json = fit_json or os.path.join(M, f"fit_{ch}.fit.json")
    else:
        ch = tag or os.path.splitext(os.path.basename(mesh))[0].replace("fit_", "")
        fit_json = fit_json or mesh.replace(".ply", ".fit.json")
    out_path = out_path or os.path.join(M, f"parts_v1_{tag}.json" if tag else "parts_v1.json")
    V = np.asarray(meshio.read_any(mesh)["vertices"], np.float64)
    lid = np.array(json.load(open(fit_json))["landmark_vertex_ids"])
    t = np.load(os.path.join(ROOT, "assets", "gnm-template-v2.npz")); F = t["triangles"].astype(np.int64); mat = t["materials"]
    poses = {k: v for k, v in json.load(open(os.path.join(M, "frame_poses.json")))["frames"].items() if v["status"] != "dropped"}
    prep = {x["file"]: x for x in json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8"))["images"]}
    vcf = os.path.join(M, "view_coverage.json")
    vc = json.load(open(vcf)).get("per_frame", {}) if os.path.exists(vcf) else frame_yaws(V, lid, poses, prep)
    hold = set(open(os.path.join(M, "holdout.txt")).read().split()) if os.path.exists(os.path.join(M, "holdout.txt")) else set()
    eo = json.load(open(os.path.join(M, "eyelid_offset.json"))).get("offset", {}) if os.path.exists(os.path.join(M, "eyelid_offset.json")) else {}
    rec = pycolmap.Reconstruction(sparse or os.path.join(W, "colmap", "sparse_lens_anchored")); f, cx, cy = intrinsics(list(rec.cameras.values())[0])
    images = os.path.join(W, "prep", "images"); iod = float(np.linalg.norm(V[lid[33]] - V[lid[263]]))
    proj = lambda X, R, tt: (lambda Q: np.c_[f * Q[:, 0] / Q[:, 2] + cx, f * Q[:, 1] / Q[:, 2] + cy, Q[:, 2]])(X @ np.asarray(R).T + np.asarray(tt))
    G = GNM(); o2g = template_map()[0]; grp = lambda *ns: np.max([(G.groups[G.group_names.index(n)] > 0.3)[o2g] for n in ns], axis=0)
    out = {"source": os.path.basename(os.path.normpath(W)), "chosen": ch, "mesh": os.path.basename(mesh), "version": "v1", "holdout_frames": len(hold), "crease_method": CR_METHOD,
           "units": "x eye width (outer-inner corner of the same eye) unless marked % IOD; no per-person constants"}
    cl_verts = {}
    if eye_parts and os.path.exists(eye_parts):
        ep = json.load(open(eye_parts, encoding="utf-8")); cl_verts = {s: np.array(v, np.int64) for s, v in (ep.get("crease_line_vertices") or {}).items()}
    cl = {"R": {"train": [], "hold": []}, "L": {"train": [], "hold": []}}
    a = argparse.Namespace(debug=debug); cache = {}                       # frame -> (landmarks, gray) for --stack
    mp, det = detector()
    ok = lambda n: n in poses and n not in hold
    front = [n for n, x in prep.items() if ok(n) and x.get("yaw") is not None and abs(x["yaw"]) <= FRONT_YAW
             and abs(x.get("pitch") or 99) <= FRONT_PITCH and (x.get("blink") is None or x["blink"] < BLINK_MAX)]
    front = sorted(front, key=lambda n: abs(prep[n]["yaw"]))[:MAX_FRONT * 2]
    # closed-eye filter on the landmarks (both eyes): opening < OPEN_MIN_REL x capture median -> dropped (chae01 10/21)
    Lcache = {}
    def lm_of(n):
        if n not in Lcache: Lcache[n] = landmarks(mp, det, cv2.imread(os.path.join(images, n)))
        return Lcache[n]
    pool = [n for n, x in prep.items() if ok(n) and x.get("yaw") is not None and abs(x["yaw"]) <= PB_YAW]
    opens = {}
    for n in pool:
        L_ = lm_of(n)
        if L_ is None: continue
        o = [eye_open_ratio(L_, s_) for s_ in ("R", "L")]; o = [v for v in o if v is not None]
        if o: opens[n] = float(np.mean(o))
    open_med = float(np.median(list(opens.values()))) if opens else None
    closed = {n for n, v in opens.items() if open_med is not None and v < OPEN_MIN_REL * open_med}
    front = [n for n in front if n not in closed]
    if CR_OPEN_TOL > 0 and open_med:                                       # 10/23 option: alike eye opening only
        front = [n for n in front if n in opens and abs(opens[n] / open_med - 1) <= CR_OPEN_TOL] or front
        out["crease_open_tol"] = CR_OPEN_TOL
    front = front[:MAX_FRONT]
    global TRACE_PRIOR
    TRACE_PRIOR = {}
    if CR_TRACE:                                                          # two-pass trace: prior from the frontal frames (10/23)
        items = [(cv2.cvtColor(cv2.imread(os.path.join(images, n)), cv2.COLOR_BGR2GRAY).astype(np.float32), lm_of(n)) for n in front if lm_of(n) is not None]
        TRACE_PRIOR = trace_prior(items); out["trace_prior_sides"] = sorted(TRACE_PRIOR)
    # ---- 1 + 3: near-frontal frames (one landmark pass for both)
    t0 = time.time(); cr = {"R": [], "L": []}; cu = {"R": [], "L": []}; car = {"R": [], "L": []}; dbg = None; fdet = {}; snap = {"R": [], "L": []}
    shade = {"R": [], "L": []}                                            # CR_TRACE: photometric crease cues (10/23)
    lidu = {"R": [], "L": []}                                             # u of the 7 upper-lid points per frame (10/23)
    for n in front:
        img = cv2.imread(os.path.join(images, n)); L = lm_of(n)
        if L is None: continue
        fdet[n] = {}
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        if stack: cache[n] = (L, gray)
        P2 = proj(V, poses[n]["R"], poses[n]["t"])[:, :2] if cl_verts else None
        for s in ("R", "L"):
            c = crease_frame(gray, L, s)
            if c is not None:
                c, sn, sw = strip_check(c, gray, L, s)
                cr[s].append(c[0]); cu[s].append(c[1])
                if CR_TRACE: shade[s] += crease_shade(gray, L, s, c[0])
                fe_ = eye_frame(L, s)
                if fe_ is not None: lidu[s].append(to_eye(L[EYE[s]["up"]], fe_)[:, 0])
                ids_ = [EYE[s]["c"][0]] + EYE[s]["up"] + [EYE[s]["c"][1]]
                snap[s].append(sn)
                fdet[n][s] = {"lid_px": np.round(L[ids_], 2).tolist(), "lid_ids": ids_, "crease_heights": c[0], "column_u": [round(x, 3) for x in c[1]],
                              "lid_edge_offset": sn, **({"strip": sw} if CR_MIN_STRIP > 0 else {})}
                if P2 is not None and s in cl_verts:
                    d_ = crease_model_dist(P2, L, s, c[0], c[1], cl_verts[s], P2[lid[list(EYE[s]["c"])]])
                    if d_ is not None: cl[s]["train"].append(d_)
            k = caruncle_frame(img, L, s)
            if k is not None: car[s].append(k)
        if a.debug and dbg is None:
            dbg = img.copy()
            for s in ("R", "L"):
                fr = eye_frame(L, s)
                if fr is None or not cr[s]: continue
                a_, t_, n_, ew = fr
                for (_, p0, _), h in zip(crease_columns(L, s, fr, None), cr[s][-1]):
                    if h is not None: p = p0 + h * ew * n_; cv2.circle(dbg, (int(p[0]), int(p[1])), 3, (0, 0, 255), -1)
                cv2.line(dbg, tuple(L[EYE[s]["c"][0]].astype(int)), tuple(L[EYE[s]["c"][1]].astype(int)), (0, 255, 0), 1)
            ys = [L[k][1] for k in (10, 152)]; cv2.imwrite(os.path.join(M, "parts_v1_debug_crease.jpg"), dbg[int(L[9][1] - 60):int(L[1][1]), :])
    # ---- 1b. 3/4 frames: the nearer eye only
    tq = [n for n, x in prep.items() if ok(n) and x.get("yaw") is not None and TQ_YAW[0] <= abs(x["yaw"]) <= TQ_YAW[1]
          and (x.get("blink") is None or x["blink"] < BLINK_MAX)]
    tq = sorted([n for n in tq if n not in closed], key=lambda n: abs(abs(prep[n]["yaw"]) - 45))[:MAX_TQ]
    cr_tq = {"R": [], "L": []}; cu_tq = {"R": [], "L": []}
    for n in tq:
        img = cv2.imread(os.path.join(images, n)); L = lm_of(n)
        if L is None: continue
        frs = {s_: eye_frame(L, s_) for s_ in ("R", "L")}
        if any(v is None for v in frs.values()): continue
        near = max(("R", "L"), key=lambda s_: frs[s_][3])                      # larger projected eye width = nearer
        c = crease_frame(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), L, near, use_prior=False)
        if c is not None:
            cr_tq[near].append(c[0]); cu_tq[near].append(c[1])
            if n in poses:          # 3/4 observation of the near eye for the multi-angle closed loop (eye_parts_fit --depth-search)
                ids_ = [EYE[near]["c"][0]] + EYE[near]["up"] + [EYE[near]["c"][1]]
                fdet.setdefault(n, {})[near] = {"lid_px": np.round(L[ids_], 2).tolist(), "lid_ids": ids_, "crease_heights": c[0], "column_u": [round(x, 3) for x in c[1]],
                                               "pose": "three_quarter", "yaw": round(prep[n]["yaw"], 1)}
    de = {"method": "dark valleys 0.10-0.40 x eye width above the upper-lid points (window ends 0.08 under the brow), "
                    "linked across the 5 columns (jump <= 0.06, one gap; depth >= 4 seeds, >= 2 links), near-frontal frames without holdout / blink >= 0.35",
          "model_crease": None, "model": "no crease in the current model (GNM mean lid)"}
    # ---- 1c. pitch bins: every |yaw| <= 15 frame from pitch -25..+25 (frontal window frames included), both eyes
    pb = [n for n, x in prep.items() if ok(n) and x.get("yaw") is not None and x.get("pitch") is not None and abs(x["yaw"]) <= PB_YAW
          and PB_PITCH[0] <= x["pitch"] <= PB_PITCH[1] and (x.get("blink") is None or x["blink"] < BLINK_MAX) and n not in closed]
    cr_pb = {s: {b: [] for b in range(len(PB_BINS))} for s in ("R", "L")}; cu_pb = {s: {b: [] for b in range(len(PB_BINS))} for s in ("R", "L")}; pb_bin = {}
    for n in pb:
        bi = next((k for k, (lo, hi) in enumerate(PB_BINS) if lo <= prep[n]["pitch"] < hi), None)
        if bi is None: continue
        img = cv2.imread(os.path.join(images, n)); L = lm_of(n)
        if L is None: continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32); fdet.setdefault(n, {})
        if stack: cache[n] = (L, gray); pb_bin.setdefault(bi, []).append(n)
        for s in ("R", "L"):
            c = crease_frame(gray, L, s, use_prior=abs(prep[n]["pitch"]) <= FRONT_PITCH)   # trace prior: frontal pitch only (10/23)
            if c is not None:
                c, sn, sw = strip_check(c, gray, L, s)
                cr_pb[s][bi].append(c[0]); cu_pb[s][bi].append(c[1])
                if s not in fdet[n]:
                    ids_ = [EYE[s]["c"][0]] + EYE[s]["up"] + [EYE[s]["c"][1]]
                    fdet[n][s] = {"lid_px": np.round(L[ids_], 2).tolist(), "lid_ids": ids_, "crease_heights": c[0], "column_u": [round(x, 3) for x in c[1]],
                                  "lid_edge_offset": sn, "pose": f"pitch_bin_{bi}", "pitch": round(prep[n]["pitch"], 1), **({"strip": sw} if CR_MIN_STRIP > 0 else {})}
    de["method_three_quarter"] = "same search on the eye nearer the camera in |yaw| 30-60 frames (holdout / blink excluded); "                                  "final type = frontal if decided, else 3/4 if decided, else best pitch bin if decided, else uncertain"
    de["method_pitch_bins"] = f"same search on both eyes in |yaw| <= {PB_YAW} frames binned by head pitch {PB_BINS}; the bin with the highest frame detection rate (>= {PB_MIN_FRAMES} frames) is the third source"
    for s in ("R", "L"):
        fr_ = crease_summary(cr[s], cu[s]); tq_ = crease_summary(cr_tq[s], cu_tq[s])
        bins_ = []
        for bi, (lo, hi) in enumerate(PB_BINS):
            sm = crease_summary(cr_pb[s][bi], cu_pb[s][bi]); sm["pitch_range"] = [lo, hi]; bins_.append(sm)
        cand = [b for b in bins_ if b["frames"] >= PB_MIN_FRAMES]
        best = max(cand, key=lambda b: (b.get("frame_detected_pct") or 0, b.get("columns_detected_pct") or 0)) if cand else None
        fr_["type_frontal"] = fr_["type"]; fr_["type_frontal_ko"] = fr_["type_ko"]
        if fr_["type"] != "uncertain" or CR_TYPE == "repeat": src = "frontal"    # repeat: frontal frames decide alone (10/24)
        elif tq_["type"] != "uncertain": src = "three_quarter"; fr_["type"], fr_["type_ko"] = tq_["type"], tq_["type_ko"] + " [3/4 프레임]"
        elif best is not None and best["type"] != "uncertain": src = "pitch_bin"; fr_["type"], fr_["type_ko"] = best["type"], best["type_ko"] + f" [상하 {best['pitch_range']} 프레임]"
        else: src = "frontal+three_quarter+pitch_bins"
        fr_["type_source"] = src
        srcd = {"three_quarter": tq_, "pitch_bin": best}.get(src, fr_)
        curve = srcd.get("curve_height_x_eye_width"); us_ = srcd.get("column_u_outer_to_inner")
        if src in ("three_quarter", "pitch_bin"):     # the fit reads these fields: take them from the deciding source
            fr_["curve_height_x_eye_width"] = curve; fr_["column_u_outer_to_inner"] = us_; fr_["crease_height_x_eye_width"] = srcd.get("crease_height_x_eye_width")
        fr_["pitch_bins"] = [{k: b.get(k) for k in ("pitch_range", "frames", "frame_detected_pct", "column_rate_outer_to_inner", "curve_height_x_eye_width", "type")} for b in bins_]
        fr_["best_pitch_bin"] = best["pitch_range"] if best else None
        det_u = [u for u, h in zip(us_ or [], curve or []) if h is not None]
        fr_["taper_u_innermost_detected"] = max(det_u) if det_u else None    # where the fold line still shows (1 = inner corner)
        fr_["three_quarter"] = tq_
        if CR_TRACE: fr_["crease_shade"] = shade_summary(shade[s])
        # lid-margin edge offsets (7 upper-lid points) and the crease curve re-expressed from that edge (5 inner columns)
        SN = np.array([[np.nan if v is None else v for v in r] for r in snap[s]], float) if snap[s] else np.zeros((0, 7))
        fr_["lid_edge_offset_x_eye_width"] = [med(SN[:, k]) if len(SN) and np.isfinite(SN[:, k]).sum() >= 3 else None for k in range(7)]
        fr_["lid_edge_offset_median"] = med(SN[np.isfinite(SN)]) if len(SN) else None
        fr_["lid_edge_offset_frame_std"] = round(float(np.nanstd(SN, 0).mean()), 4) if len(SN) >= 3 else None
        cur_ = fr_.get("curve_height_x_eye_width") or []
        eo_ = fr_["lid_edge_offset_x_eye_width"]
        fr_["lid_point_u"] = [round(float(x), 3) for x in np.median(np.array(lidu[s]), axis=0)] if lidu[s] else None
        if len(cur_) != 5 and len(cur_) > 1:                     # CR_COLUMNS option: edge offset of the 7 lid points interpolated by u (10/23)
            ok_ = [k for k in range(7) if eo_[k] is not None]; lu_ = fr_["lid_point_u"]; cu_ = fr_.get("column_u_outer_to_inner") or []
            eo_ = [None] + ([float(np.interp(cu_[j], [lu_[k] for k in ok_], [eo_[k] for k in ok_])) for j in range(len(cur_))] if (len(ok_) >= 2 and lu_ and len(cu_) == len(cur_)) else [None] * len(cur_))
        fr_["curve_height_from_edge_x_eye_width"] = [None if (h is None or eo_[k + 1] is None) else round(h - eo_[k + 1], 3)
                                                     for k, h in enumerate(cur_)] if src != "three_quarter" else None
        de[NAME[s]] = fr_
    de["frame_detail"] = fdet          # per frontal frame: photo lid points (px) + crease heights, for the E2 closed-loop fit
    de["closed_eye_frames_dropped"] = sorted(closed); de["eye_open_median"] = round(open_med, 3) if open_med else None
    out["double_eyelid"] = de; out["three_quarter_frames"] = len(tq); out["pitch_bin_frames"] = len(pb)
    if stack and cache:
        t1 = time.time()
        groups = {"frontal": [n for n in front if n in cache]}
        key = lambda n: (round((prep[n].get("blink") or 0) / 0.05), prep[n]["pitch"], prep[n]["yaw"])   # alike openness, then pitch
        for bi, ns in pb_bin.items(): groups[f"bin_{bi}"] = sorted(ns, key=key)
        groups["frontal"] = sorted(groups["frontal"], key=key)
        dst = {"method": f"frames of one angle group aligned by a 3-point eye affine (corners + upper-lid middle) and averaged {stack} at a time, "
                         "then the same crease rules on the averaged image with the reference frame's landmarks", "stack": stack}
        for s in ("R", "L"):
            res = {}
            for gname, ns in groups.items():
                st = stack_frames(ns, cache, s, stack); hs_ = []; us_ = []
                for g_avg, Lr, _grp in st:                     # (not `grp`: that is the GNM-group lambda above)
                    c = crease_frame(g_avg, Lr, s, use_prior=gname == "frontal")
                    if c is not None: hs_.append(c[0]); us_.append(c[1])
                sm = crease_summary(hs_, us_); sm["stacks"] = len(st); sm["frames_in_group"] = len(ns); res[gname] = sm
            fr_ = res["frontal"]; bins_ = [res[f"bin_{bi}"] for bi in sorted(pb_bin)]
            cand = [b for b in bins_ if b["frames"] >= 2]
            best = max(cand, key=lambda b: (b.get("frame_detected_pct") or 0, b.get("columns_detected_pct") or 0)) if cand else None
            # stacks only make sense inside ONE pitch bin (the frontal window spans -10..+10 and mixes frames where the fold
            # shows with frames where it does not: gyu01 frontal stacks 50 -> 0 %, best bin 70 -> 100 %), so the best bin decides
            # first and the frontal stack is the fallback
            typ, src = (best["type"], "pitch_bin") if best is not None and best["type"] != "uncertain" else (fr_["type"], "frontal")
            srcd = best if src == "pitch_bin" else fr_
            dst[NAME[s]] = {"type": typ, "type_source": src, "frontal": fr_, "pitch_bins": {f"bin_{bi}": res[f"bin_{bi}"] for bi in sorted(pb_bin)},
                            "curve_height_x_eye_width": srcd.get("curve_height_x_eye_width"), "column_u_outer_to_inner": srcd.get("column_u_outer_to_inner"),
                            "crease_height_x_eye_width": srcd.get("crease_height_x_eye_width")}
        out["double_eyelid_stacked"] = dst; tm["stack_sec"] = round(time.time() - t1, 1)
    ca = {"method": "Lab a* >= ROI median + 3 in a 0.25 x 0.25 eye-width ROI at the inner corner, region touching the eye opening; "
                    "exposed width / eye width, covering edge = nasal limit per row (v = -0.06..0.06), overhang past MediaPipe inner corner"}
    for s in ("R", "L"):
        rows = car[s]; ok_ = [r for r in rows if not r["weak"]]
        edges = [r["edge"] for r in ok_ if r["edge"]]
        ca[NAME[s]] = {"frames": len(rows), "weak_signal_frames": sum(r["weak"] for r in rows),
                       "exposed_width_x_eye_width": med([r["exposed_width"] for r in rows]),
                       "exposed_width_p25_p75": [pct([r["exposed_width"] for r in rows], 25), pct([r["exposed_width"] for r in rows], 75)] if len(rows) >= 4 else None,
                       "covered_frames_pct": round(100 * sum(r["exposed_width"] < 0.02 for r in rows) / len(rows), 1) if rows else None,
                       "fold_overhang_x_eye_width": med([r["overhang"] for r in ok_ if r["overhang"] is not None]),
                       "covering_edge_u_at_v": [med([e[i] for e in edges if e[i] is not None]) for i in range(5)] if edges else None,
                       "edge_v": [-0.06, -0.03, 0.0, 0.03, 0.06]}
    out["caruncle"] = ca; tm["frontal_sec"] = round(time.time() - t0, 1); out["frontal_frames"] = len(front)
    # ---- 2. side profile against the face-skin class border
    t0 = time.time()
    band = grp("left_orbital_region", "right_orbital_region", "left_brow_region", "right_brow_region"); bandv = np.where(band)[0]
    skin_tri = F[(mat[F] == 0).all(1)]
    side = [n for n in poses if ok(n) and n in vc and SIDE_YAW[0] <= abs(vc[n][0]) <= SIDE_YAW[1]]
    prof_rows = {"left": [], "right": []}; nskip = {"no_mask": 0, "no_edge": 0}
    cmdir = os.path.join(W, "prep", "class_masks_v3")
    for n in side:
        cls = cv2.imread(os.path.join(cmdir, n + ".png"), 0)
        if cls is None: nskip["no_mask"] += 1; continue
        R, tt = poses[n]["R"], poses[n]["t"]; P = proj(V, R, tt)
        if (P[:, 2] <= 0).any(): continue
        H, Wd = cls.shape
        # nearer eye -> row limits from its projected landmarks (model geometry, no face needed in the photo)
        near = min(("R", "L"), key=lambda s: float(np.median(P[lid[EYE[s]["up"]], 2])))
        e = EYE[near]; depth = float(np.median(P[lid[e["up"]], 2]))
        ew_px = f * float(np.linalg.norm(V[lid[e["c"][0]]] - V[lid[e["c"][1]]])) / depth; iod_px = f * iod / depth
        lash_y = float(np.median(P[lid[e["up"]], 1])); brow_lo_y = float(np.median(P[lid[e["brow_lo"]], 1])); brow_up_y = float(np.median(P[lid[e["brow_up"]], 1]))
        if lash_y - brow_lo_y < 0.15 * ew_px: continue
        # model silhouette near the brow / orbital band
        mm = np.zeros((H, Wd), np.uint8); cv2.fillPoly(mm, list(np.round(P[skin_tri][:, :, :2]).astype(np.int32)), 1)
        cs, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cs: continue
        q = np.vstack([c_[:, 0, :] for c_ in cs]).astype(np.float64)
        dv, _ = cKDTree(P[bandv, :2]).query(q); q = q[dv < 0.02 * iod_px]
        if len(q) < 15: continue
        # photo: face-skin border whose outside is background only
        skin = (cls == 3).astype(np.uint8); skin = cv2.morphologyEx(skin, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        nb, lab, st, _ = cv2.connectedComponentsWithStats(skin)
        if nb <= 1: nskip["no_edge"] += 1; continue
        skin = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
        border = skin - cv2.erode(skin, np.ones((3, 3), np.uint8))
        ring = cv2.dilate(skin, np.ones((7, 7), np.uint8)) - skin; bad = ((ring > 0) & (cls != 0)).astype(np.uint8)
        dbad = cv2.distanceTransform(1 - bad, cv2.DIST_L2, 3)
        by, bx = np.nonzero((border > 0) & (dbad >= 6))
        if len(bx) < 20: nskip["no_edge"] += 1; continue
        d, j = cKDTree(np.c_[bx, by].astype(float)).query(q)
        qi = np.round(q).astype(int); qi[:, 0] = np.clip(qi[:, 0], 0, Wd - 1); qi[:, 1] = np.clip(qi[:, 1], 0, H - 1)
        sd = np.where(skin[qi[:, 1], qi[:, 0]] > 0, -d, d) / iod_px * 100
        keep = np.abs(sd) < 15
        h = (lash_y - q[:, 1]) / (lash_y - brow_lo_y)                      # 0 lash line .. 1 brow lower edge
        bins = [med(sd[keep & (h >= b / 5) & (h < (b + 1) / 5)], 2) for b in range(5)]
        lidsel = keep & (h >= 0) & (h <= 1)
        fore = keep & (q[:, 1] <= brow_up_y - 0.1 * ew_px) & (q[:, 1] >= brow_up_y - 0.25 * ew_px)
        if lidsel.sum() < 8: continue
        prof_rows["left" if vc[n][0] < 0 else "right"].append({"frame": n, "signed_median": float(np.median(sd[lidsel])), "n": int(lidsel.sum()),
                                                                "bins": bins, "forehead": med(sd[fore], 2) if fore.sum() >= 5 else None, "near_eye": near})
    v0 = json.load(open(os.path.join(M, "parts_v0.json"), encoding="utf-8")) if os.path.exists(os.path.join(M, "parts_v0.json")) else {}
    up = {"method": "model skin silhouette (brow + orbital band) vs FACE-SKIN class border (background outside only), rows brow lower edge ~ lash line, "
                    "brow hair band excluded; side frames SfM |yaw| 55-95 without holdout", "sign": "+ model outside the photo (fuller), - inside (hollower)",
          "bins": "signed median % IOD per height bin, 0 = lash line .. 1 = brow lower edge (5 bins)", "skipped": nskip, "side_frames": len(side)}
    for k, rows in prof_rows.items():
        sm = [r["signed_median"] for r in rows]
        ne = [r["near_eye"] for r in rows]
        up[k] = {"frames": len(rows), "near_eye": max(set(ne), key=ne.count) if ne else None,
                 "signed_median_pct_iod": med(sm, 2), "abs_median_pct_iod": med(np.abs(sm), 2) if sm else None,
                 "p90_abs_pct_iod": pct(np.abs(sm), 90, 2) if sm else None,
                 "profile_bins_pct_iod": [med([r["bins"][b] for r in rows], 2) for b in range(5)] if rows else None,
                 "forehead_band_pct_iod": med([r["forehead"] for r in rows], 2) if rows else None,
                 "v0_signed_median_pct_iod": ((v0.get("upper_lid_profile") or {}).get(k) or {}).get("signed_median_pct_iod")}
    out["upper_lid_profile"] = up; tm["side_sec"] = round(time.time() - t0, 1)
    # ---- 4. E1 eyelid curve distance on holdout frames
    t0 = time.time()
    hf = [n for n in sorted(hold) if n in poses and prep.get(n, {}).get("yaw") is not None and abs(prep[n]["yaw"]) <= HOLD_YAW]
    cv_ = {s: {"up": [], "lo": [], "up_al": [], "lo_al": []} for s in ("R", "L")}
    for n in hf:
        img = cv2.imread(os.path.join(images, n)); L = landmarks(mp, det, img)
        if L is None: continue
        P = proj(V, poses[n]["R"], poses[n]["t"])[:, :2]
        frontal_h = abs(prep[n]["yaw"]) <= FRONT_YAW and abs(prep[n].get("pitch") or 99) <= FRONT_PITCH and (prep[n].get("blink") is None or prep[n]["blink"] < BLINK_MAX)
        gray_h = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) if (cl_verts and frontal_h) else None
        for s in ("R", "L"):
            fr = eye_frame(L, s)
            if fr is None: continue
            if gray_h is not None and s in cl_verts:
                c = crease_frame(gray_h, L, s)
                if c is not None:
                    d_ = crease_model_dist(P, L, s, c[0], c[1], cl_verts[s], P[lid[list(EYE[s]["c"])]])
                    if d_ is not None: cl[s]["hold"].append(d_)
            e = EYE[s]; a_, t_, n_, ew = fr
            Lc = L.copy(); off = float(eo.get(s, 0.0))
            for k, tp in zip(e["up"], TAPER): Lc[k] = Lc[k] + off * tp * ew * n_      # photo upper lid -> lash line
            for key, ids in (("up", [e["c"][0]] + e["up"] + [e["c"][1]]), ("lo", [e["c"][0]] + e["lo"] + [e["c"][1]])):
                ph = to_eye(Lc[ids], fr); mo = to_eye(P[lid[ids]], fr)
                cv_[s][key].append(float(np.median(poly_dist(ph[1:-1], mo))))
                # corner-aligned (similarity from the model's corners onto the photo's): shape only
                pa, pb = ph[0], ph[-1]; ma, mb = mo[0], mo[-1]
                z = (pb - pa)[0] + 1j * (pb - pa)[1]; w = (mb - ma)[0] + 1j * (mb - ma)[1]
                if abs(w) > 1e-9:
                    r_ = z / w; mz = (mo[:, 0] - ma[0]) + 1j * (mo[:, 1] - ma[1]); mz = mz * r_ + (pa[0] + 1j * pa[1])
                    cv_[s][key + "_al"].append(float(np.median(poly_dist(ph[1:-1], np.c_[mz.real, mz.imag]))))
    lc = {"method": "holdout frames |yaw| <= 25: photo lid curves (MediaPipe, upper lid moved to the lash line by eyelid_offset) vs projected "
                    "model landmark vertices, point-to-polyline median per frame, x eye width; corner_aligned = after a similarity on the two corners (shape only)",
          "frames": len(hf)}
    for s in ("R", "L"):
        d = cv_[s]
        lc[NAME[s]] = {"frames": len(d["up"]), "upper_median": med(d["up"]), "upper_p90": pct(d["up"], 90), "lower_median": med(d["lo"]), "lower_p90": pct(d["lo"], 90),
                       "upper_corner_aligned_median": med(d["up_al"]), "lower_corner_aligned_median": med(d["lo_al"]), "eyelid_offset_applied": eo.get(s)}
    out["lid_curves"] = lc; tm["holdout_sec"] = round(time.time() - t0, 1)
    if cl_verts:
        cd = {"method": "model crease-line vertices (eye_parts.json) projected into near-frontal frames vs that frame's photo crease curve, "
                        "|v_model - v_photo(u)| median per frame then median over frames, x eye width; train = frames the target came from "
                        "(in-sample), holdout = holdout frontal frames (out-of-sample); signed = model - photo (+ model crease higher)",
              "eye_parts": os.path.basename(eye_parts)}
        for s in ("R", "L"):
            cd[NAME[s]] = {"line_vertices": int(len(cl_verts.get(s, []))),
                           "train_frames": len(cl[s]["train"]), "train_median": med([d[0] for d in cl[s]["train"]]), "train_p90": pct([d[0] for d in cl[s]["train"]], 90),
                           "train_signed_median": med([d[1] for d in cl[s]["train"]]),
                           "train_corner_aligned_median": med([d[3] for d in cl[s]["train"]]), "train_corner_aligned_signed": med([d[4] for d in cl[s]["train"]]),
                           "holdout_frames": len(cl[s]["hold"]), "holdout_median": med([d[0] for d in cl[s]["hold"]]), "holdout_signed_median": med([d[1] for d in cl[s]["hold"]]),
                           "holdout_corner_aligned_median": med([d[3] for d in cl[s]["hold"]]), "holdout_corner_aligned_signed": med([d[4] for d in cl[s]["hold"]])}
        out["crease_line"] = cd
    tm["total_sec"] = round(time.time() - T0, 1); out["timing_sec"] = tm
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("work"); ap.add_argument("--debug", action="store_true", help="write model/parts_v1_debug_*.jpg (local only)")
    ap.add_argument("--mesh", help="measure this mesh instead of the chosen fit (e.g. model/fit_gnme.ply)")
    ap.add_argument("--fit-json", help="its fit json (default: <mesh>.fit.json)"); ap.add_argument("--tag", help="output model/parts_v1_<tag>.json")
    ap.add_argument("--out", help="explicit output path"); ap.add_argument("--eye-parts", help="eye_parts.json of the mesh: adds the E2 crease-line distance")
    ap.add_argument("--sparse", help="COLMAP sparse model (default work/<id>/colmap/sparse_lens_anchored)")
    ap.add_argument("--stack", type=int, default=0, help="W14 P0: average N aligned frames per angle group before the crease detection (0 = off)")
    ap.add_argument("--crease-method", default="profile", choices=["profile", "ridge"], help="W14 P1': crease candidates from 1-D profile valleys (default) or the 2-D Hessian ridge response")
    ap.add_argument("--crease-columns", type=int, default=5, help="10/23 option: crease search columns per eye (5 = the MediaPipe upper-lid points, default; e.g. 13 = sampled on the lid line)")
    ap.add_argument("--crease-shadow-rule", default="on", choices=["on", "off"], help="10/23 option: the 10/21 shadow rule (strip_valid), default on")
    ap.add_argument("--crease-span", default="mp", choices=["mp", "ends", "corners", "inner-ext", "outer-ext"], help="10/23 option: crease columns between lid points 2..6 (mp, default), 1..7 (ends), corner to corner (corners), on past the inner (inner-ext) or the OUTER corner (outer-ext)")
    ap.add_argument("--crease-ridge-angle", type=float, default=35.0, help="10/23 option: allowed tilt of the ridge line against the eye axis (deg, default 35)")
    ap.add_argument("--crease-above-lash", type=float, default=0.03, help="10/23 option: lower end of the crease search above the found lash edge (default 0.03)")
    ap.add_argument("--crease-lo-floor", default="always", choices=["always", "no-edge"], help="10/23 option: the 0.06 floor always (default) or only when no lash edge was found")
    ap.add_argument("--crease-open-tol", type=float, default=0.0, help="10/23 option: drop frontal frames whose eye opening differs from the median by more than this share (0 = off)")
    ap.add_argument("--crease-continue", action="store_true", help="10/24 option (with --crease-span corners): trace corner to corner as before, then "
                    "continue the line past the outer corner by its own bend while the photo still shows a line along it (CR_CONTINUE)")
    ap.add_argument("--crease-trim-lash", action="store_true", help="10/23 option: traced line ends where it meets the lash line (end runs on the lower bound cut)")
    ap.add_argument("--crease-trace", action="store_true", help="10/23 option: trace the crease as one curve on the 2-D ridge response (implies --crease-method ridge)")
    ap.add_argument("--crease-min-strip", type=float, default=0.0, help="10/24 option: a frame's line lying less than this (x eye width) above "
                    "the lash edge is the lid margin, not a fold -> dropped (CR_MIN_STRIP, e.g. 0.05; 0 = off)")
    ap.add_argument("--crease-type", default="length", choices=["length", "repeat"], help="10/24 option: crease type by the 60 %% / 40 %% column "
                    "rules (length, default) or by a run of columns seen at the same place in >= half of the near-frontal frames (repeat)")
    a = ap.parse_args()
    global CR_MIN_STRIP, CR_TYPE; CR_MIN_STRIP, CR_TYPE = a.crease_min_strip, a.crease_type
    global CR_METHOD, CR_COLUMNS, CR_SHADOW_RULE, CR_TRACE; CR_METHOD = "ridge" if a.crease_trace else a.crease_method; CR_COLUMNS = a.crease_columns; CR_SHADOW_RULE = a.crease_shadow_rule == "on"; CR_TRACE = a.crease_trace
    global CR_SPAN, RIDGE_ANGLE; CR_SPAN, RIDGE_ANGLE = a.crease_span, a.crease_ridge_angle
    global CR_ABOVE_LASH, CR_LO_FLOOR_EDGE, CR_OPEN_TOL, CR_TRIM_LASH; CR_ABOVE_LASH, CR_LO_FLOOR_EDGE, CR_OPEN_TOL, CR_TRIM_LASH = a.crease_above_lash, a.crease_lo_floor == "always", a.crease_open_tol, a.crease_trim_lash
    global CR_CONTINUE
    if a.crease_continue: CR_CONTINUE = True
    out = measure(a.work, mesh=a.mesh, fit_json=a.fit_json, out_path=a.out, tag=a.tag, eye_parts=a.eye_parts, sparse=a.sparse, debug=a.debug, stack=a.stack)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
