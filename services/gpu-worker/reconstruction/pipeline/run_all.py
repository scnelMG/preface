"""ONE command: capture video/photos -> 3D face model + 360 viewer (nose/eye editing, expression tracking).

  python pipeline/run_all.py --input inbox/p02 --id p02 [--focal 2750] [--force]
  (npm.cmd run scan:all -- --input inbox/p02 --id p02)

stages (each is skipped when its output exists, so an interrupted run continues where it stopped):
  1 prepare  prepare_capture.py   frames from the video(s), blur / blink rejection, MediaPipe yaw+pitch, masks
  2 sfm      sfm_sparse.py        features, matching, incremental mapping (CPU, pycolmap)
  3 lens     lens_anchor.py       focal length where SfM head rotation == MediaPipe head rotation (or --focal, fixed)
  4 model    scan_to_model.py     landmarks -> pose check -> pose/landmark bundle refinement -> template fit (outline,
                                  eyelids, side-profile silhouettes) -> hold-out evaluation -> texture + eye colours -> case
  5 viewer   viewer_data.py + build_viewer.mjs   work/<id>/model/viewer.html
quality gates (written to work/<id>/run_all.json, PASS / WARN / FAIL per stage) - nothing is edited by hand in between.
PERSONAL DATA: everything stays under work/<id> and cases/ on this PC.
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)


def child_cpu():
    """CPU seconds (user + system) of the finished child programs so far; None where the OS has no resource module (Windows)"""
    try: import resource
    except ImportError: return None
    r = resource.getrusage(resource.RUSAGE_CHILDREN); return r.ru_utime + r.ru_stime


def run(args, log):
    t = time.time()
    with open(log, "a", encoding="utf-8") as fh:
        fh.write("\n$ " + " ".join(args) + "\n"); fh.flush()
        # stream the sub-step headlines ("[4/7] ...", "선택: ...") so a long stage shows progress in the terminal
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=fh, text=True, encoding="utf-8", errors="replace",
                             env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"})
        lines = []
        for line in p.stdout:
            lines.append(line.rstrip("\n")); fh.write(line)
            if line.startswith("[") or "선택:" in line or line.startswith("features ok") or line.startswith("matches ok"):
                print("    " + line.rstrip()[:160], flush=True)
        p.wait()
    return p.returncode, [l for l in lines if l.strip()], round(time.time() - t, 1)

# W1d (2026-10-19) camera-pose gates. eun03: SfM stopped the left turn at about -20 deg while MediaPipe saw -37 .. -75 deg;
# the model was built anyway (side hold-out 18-20 %, narrow skull, wide cheeks) and only reported WARN.
#   slope   SfM yaw vs MediaPipe yaw over all frames: good captures 1.03-1.27, eun03 0.67-0.72
#   side    median |SfM yaw| - |MediaPipe yaw| over the frames turned >= 35 deg to one side: good -0.4 .. +12, eun03 -27 .. -31
POSE_SLOPE_MIN = 0.85
POSE_SIDE_MIN_DEG = -15.0
#   range   (2026-10-20, eun02-pb3) a whole side can fail to REGISTER: 76 % registered passed the 60 % gate and the side
#           check had 1 frame left. The SfM turn range must reach the MediaPipe turn range on each side (MediaPipe sees
#           a face up to ~75 deg, SfM covers the profiles too, so SfM is normally WIDER): good captures SfM exceeds
#           MediaPipe by 5.8-62 deg per side (8 runs); eun03 / eun03-r 44-45 deg short, eun02-pb3 51 deg short -> FAIL
#           when SfM is more than 20 deg short on a side
POSE_RANGE_SHORT_DEG = 20.0
#   direction (2026-10-20, eun02-akc ALIKED) |signed slope| / slope: the signed one follows the turn DIRECTION, so a
#           solution where one side is folded back (turning left moves the camera right) keeps the unsigned slope ~1 but
#           the signed one drops to ~0. 37 earlier runs 0.75-1.00, eun02-pb3 (left side lost) 0.60, eun02-akc 0.05
#           (SfM left range -108 -> -54 deg, outline 0.835 -> 1.32) -> FAIL below 0.5
POSE_DIR_RATIO_MIN = 0.5
# --lens-gate-reliable (2026-10-24): side frames (|expected| > 45 deg) more than 30 deg off their expected angle, share
# above this = folded side. Folded (old masks) woo03-ang 0.58, eun03 0.95, seo01 1.00; 15 straight runs 0-0.05
POSE_FOLD_MAX = 0.25
# side registration (S15P31B204-675, plan S3-1): the 60 % / 80 % registration gates count all frames, so a whole side could
# fail to register and pass (11/05 frame-removal runs: lost side 0/6 - 0/7 registered, 73-93 % overall). Frames turned
# >= SIDE_REG_DEG to one side (MediaPipe, no false face) are counted per side; fewer than SIDE_REG_MIN of them registered
# -> lens FAIL (photo problem, retake) before the model is built. Judged only with >= SIDE_REG_MIN_FRAMES frames on that
# side (one frame is too few to judge). 11/08: the 6 originals 100 % on both sides with 7-13 side frames each; the 25
# frame-removal runs: lost sides 0/2 - 0/7 caught (7 runs), 1/2 = 50 % passes, nothing else flagged
SIDE_REG_DEG, SIDE_REG_MIN, SIDE_REG_MIN_FRAMES = 35.0, 0.5, 2
# DEFAULT since 2026-10-24 (만두 결정): the double-eyelid step (scan_to_model --eye-parts --eye-parts-post) runs on every capture
# with these eye_parts_fit options = the A13 set confirmed on chae01 / gyu01 (DEV-LOG 10/23-24) + the crease decision rules of
# 10/24 (strip / repeat / shade). --eye-parts-extra is appended (later values win); --eye-parts-plain = eye_parts_fit's own
# defaults (runs before 10/24); --no-eye-parts = no eye step. Two of them are SYMPTOM fits, not causes (DEV-LOG 10/24):
# --ramp-inner 0.2 (chae01 inner end rose abruptly) and --crease-continue (tail length, sensitive to the last 2-3 columns).
# --shade-lo 0.30 is provisional (3 people; lighting / skin tone move the darkness).
# 2026-11-13 (만두 결정): the crease SHAPE is --mode lid (pipeline/lid_fold.py: one step in the lid's front skin, line corrected
# by projection instead of gray renders); where and whether there is a crease is measured as before. The shape before
# that: --eye-parts-extra="--mode tuck --fold 0.03 --fold-width 0.15 --fold-sag 0.6 --loop-ref dark --loop-bands --tuck-up 0 --crease-push forward"
LID_DEPTH = json.load(open(os.path.join(ROOT, "engine", "lid-step.json"), encoding="utf-8"))["depth"]   # shared with the edit engine
EYE_PARTS_DEFAULT = (f"--mode lid --depth {LID_DEPTH} --curve smooth --iters 3 "
                     "--crease-trace --crease-columns 41 --crease-shadow-rule off --crease-span corners "
                     "--crease-ridge-angle 50 --crease-curve direct --crease-lo-floor no-edge --crease-above-lash 0.012 --crease-trim-lash "
                     "--crease-end frames --crease-slide 0.85 --end-taper 0.1 --crease-continue "
                     "--ramp-inner 0.2 --drop-outlier-frames "
                     "--crease-min-strip 0.05 --crease-type repeat --depth-from-shade --shade-lo 0.30")


def device_focal(name, size):
    """focal length in px for a device profile and an image size "WxH" (the long side carries the long-side FOV)"""
    import math
    prof = json.load(open(os.path.join(ROOT, "assets", "device_profiles.json"), encoding="utf-8"))
    if name not in prof: raise SystemExit(f"unknown --device {name}; known: {[k for k in prof if not k.startswith('_')]}")
    p = prof[name]; w, h = [int(v) for v in size.split("x")]; long_side = max(w, h)
    ax, ay = p.get("sensor_aspect", [4, 3]); diag = math.hypot(ax, ay)
    if "diag_fov_deg" in p: t_diag = math.tan(math.radians(p["diag_fov_deg"]) / 2)
    else: t_diag = 21.633 / p["equiv_mm"]                       # 35 mm equivalent: half diagonal 21.63 mm
    t_long = t_diag * ax / diag
    f = (long_side / 2) / t_long * p.get("video_crop", 1.0)
    return round(f, 1), {"profile": name, "label": p.get("label"), "focal_px": round(f, 1), "status": p.get("status"), "source": p.get("source")}


def profile_measured(name):
    """True when the device profile was checked against a real video ('measured ...'); 'estimate ...' and unknown -> False"""
    prof = json.load(open(os.path.join(ROOT, "assets", "device_profiles.json"), encoding="utf-8"))
    return str(prof.get(name, {}).get("status", "")).startswith("measured")


# lens search per lens value (S15P31B204-467). 10-29 production: two Galaxy S26+ videos ran the galaxy-s26-front ESTIMATE
# (1390.7 px) fixed, one trial -> lens_anchor exit 2, no retry, while an A52s without a profile searched 600..3000 and
# passed. A failed trial now falls back instead of failing the job. Every value is first used fixed as before, so a run
# that passed with it is unchanged (the full search can be far off: eun02-sam 631 px vs the S24 1559 px).
# prepared frames' long side (S15P31B204-669). One size for every input: the web guide records 1920x1080, and a 4K
# upload is shrunk to the same 1920 (was 3200: only 4K uploads used it; registration 89% at 3200 vs 90% at 1920 on the
# iPhone 16 Pro 4K test, 11/04). Smaller videos are not enlarged (a camera may give the web 1280x720 instead of 1920).
FRAME_MAX_SIDE = 1920
LENS_NEAR = (0.75, 1.35, 3)   # lo, hi as a factor of the estimate, bisection steps (the first trial is ~1.0 x)
# full search as a share of the prepared frames' long side (S15P31B204-669, plan S3-4 / F-6). The fixed 600..3000 px
# is 0.31..1.56 at 1080x1920 and let wrong solutions in (eun02-sam 631 px vs the S24 1559 px). Every focal seen so far
# sits at 0.53..0.81: iPhone 17 Pro 1018 / 1920 (file record 20 mm), iPhone 14 Plus / 16 Pro 1222, iPhone 12 1273,
# Galaxy S24 1559 (fitted). 0.45..0.95 keeps a margin on both sides. It stays a share, not px, because a frame can be
# smaller than FRAME_MAX_SIDE (above).
LENS_FULL_RATIO = (0.45, 0.95)


def side_registration(registered, images, side_deg=None):
    """{"left": [registered, frames], "right": [...]} over the frames turned >= side_deg (MediaPipe yaw, negative = left)
    that are not false faces. registered: names of the registered images; images: the prepare.json image list"""
    side_deg = SIDE_REG_DEG if side_deg is None else side_deg
    out = {"left": [0, 0], "right": [0, 0]}
    for im in images:
        yaw = im.get("yaw")
        if yaw is None or im.get("false_face") or abs(yaw) < side_deg:
            continue
        row = out["left" if yaw < 0 else "right"]
        row[1] += 1
        row[0] += im.get("file") in registered
    return out


def short_sides(sides):
    """sides of side_registration() with too few registered: [(side, registered, frames)]"""
    return [(k, r, n) for k, (r, n) in sides.items() if n >= SIDE_REG_MIN_FRAMES and r < SIDE_REG_MIN * n]


def lens_attempts(focal, estimate, long_side=None):
    """lens_anchor.py range arguments in the order they are tried: [(search, args), ...]. A value is fixed once first;
    when that fails an estimate is searched around, then (any value) the full search over LENS_FULL_RATIO x the frames'
    long side (lens_anchor's own 600..3000 px when the frame size is unknown); no value -> full only"""
    full = ("full", ["--lo", str(round(long_side * LENS_FULL_RATIO[0], 1)), "--hi", str(round(long_side * LENS_FULL_RATIO[1], 1))]
            if long_side else [])
    if not focal: return [full]
    tries = [("fixed", ["--lo", str(focal), "--hi", str(focal), "--iters", "1"])]
    if estimate:
        lo, hi, it = LENS_NEAR
        tries.append(("near", ["--lo", str(round(focal * lo, 1)), "--hi", str(round(focal * hi, 1)), "--iters", str(it)]))
    return tries + [full]


def frame_long_side(size):
    """'1080x1920' -> 1920; anything else -> None"""
    try:
        w, h = (int(x) for x in str(size).lower().split("x"))
        return max(w, h)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="folder with the capture video(s) / photos")
    ap.add_argument("--id", required=True); ap.add_argument("--focal", type=float, help="known focal length in px (calibrated phone): skips the lens search")
    ap.add_argument("--frames", default="100"); ap.add_argument("--force", action="store_true")
    ap.add_argument("--prep-exclude-ms", default="", help="prepare_capture.py --exclude-ms (S15P31B204-667): video time ranges "
                    "'start-end,...' (ms) left out of the frame choice; frames_bundle sets it from the web guide trace")
    ap.add_argument("--prep-pose-trace", default="", help="prepare_capture.py --pose-trace (option): web guide capture trace "
                    "file; frames spread over new head poses instead of time. frames_bundle sets it for web recordings (EXTRACT_POSE_SLOTS, default on)")
    ap.add_argument("--sparse", help="use an existing lens-checked COLMAP sparse model (e.g. from the GPU PC) instead of stages 2-3")
    ap.add_argument("--until", default="viewer", choices=["prepare", "sfm", "lens", "model", "viewer"])
    ap.add_argument("--cpu", action="store_true", help="do not use the CUDA COLMAP binary for features / matching")
    ap.add_argument("--person-masks", default="selfie", choices=["selfie", "sam"], help="person / background boundary for "
                    "the outline fit: selfie (MediaPipe, default) or sam (SAM 2.1 full resolution, needs tools/torch_setup)")
    ap.add_argument("--redo", choices=["sfm", "lens", "model", "viewer"], help="redo this stage and the ones after it "
                    "(e.g. after a pipeline fix), keeping the earlier stages")
    ap.add_argument("--even-light", type=float, default=0.0, help="texture: soften broad skin shadows (0..1). Off by default")
    ap.add_argument("--dense", action="store_true", help="dense stereo (CUDA COLMAP) to shape the NOSE from measured "
                    "points (wings, nostril rims): about 2-4 min on the GPU; skipped with a note when no CUDA COLMAP")
    ap.add_argument("--focal-estimate", action="store_true", help="--focal is an estimate (device profile not checked with "
                    "a real video, S15P31B204-467): when the fixed trial fails, search around it (x0.75..1.35, 3 trials) before the full search")
    ap.add_argument("--device", help="capture device lens profile (assets/device_profiles.json), e.g. galaxy-s24-front, "
                    "iphone12-front: fixes the focal length (the lens search is unreliable on face-only video)")
    ap.add_argument("--select-max-crease", type=float, default=0.0, help="W1d option, off by default: candidates with "
                    "crease p95 above this are not chosen (scan_to_model.py --select-max-crease, try 0.15)")
    ap.add_argument("--edge-margin", type=float, default=0.0, help="OPTION (2026-10-22, off = 0): person-outline points within this many px of the image border are not used by the crown (head top) term - close-ups cut the head by the frame, and the border is \"the photo ends\", not \"the head ends\" (pipeline/outline_obs.py LM_EDGE_MARGIN). Try 3")
    ap.add_argument("--lens-gate-reliable", action="store_true", help="OPTION (2026-10-24): the lens-stage rotation / direction check uses only frames where MediaPipe is reliable (|yaw| <= 45, no false face; lens_anchor.py --yaw-max 45 --skip-false-faces). Beyond ~60 deg MediaPipe reads the turn too small or finds false frontal faces, so a straight SfM could FAIL")
    ap.add_argument("--sfm-keep-background", action="store_true", help="old behaviour (before 2026-10-24): SfM head masks keep the background inside the enlarged head outline (sfm_sparse.py --keep-mask-background). Default now cuts it with the person segmentation (side views folded onto the frontal pose in woo03 / eun03 / seo01)")
    ap.add_argument("--select", default="time", choices=["time", "angle"], help="OPTION (2026-10-24, default time = unchanged): frame selection spread evenly over the head pose instead of over time (prepare_capture.py --select angle)")
    ap.add_argument("--include-frames", default="", help="with --select angle: video frame numbers always taken (fixed evaluation frames of a test series)")
    ap.add_argument("--yaw-quota-profile", type=int, default=0, help="OPTION with --yaw-quota: own quota for the two no-face profile bins (prepare_capture.py --yaw-quota-profile). Try 15")
    ap.add_argument("--yaw-quota", type=int, default=0, help="OPTION (2026-10-22, off = 0): keep the even frames and ADD frames so that every 15 deg head-turn bin (MediaPipe yaw) and each no-face profile side has at least this many (prepare_capture.py --yaw-quota). Try 5")
    ap.add_argument("--pose-extra", default="", help="W7f option C: keep the 100 even frames and ADD chin-up / chin-down "
                    "frames only where they are missing, e.g. chinup:4,chindown:2 (prepare_capture.py --pose-extra)")
    ap.add_argument("--pose-bins", type=int, default=0, help="W7f option: frame selection keeps every pose bin (chin up / "
                    "down, left / right, profile) - prepare_capture.py --pose-bins; try 3")
    ap.add_argument("--gnm-extra", default="", help="extra gnm_fit.py options (comparison runs, W7a), use --gnm-extra=\"...\"")
    ap.add_argument("--select-prefer", default="", help="W-det option, off by default (e.g. gnm): choose this candidate "
                    "unless its hold-out landmark error is more than 0.5 %% IOD worse (no outline margin)")
    ap.add_argument("--repeatable", action=argparse.BooleanOptionalAction, default=True, help="DEFAULT since 2026-11-08 "
                    "(S15P31B204-673, 만두 결정): the same input gives the same cameras every run (seeded match verification + "
                    "single-thread mapping). Without it SfM differs run to run (eun02 lens slope 1.242-1.273, shape ~1.9 %%) and "
                    "flipped the gnm / lm choice, so a re-generation changed the face and a change could not be told from chance. "
                    "--no-repeatable = old behaviour")
    ap.add_argument("--service", action="store_true", help="the service worker path (S15P31B204-761): outputs only a local review reads are not made - the eye colour measurement (eye_color.json, read by nothing) and the gray qa picture (qa_gray.png; the qa numbers stay). The editable case stays: the viewer stage builds the rig's nose block from it. Shape, texture, GLB and rig are the same")
    ap.add_argument("--no-lm", action="store_true", help="W5b option, off by default: no lm candidate (gnm only; scan_to_model.py --no-lm)")
    ap.add_argument("--shape-only", action="store_true", help="geometry/eyes/nose + gray GLB/photo overlay; skip texture and coloured case")
    ap.add_argument("--nostril-fit", action="store_true", help="OPTION: team nostril fit, after eye fitting, no hold-out frames")
    ap.add_argument("--alar-width", default="model", choices=["model", "photo"], help="OPTION: photo alar width; default model unchanged")
    ap.add_argument("--nose-protection", choices=["legacy", "harmonic"], default="legacy", help="OPTION: continuous nose/cheek transition, fixed eyes/lips")
    ap.add_argument("--nose-profile", action="store_true", help="OPTION: true-profile nose tip/infratip fit after nostril fitting")
    ap.add_argument("--nose-fit", default="joint", choices=["off", "joint"], help="DEFAULT joint (2026-11-11, S15P31B204-773): joint nose fit of every nose observation (scan_to_model.py --nose-fit); off = the earlier shape. Needs SAM 2.1, skipped without it. --detail and the old nose step options need --nose-fit off")
    ap.add_argument("--eye-parts", action="store_true", default=True, help="DEFAULT since 2026-10-24 (만두): candidate gnme = gnm + eye detail "
                    "(scan_to_model.py --eye-parts --eye-parts-post, eye_parts_fit options EYE_PARTS_DEFAULT + --eye-parts-extra)")
    ap.add_argument("--no-eye-parts", dest="eye_parts", action="store_false", help="no eye step (behaviour before 2026-10-24)")
    ap.add_argument("--eye-parts-plain", action="store_true", help="eye step with eye_parts_fit's own defaults + --eye-parts-extra only "
                    "(no EYE_PARTS_DEFAULT, no --eye-parts-post) - reproduces the eye runs before 2026-10-24")
    ap.add_argument("--detail", action="store_true", help="W8b S2 option, off by default: detail layer (scan_to_model --detail) - textures and head.glb from the subdivided mesh")
    ap.add_argument("--detail-extra", default="", help="extra detail_apply.py options, e.g. --detail-extra=\"--crease fold=0.05\"")
    ap.add_argument("--no-hairline", action="store_true", help="skip the per-person hairline (pipeline/hairline.py -> "
                    "model/hairline.json, on by default since S15P31B204-328; shape and texture do not depend on it)")
    ap.add_argument("--no-bald", action="store_true", help="keep the hair painted in the skin maps of head.glb (default since "
                    "S15P31B204-68: pipeline/bald_skin.py -> model/tex_skin_bald.png + tex_skin_albedo_bald.png, put into "
                    "head.glb; needs the hairline, skipped with --no-hairline)")
    ap.add_argument("--model-extra", default="", help="extra scan_to_model.py options for comparison runs, e.g. --model-extra=\"--eye-depth-w 0.2 --eyelid-cols --lid-clear 0.05\"")
    ap.add_argument("--eye-parts-extra", default="", help="extra eye_parts_fit.py options appended to EYE_PARTS_DEFAULT (later values win), e.g. --eye-parts-extra=\"--depth 0.03\"")
    ap.add_argument("--no-pose-gate", action="store_true", help="build the model even when the camera-pose check fails "
                    "(SfM turn vs MediaPipe head turn, W1d 2026-10-19) - for looking at a failed capture")
    a = ap.parse_args()
    if a.shape_only and a.detail: ap.error("--shape-only requires base topology; omit --detail")
    if a.detail and (a.nostril_fit or a.alar_width == "photo" or a.nose_profile or a.nose_fit != "off"):
        ap.error("코 옵션은 base GNM 전용입니다. --detail에는 --nose-fit off를 함께 주고 다른 코 옵션은 빼세요")
    if a.nose_fit != "off" and (a.nostril_fit or a.alar_width == "photo" or a.nose_profile):
        ap.error("--nose-fit joint(기본)는 --nostril-fit / --alar-width photo / --nose-profile을 대신합니다. 예전 단계를 쓰려면 --nose-fit off")
    py = sys.executable
    os.environ["LM_PERSON_MASKS"] = a.person_masks       # read by cranium_fit.person_masks (all sub-steps)
    if a.edge_margin > 0: os.environ["LM_EDGE_MARGIN"] = str(a.edge_margin)   # read by outline_obs (model sub-steps)
    if not os.path.isdir(a.input) and not a.sparse:
        raise SystemExit(f"입력 폴더가 없습니다: {a.input}  (inbox 아래 폴더 이름 확인: {sorted(os.listdir(os.path.join(ROOT, 'inbox'))) if os.path.isdir(os.path.join(ROOT, 'inbox')) else '-'})")
    lens_src = {"source": "--focal", "focal_px": a.focal} if a.focal else None
    if not a.focal and not a.sparse:
        # lens policy step 2 (2026-10-19): camera information in the ORIGINAL video file (iPhone .mov: model, 35 mm
        # equivalent focal length). A known model -> its device profile; otherwise the 35 mm equivalent itself.
        # Messenger re-sends (KakaoTalk) carry nothing and fall through to the next steps.
        # 2026-10-22 (만두 "파일 우선"): the file is read with --device too and its recorded focal length wins - before,
        # --device skipped the file and work/woo02 ran on the profile estimate 1429 px instead of the recorded 1273 px
        try:
            sys.path.insert(0, HERE); from video_meta import read as read_meta
            vids = sorted(f for f in os.listdir(a.input) if f.lower().endswith((".mov", ".mp4", ".m4v")))
            meta = read_meta(os.path.join(a.input, vids[0])) if vids else {}
        except Exception:
            meta = {}
        # the recorded 35 mm equivalent is MEASURED for this video -> it wins over the (estimated) device profile.
        # (woo02, iPhone 12 original: 25 mm -> 1273 px, the profile estimate is 1429 px; see WORKPLAN W4)
        if meta.get("samsung_focal35") and not meta.get("focal35"):
            # S15P31B204-467 (2026-10-30): Galaxy models launched with Android 15+ record udta/smta/lens. Its value is the
            # still's 35 mm equivalent and not confirmed for video, so it is used like an estimate: fixed first, then the
            # search around it / the full search when that fails (--focal-estimate)
            # S15P31B204-565: only the source is decided here; the lens stage converts it on the prepared frames
            a.focal_estimate = True
            lens_src = {"source": "file", "focal35_mm": meta["samsung_focal35"], "still": True, "estimate": True,
                        "samsung_lens": meta["samsung_lens"]}
            print(f"   영상 파일 정보(삼성 렌즈 기록 {meta['samsung_lens']}): 35mm 환산 {meta['samsung_focal35']} mm "
                  "(확인 전 값: 실패하면 근처·넓은 탐색)", flush=True)
        if meta.get("model") and not meta.get("focal35") and not lens_src:
            # 2026-10-23 (만두): no lens record in THIS video (woo03: trimmed in the Photos app) -> the value recorded in
            # another original of the same model (inbox/) comes before the device profile and before --device
            try:
                from video_meta import same_model_focal35
                f35, src_files = same_model_focal35(meta["model"], os.path.join(ROOT, "inbox"), exclude=[os.path.join(a.input, vids[0])],
                                                    cache=os.path.join(ROOT, "work", "_video_meta_cache.json"))
            except Exception:
                f35, src_files = None, []
            if f35:
                meta = {**meta, "focal35": f35, "focal35_from": src_files}
        if meta.get("model") and not meta.get("focal35") and not a.device and not lens_src:
            prof = json.load(open(os.path.join(ROOT, "assets", "device_profiles.json"), encoding="utf-8"))
            hit = [k for k, p in prof.items() if not k.startswith("_") and any(m.lower() in meta["model"].lower() for m in p.get("match", []))]
            if hit:
                a.device = sorted(hit, key=lambda k: -max(len(m) for m in prof[k]["match"]))[0]
                print(f"   영상 파일 정보: {meta['model']} → 기종 프로필 {a.device}", flush=True)
        if meta.get("focal35"):
            # S15P31B204-565: only the source is decided here; the lens stage converts it on the prepared frames
            # (converting with the original 3840 px video gave the smaller prepared frames a 1.2x focal)
            same = meta.get("focal35_from")
            lens_src = {"source": "same-model file" if same else "file", "focal35_mm": meta["focal35"], "lens_model": meta.get("lens_model"),
                        **({"from_files": same, "model": meta.get("model")} if same else {}),
                        **({"device_ignored": a.device} if a.device else {})}
            print((f"   영상에 렌즈 기록 없음 → 같은 기종({meta.get('model')}) 원본 {', '.join(same)}의 기록값: 35mm 환산 {meta['focal35']} mm"
                   if same else f"   영상 파일 정보: 35mm 환산 {meta['focal35']} mm ({meta.get('lens_model', '')})")
                  + (f" — --device {a.device} 프로필 대신 파일 기록값 사용" if a.device else ""), flush=True)
    if not a.device and not lens_src and not a.sparse:
        # 2026-10-19: a comparison run (eun02-sam) without --device fell back to the lens search (631 px instead of the
        # S24 1559 px) and was not comparable. Reuse the device of an earlier run of the SAME input folder.
        same = []
        for d in sorted(os.listdir(os.path.join(ROOT, "work"))) if os.path.isdir(os.path.join(ROOT, "work")) else []:
            try:
                r0 = json.load(open(os.path.join(ROOT, "work", d, "run_all.json"), encoding="utf-8"))
                if os.path.normpath(r0.get("input", "")) == os.path.normpath(a.input) and (r0.get("device") or {}).get("profile"):
                    same.append(r0["device"]["profile"])
            except Exception:
                pass
        if same:
            a.device = same[-1]
            print(f"   --device 미지정: 같은 입력({a.input})의 이전 실행 기종 {a.device} 사용 (다르면 --device 로 지정)", flush=True)
    W = os.path.join(ROOT, "work", a.id)
    if a.shape_only and os.path.exists(os.path.join(W, "model", "head.glb")):
        old = json.load(open(os.path.join(W, "model", "report.json"), encoding="utf-8"))
        if not old.get("shape_only"):
            raise SystemExit("기존 전체 결과를 회색 결과로 덮어쓸 수 없습니다. 새 --id를 사용하세요.")
    os.makedirs(W, exist_ok=True)
    open(os.path.join(W, ".gitignore"), "w").write("*\n")
    log = os.path.join(W, "run_all.log"); rp = os.path.join(W, "run_all.json")
    rep = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) and not a.force else {"id": a.id, "input": a.input, "stages": {}}
    S = rep["stages"]
    rep["options"] = {**rep.get("options", {}), "shape_only": bool(a.shape_only)}
    if a.nostril_fit or a.alar_width == "photo" or a.nose_profile or a.nose_fit != "off":
        rep["options"] = {**rep.get("options", {}), "nostril_fit": a.nostril_fit, "alar_width": a.alar_width,
                          "nose_protection": a.nose_protection, "nose_profile": a.nose_profile, "nose_fit": a.nose_fit}
    if a.redo:
        for n in ["sfm", "lens", "model", "viewer"][["sfm", "lens", "model", "viewer"].index(a.redo):]: S.pop(n, None)
    if lens_src and "lens" not in S: rep["lens_source"] = lens_src
    if a.edge_margin > 0 or a.yaw_quota > 0 or a.select != "time": rep["options"] = {**rep.get("options", {}), **({"select": a.select, "include_frames": a.include_frames} if a.select != "time" else {}), **({"edge_margin": a.edge_margin} if a.edge_margin > 0 else {}), **({"yaw_quota": a.yaw_quota} if a.yaw_quota > 0 else {}), **({"yaw_quota_profile": a.yaw_quota_profile} if a.yaw_quota > 0 and a.yaw_quota_profile > 0 else {})}   # only when the lens stage runs with it (--redo model keeps the old lens)
    # environment, so timings from different PCs / settings can be compared
    import platform
    env = {"os": platform.platform(), "cpu_cores": os.cpu_count(), "python": platform.python_version()}
    for mod in ("pycolmap", "mediapipe", "cv2", "numpy", "scipy"):
        try: env[mod] = __import__(mod).__version__
        except Exception: env[mod] = None
    # GPU / PyTorch (2026-10-19: test-PC spec recorded with every run; torch only if installed)
    try:
        g = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
                           capture_output=True, text=True, timeout=20)
        env["gpu"] = [l.strip() for l in g.stdout.splitlines() if l.strip()] or None
    except Exception:
        env["gpu"] = None
    try:
        import importlib.util
        if importlib.util.find_spec("torch"):
            import torch
            env["torch"] = torch.__version__; env["torch_cuda"] = torch.version.cuda; env["cuda_available"] = torch.cuda.is_available()
    except Exception as ex:
        env["torch"] = f"error: {ex}"[:120]
    rep["env"] = env
    # 2026-10-23 (GIT-RULES.md 7): the code point of this run, so any result can be rebuilt from its commit.
    # code_dirty = uncommitted changes in tracked files at run time (the result may not match code_commit)
    try:
        g = lambda *x: subprocess.run(["git", *x], cwd=ROOT, capture_output=True, text=True, timeout=20)
        head = g("rev-parse", "--short", "HEAD").stdout.strip()
        dirty = [l[3:] for l in g("status", "--porcelain", "--untracked-files=no").stdout.splitlines() if l.strip()]
        rep["code"] = {"commit": head or None, "dirty": bool(dirty), "dirty_files": dirty[:30]}
        if dirty: print(f"   주의: 커밋 안 된 코드 변경 {len(dirty)}개 상태로 실행 (run_all.json code.dirty_files) — 결과를 커밋 지점으로 다시 낼 수 없음", flush=True)
    except Exception:
        rep["code"] = {"commit": None, "dirty": None}
    save = lambda: json.dump(rep, open(rp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    order = ["prepare", "sfm", "lens", "model", "viewer"]

    def stage(name, fn):
        if S.get(name, {}).get("status") in ("PASS", "WARN") and not a.force:
            print(f"[{name}] 이미 완료 ({S[name]['status']})"); return True
        print(f"[{name}] 실행 중...", flush=True)
        t0 = time.time(); c0 = child_cpu(); res = fn(); res["sec"] = round(time.time() - t0, 1)   # wall time of this stage (this call)
        # CPU core-seconds of the stage's programs and its start time (S15P31B204-445: per-stage CPU in the worker record)
        if c0 is not None: res["cpu_sec"] = round(child_cpu() - c0, 1)
        res["started"] = round(t0, 1)
        if S.get(name, {}).get("status") == "FAIL": res["resumed_after_fail"] = True
        S[name] = res; rep["total_sec"] = round(sum(S[n].get("sec", 0) for n in order if n in S), 1); save()
        print(f"[{name}] {res['status']}  {json.dumps({k: v for k, v in res.items() if k not in ('status',)}, ensure_ascii=False)[:400]}", flush=True)
        return res["status"] != "FAIL"

    # 1 prepare
    def prepare():
        pj = os.path.join(W, "prep", "prepare.json")
        if not os.path.exists(pj):
            c, out, sec = run([py, os.path.join(HERE, "prepare_capture.py"), a.input, os.path.join(W, "prep"),
                               "--frames-total", a.frames, "--max-side", str(FRAME_MAX_SIDE), "--masks", "auto"] + (["--pose-bins", str(a.pose_bins)] if a.pose_bins > 1 else []) + (["--pose-extra", a.pose_extra] if a.pose_extra else []) + (["--yaw-quota", str(a.yaw_quota)] if a.yaw_quota > 0 else []) + (["--yaw-quota-profile", str(a.yaw_quota_profile)] if a.yaw_quota > 0 and a.yaw_quota_profile > 0 else []) + (["--select", a.select] if a.select != "time" else []) + ([f"--include-frames={a.include_frames}"] if a.include_frames else []) + ([f"--exclude-ms={a.prep_exclude_ms}"] if a.prep_exclude_ms else []) + ([f"--pose-trace={a.prep_pose_trace}"] if a.prep_pose_trace else []), log)
            if c: return {"status": "FAIL", "error": f"prepare_capture exit {c}"}
        P = json.load(open(pj, encoding="utf-8"))
        yaws = [i["yaw"] for i in P.get("images", []) if i.get("yaw") is not None]
        pitches = [i["pitch"] for i in P.get("images", []) if i.get("pitch") is not None]
        res = {"frames": P.get("images_kept"), "size": list(P.get("image_sizes", {}).keys()),
               "yaw_range": [round(min(yaws), 1), round(max(yaws), 1)] if yaws else None,
               "pitch_range": [round(min(pitches), 1), round(max(pitches), 1)] if pitches else None,
               "fixed_camera": P.get("fixed_camera")}
        warn = []
        if not yaws or min(yaws) > -35 or max(yaws) < 35: warn.append("좌우 35° 이상 회전 프레임 부족(측면 윤곽 제약이 약해짐)")
        if (res["frames"] or 0) < 40: warn.append("프레임 40장 미만")
        res["status"] = "FAIL" if (res["frames"] or 0) < 20 else ("WARN" if warn else "PASS"); res["notes"] = warn
        return res

    # 2 sfm
    def sfm():
        # features + matching only; the camera poses are solved in the lens step with the focal length fixed
        # (a free-focal start failed on the PC: "no good initial image pair" on face-only webcam features)
        c, out, sec = run([py, os.path.join(HERE, "sfm_sparse.py"), W, "--no-map"] + (["--cpu"] if a.cpu else []) + (["--repeatable"] if a.repeatable else []) + (["--keep-mask-background"] if a.sfm_keep_background else []), log)
        try: st = json.loads([l for l in out if l.startswith("{")][-1])
        except Exception: st = {}
        if c or not st.get("matches"): return {"status": "FAIL", "error": f"sfm exit {c}", "sec": sec}
        return {"status": "PASS", "images": st.get("images"), "masks": st.get("masks"), "features": st.get("features_type", "sift"), "sec": sec, "steps_sec": st.get("sec"),
                "engine": {"features": st.get("engine_features", "cpu"), "matching": st.get("engine_matching", "cpu")},
                **({"repeatable": {"verify_seeded": st.get("verify_seeded")}} if a.repeatable else {})}

    # 3 lens
    def lens():
        args = [py, os.path.join(ROOT, "tools", "colmap", "lens_anchor.py"), W]
        estimate = a.focal_estimate
        if lens_src and lens_src.get("focal35_mm"):
            # S15P31B204-565: the video's 35 mm record becomes px HERE, on the frames COLMAP sees (like device_focal).
            # One focal cannot fit frames of several sizes -> stop instead of building on a wrong camera.
            sizes = S.get("prepare", {}).get("size") or []
            if len(sizes) != 1:
                return {"status": "FAIL", "error": f"준비된 프레임 크기가 {len(sizes)}종류({sizes})라 초점 하나로 맞출 수 없음 "
                                                   "(영상 1개·한 가지 해상도로 다시 실행)"}
            from video_meta import focal_px_on_frame
            a.focal = focal_px_on_frame(lens_src["focal35_mm"], sizes[0], still=lens_src.get("still", False))
            rep["lens_source"] = {**lens_src, "focal_px": a.focal}
            print(f"   파일 렌즈값 35mm 환산 {lens_src['focal35_mm']} mm → 초점 {a.focal} px (프레임 {sizes[0]})", flush=True)
        if a.device and not a.focal:
            a.focal, rep["device"] = device_focal(a.device, (S.get("prepare", {}).get("size") or ["1080x1920"])[0])
            estimate = not profile_measured(a.device)
            print(f"   기기 렌즈 프로필 {a.device}: 초점 {a.focal:.0f} px" + (" (추정값: 실패하면 근처 탐색)" if estimate else ""), flush=True)
        if a.repeatable: args += ["--map-threads", "1"]
        if a.lens_gate_reliable: args += ["--yaw-max", "45", "--pitch-max", "20", "--skip-false-faces"]
        lj = os.path.join(W, "lens_anchor.json")
        sec, tried = 0.0, []
        long_side = frame_long_side((S.get("prepare", {}).get("size") or [None])[0])
        for search, rng in lens_attempts(a.focal, estimate, long_side):
            if tried: print(f"   렌즈 {tried[-1]} 실패 → " + ("추정값 근처 탐색" if search == "near" else "넓게 다시 탐색 " + ("~".join(rng[1::2]) + " px" if rng else "600~3000 px")), flush=True)
            if os.path.exists(lj): os.remove(lj)   # a stale result from an earlier run must not pass for this attempt
            c, out, s = run(args + rng, log); sec += s; tried.append(search)
            if not c and os.path.exists(lj): break
        if c or not os.path.exists(lj): return {"status": "FAIL", "error": f"lens_anchor exit {c}", "search": tried, "sec": sec}
        L = json.load(open(lj))
        if L["chosen"].get("signed_slope", -1) >= 0:
            return {"status": "FAIL", "error": "카메라 회전 방향이 고개 방향과 반대(얼굴 깊이가 뒤집힌 해). 다시 실행하거나 촬영 확인", "chosen": L["chosen"], "sec": sec}
        if L["chosen"].get("registered", 0) < 0.6 * (S.get("prepare", {}).get("frames") or 1):
            return {"status": "FAIL", "error": "카메라 위치 복원 실패(등록 프레임 60% 미만)", "chosen": L["chosen"], "sec": sec}
        sl = L["chosen"].get("slope_sfm_vs_mediapipe")
        pose_note = []
        ss = L["chosen"].get("signed_slope")
        if sl and ss is not None and abs(ss) / sl < POSE_DIR_RATIO_MIN:
            msg = (f"카메라 위치 복원 의심: 회전 방향 일치 {abs(ss) / sl:.2f} (정상 0.75~1.0, 기준 {POSE_DIR_RATIO_MIN} 이상). "
                   "한쪽 측면 카메라가 반대로 접힌 해일 수 있음 → 재촬영")
            if not a.no_pose_gate:
                return {"status": "FAIL", "error": msg, "chosen": L["chosen"], "sec": sec}
            pose_note.append(msg + " (--no-pose-gate: 계속 진행)")
        if sl is not None and sl < POSE_SLOPE_MIN:
            msg = (f"카메라 위치 복원 의심: SfM 회전이 고개 회전의 {sl:.2f}배 (정상 약 1.0, 기준 {POSE_SLOPE_MIN} 이상). "
                   "한쪽으로 돌린 구간의 카메라가 멈춘 해일 수 있음 → 재촬영(천천히, 좌우 끝까지, 배경과 머리 경계가 보이게)")
            if not a.no_pose_gate:
                return {"status": "FAIL", "error": msg, "chosen": L["chosen"], "sec": sec}
            pose_note.append(msg + " (--no-pose-gate: 계속 진행)")
        import pycolmap
        sides = side_registration({im.name for im in pycolmap.Reconstruction(L["sparse"]).images.values()},
                                  json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8")).get("images", []))
        short = short_sides(sides)
        if short:
            msg = ("카메라 위치 복원 실패: " + ", ".join(f"{'왼쪽' if k == 'left' else '오른쪽'} 측면 {r}/{n}장만 등록" for k, r, n in short)
                   + f"(기준 {SIDE_REG_MIN * 100:.0f}% 이상) → 그쪽 측면 형상을 만들 수 없음. 재촬영(그쪽으로 천천히, 머리 전체가 화면 안)")
            if not a.no_pose_gate:
                return {"status": "FAIL", "error": msg, "chosen": L["chosen"], "side_registered": sides, "sec": sec}
            pose_note.append(msg + " (--no-pose-gate: 계속 진행)")
        fold = None
        if a.lens_gate_reliable:
            # side frames registered far from their expected angle (MediaPipe where reliable, time interpolation in the
            # profiles) = a folded side (pipeline/pose_gate.py; folded 58-100 % vs straight 0-5 %, 10/24)
            sys.path.insert(0, HERE); from pose_gate import fold_check
            fold = fold_check(L["sparse"], json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8")))
            if fold.get("side_off_share") is not None and fold["side_frames"] >= 5 and fold["side_off_share"] > POSE_FOLD_MAX:
                msg = (f"카메라 위치 복원 의심: 측면 프레임의 {fold['side_off_share'] * 100:.0f}%가 예상 각도에서 30° 넘게 어긋남(기준 {POSE_FOLD_MAX * 100:.0f}%). "
                       "한쪽 측면이 정면 쪽으로 접힌 해 → 재촬영(머리 전체가 화면 안, 천천히) 또는 다시 실행")
                if not a.no_pose_gate:
                    return {"status": "FAIL", "error": msg, "chosen": L["chosen"], "fold": fold, "sec": sec}
                pose_note.append(msg + " (--no-pose-gate: 계속 진행)")
        fov = L.get("fov_h_deg") or 0
        # fixed: known lens, no search. near: searched around the device value, so its field of view is not judged
        lens_ok = tried[-1] == "fixed" or (L["status"] == "ok" and (tried[-1] == "near" or 45 <= fov <= 80))
        return {"status": "PASS" if (lens_ok and not pose_note) else "WARN", "focal_px": L["chosen"]["f"], "search": tried,
                "notes": pose_note + ([] if lens_ok else [f"렌즈 추정 의심(가로 화각 {fov}°). 얼굴만 보이는 영상에서는 초점값이 잘 정해지지 않는다. "
                                             "기종별 초점값을 --focal 로 넣는 것을 권장"]),
                "slope": L["chosen"].get("slope_sfm_vs_mediapipe"), "fov_h_deg": L.get("fov_h_deg"), "signed_slope": L["chosen"].get("signed_slope"),
                "depth_reversed_rejected": L["chosen"].get("depth_reversed_rejected"), **({"fold": fold, "gate_frames": L.get("gate_frames")} if fold else {}),
                "registered": L["chosen"].get("registered"), "side_registered": sides, "sparse": L["sparse"], "sec": sec, "map_threads": L.get("map_threads", -1),
                "trials": [{"f": t.get("f"), "slope": t.get("slope_sfm_vs_mediapipe"), "sec": t.get("sec")} for t in L.get("trials", [])]}

    # 4 model
    def model():
        sparse = S["lens"]["sparse"]
        dense_args = []
        if a.dense:
            dj = S.get("dense", {})
            if not dj or (a.redo in ("sfm", "lens", "model") and dj.get("status") != "PASS"):
                c0, out0, sec0 = run([py, os.path.join(HERE, "dense_mvs.py"), W, sparse] + (["--force"] if a.redo in ("sfm", "lens") else []), log)
                try: dj = json.loads([l for l in out0 if l.startswith("{")][-1])
                except Exception: dj = {"status": "failed"}
                dj["sec"] = sec0; dj["status"] = "PASS" if dj.get("status") in ("ok", "cached") else "WARN"; S["dense"] = dj; save()
                print(f"[dense] {dj['status']} {json.dumps(dj, ensure_ascii=False)[:300]}", flush=True)
            fz = os.path.join(W, "colmap", "dense", "fused.ply")
            if os.path.exists(fz): dense_args = ["--dense", fz, "--dense-region", "nose"]
        dense_args += (["--nostril-fit"] if a.nostril_fit else []) + (["--alar-width", "photo"] if a.alar_width == "photo" else [])
        dense_args += ["--nose-protection", a.nose_protection] + (["--nose-profile"] if a.nose_profile else []) + ["--nose-fit", a.nose_fit]   # always explicit: both defaults are joint
        if a.shape_only: dense_args += ["--shape-only"]
        eye_x = (a.eye_parts_extra if a.eye_parts_plain else f"{EYE_PARTS_DEFAULT} {a.eye_parts_extra}").strip() if a.eye_parts else ""
        eye_args = ([] if a.eye_parts_plain or not a.eye_parts else ["--eye-parts-post"]) + ([f"--eye-parts-extra={eye_x}"] if eye_x else [])
        c, out, sec = run([py, os.path.join(HERE, "scan_to_model.py"), "--work", W, "--sparse", sparse, "--case-id", f"{a.id}-model", "--even-light", str(a.even_light)] + (["--no-eye-color"] if a.service else []) + (["--select-max-crease", str(a.select_max_crease)] if a.select_max_crease > 0 else []) + (["--select-prefer", a.select_prefer] if a.select_prefer else []) + ([f"--gnm-extra={a.gnm_extra}"] if a.gnm_extra else []) + (["--eye-parts"] if a.eye_parts else []) + (["--detail"] if a.detail else []) + ([f"--detail-extra={a.detail_extra}"] if a.detail_extra else []) + (["--no-lm"] if a.no_lm else []) + eye_args + (__import__("shlex").split(a.model_extra) if a.model_extra else []) + dense_args + (["--force"] if (a.force or a.redo in ("sfm", "lens", "model")) else []), log)
        rj = os.path.join(W, "model", "report.json")
        if c or not os.path.exists(rj): return {"status": "FAIL", "error": f"scan_to_model exit {c}", "sec": sec}
        R = json.load(open(rj))
        acc = R.get("accept", {})
        fails = [k for k, v in acc.items() if v.get("pass") is False]
        eye = os.path.exists(os.path.join(W, "model", "eye_color.json"))
        res = {"holdout_pct_iod": {k: v.get("value") for k, v in acc.items()}, "chosen": R.get("chosen"),
               "eye_colour_measured": eye, "case": R.get("case"), "sec": sec, "steps_sec": R.get("timing_this_run_sec", R.get("timing_sec"))}
        # how far the head really turned (all registered frames, incl. the profiles without a face): informational
        try:
            sys.path.insert(0, HERE); from view_coverage import coverage
            vc = coverage(os.path.join(W, "model"))
            res["view_coverage"] = {k: vc[k] for k in ("yaw_min_deg", "yaw_max_deg", "frames_beyond_75", "frames_without_face", "profile_ok")}
            res["view_coverage"]["side_turn_vs_mediapipe"] = vc.get("side_turn_vs_mediapipe")
            if not vc["profile_ok"]:
                res["coverage_note"] = "좌우 75° 이상 프레임이 한쪽 3장 미만: 옆선(콧대·인중·턱끝) 관측이 약함 → 좌우 90° 촬영 권장"
        except Exception as ex:
            res["view_coverage"] = {"error": str(ex)[:200]}; vc = {}
        # per-person hairline (S15P31B204-328, 2026-11-04): model/hairline.json for hair assets / the bald texture. It changes
        # neither the shape nor the texture, so it is on by default; a failure is only recorded and never stops the build
        hj = os.path.join(W, "model", "hairline.json")
        if os.path.exists(hj): os.remove(hj)   # from an earlier fit: never left beside a new model when this run fails / skips it
        if not a.no_hairline:
            hc, hout, hsec = run([py, os.path.join(HERE, "hairline.py"), W], log)
            res["hairline"] = {"status": "ok", "sec": hsec, "line": (hout[-1] if hout else "")[:200]} if hc == 0 and os.path.exists(hj) \
                else {"status": "failed", "sec": hsec, "error": f"hairline.py exit {hc}"}
        # bald skin maps (S15P31B204-68, 2026-11-05): the head is shown bald with hair assets on top, so head.glb gets skin
        # maps without the painted hair (face = photo, behind the face line = matched skin colour). Never stops the build:
        # without them head.glb keeps the maps as baked
        for n_ in ("tex_skin_bald.png", "tex_skin_albedo_bald.png", "bald_skin.json"):
            if os.path.exists(os.path.join(W, "model", n_)): os.remove(os.path.join(W, "model", n_))
        if not a.no_bald and not a.shape_only:
            if os.path.exists(hj):
                bc, _, bsec = run([py, os.path.join(HERE, "bald_skin.py"), W], log)
                res["bald_skin"] = {"status": "ok", "sec": bsec} if bc == 0 and os.path.exists(os.path.join(W, "model", "tex_skin_bald.png")) \
                    else {"status": "failed", "sec": bsec, "error": f"bald_skin.py exit {bc}"}
            else:
                res["bald_skin"] = {"status": "skipped", "error": "no hairline.json"}
        warn = []
        bad = [f"{'왼쪽' if k == 'neg' else '오른쪽'} {v['median_deg']}°" for k, v in (vc.get("side_turn_vs_mediapipe") or {}).items()
               if v.get("frames", 0) >= 3 and v.get("median_deg") is not None and v["median_deg"] < POSE_SIDE_MIN_DEG]
        try:   # turn range per side: SfM (all registered frames) vs MediaPipe (frames with a face)
            mpy = [i_.get("yaw") for i_ in json.load(open(os.path.join(W, "prep", "prepare.json"), encoding="utf-8"))["images"] if i_.get("yaw") is not None]
            if mpy and vc.get("yaw_min_deg") is not None:
                if min(mpy) <= -35 and vc["yaw_min_deg"] > min(mpy) + POSE_RANGE_SHORT_DEG:
                    bad.append(f"왼쪽 회전 범위 SfM {vc['yaw_min_deg']}° vs MediaPipe {round(min(mpy), 1)}°")
                if max(mpy) >= 35 and vc["yaw_max_deg"] < max(mpy) - POSE_RANGE_SHORT_DEG:
                    bad.append(f"오른쪽 회전 범위 SfM {vc['yaw_max_deg']}° vs MediaPipe {round(max(mpy), 1)}°")
        except Exception:
            pass
        if bad:
            res["pose_check"] = "FAIL"
            warn.append(f"카메라 위치 복원 실패: 고개를 돌린 쪽에서 SfM 회전이 MediaPipe보다 작음 ({', '.join(bad)}, 기준 {POSE_SIDE_MIN_DEG}°) "
                        "→ 그쪽 측면 형상이 틀림. 재촬영")
        if not eye and not a.shape_only: warn.append("눈 색 측정 실패(정면·시선 정면 프레임 부족) → 기본 색")
        if a.shape_only: res.update(shape_only=True, eye_colour_measured=False, case=None)
        # the model is still built when a hold-out band misses its limit; the gate says what to recapture
        res["status"] = "WARN" if (fails or warn) else "PASS"; res["notes"] = warn + [f"홀드아웃 불합격: {f}" for f in fails]
        return res

    # 5 viewer
    def viewer():
        M = os.path.join(W, "model")
        if a.shape_only:
            from scan_to_model import file_sha
            rep = json.load(open(os.path.join(M, "report.json"), encoding="utf-8"))
            ch = rep["chosen"]; cur = file_sha(os.path.join(M, f"fit_{ch}.ply"))
            if not rep.get("shape_only") or rep.get("provenance", {}).get("fit_sha") != cur:
                return {"status": "FAIL", "error": "shape-only report does not match final fit"}
            total = 0.0
            for script, extra in [("export_glb.py", ["--gray"]), ("glb_frames.py", ["--sparse", S["lens"]["sparse"]]),
                                  ("glb_rig.py", ["--sparse", S["lens"]["sparse"]])]:
                c, _, elapsed = run([py, os.path.join(ROOT, "tools", script), W] + extra, log)
                total += elapsed
                if c: return {"status": "FAIL", "error": f"shape-only {script} failed"}
            c, out, elapsed = run([py, os.path.join(ROOT, "tools", "check_glb.py"), os.path.join(M, "head.glb")], log)
            if c: return {"status": "FAIL", "error": "shape-only GLB check failed"}
            meta = json.load(open(os.path.join(M, "head.glb.json")))
            if meta.get("fit_sha") != cur or any(meta.get("maps", {}).values()):
                return {"status": "FAIL", "error": "gray export fit/maps mismatch"}
            return {"status": "PASS", "shape_only": True, "shown": ch, "fit_sha": cur, "sec": round(total + elapsed, 1),
                    "glb": os.path.join(M, "head.glb"), "glb_viewer": f"npm.cmd run glb -- {a.id}"}
        # the 360° viewer (viewer_data.py + build_viewer.mjs) is optional since W13 E4 (2026-10-20): the team share leaves
        # it out and uses the glb viewer only (photo overlay, nose / eye editing, expression tracking) -> then the glb
        # outputs below are required instead of being a note
        has360 = os.path.exists(os.path.join(ROOT, "tools", "viewer_data.py")) and os.path.exists(os.path.join(ROOT, "tools", "build_viewer.mjs"))
        sec = sec2 = 0.0
        if has360:
            c, out, sec = run([py, os.path.join(ROOT, "tools", "viewer_data.py"), W, "--sparse", S["lens"]["sparse"],
                               "--out", os.path.join(M, "viewer_data.js")], log)
            if c: return {"status": "FAIL", "error": f"viewer_data exit {c}"}
            node = "node.exe" if os.name == "nt" else "node"
            c, out, sec2 = run([node, os.path.join(ROOT, "tools", "build_viewer.mjs"), os.path.join(M, "viewer_data.js"), os.path.join(M, "viewer.html")], log)
            if c: return {"status": "FAIL", "error": f"build_viewer exit {c}"}
        # consistency gate (2026-10-16: the viewer kept showing "lm" after "gnm" was chosen - nobody noticed for a run):
        # the viewer must show the chosen fit, and the texture must have been baked on exactly that fit
        sys.path.insert(0, HERE); from scan_to_model import file_sha
        rep = json.load(open(os.path.join(M, "report.json"))); ch = rep.get("chosen", "lm")
        try: tex = json.load(open(os.path.join(M, "tex.source.json")))
        except Exception: tex = {}
        cur = file_sha(os.path.join(M, f"fit_{ch}.ply"))
        problems = []
        if has360:
            vd = open(os.path.join(M, "viewer_data.js"), encoding="utf-8").read()
            import re as _re
            bm = _re.search(r'"build":\s*(\{[^}]*\})', vd); build = json.loads(bm.group(1)) if bm else {}
            if build.get("shown") != ch: problems.append(f"뷰어 표시 모델 {build.get('shown')} ≠ 채택 {ch}")
        if tex and (tex.get("of") != ch or tex.get("fit") != cur): problems.append(f"텍스처가 다른 fit에서 구워짐 ({tex})")
        if (rep.get("provenance") or {}).get("fit_sha") not in (None, cur): problems.append("report의 fit 기록과 현재 fit 파일이 다름")
        if problems: return {"status": "FAIL", "error": "; ".join(problems), "viewer": os.path.join(M, "viewer.html") if has360 else None}
        print(f"  뷰어 = 채택 모델 {ch} (fit {cur}, 모델 계산 {(rep.get('provenance') or {}).get('time')})", flush=True)
        # W8 (2026-10-20): the result as one glTF file (shape + UV + maps + eyes + region / landmark / scalp metadata)
        # + W13: frame cameras (photo overlay) and edit / expression data (rig.json) in glb coordinates for the glb viewer
        glb, notes = {}, []
        det = (rep.get("detail") or {}) if isinstance(rep.get("detail"), dict) else {}
        if det.get("out") and os.path.exists(os.path.join(M, f"fit_{ch}_detail.ply")) and (tex.get("detail") or None) == file_sha(os.path.join(M, f"fit_{ch}_detail.ply")):
            c3, out3, sec3 = run([py, os.path.join(ROOT, "tools", "export_glb_detail.py"), W, "--lifted", os.path.join(M, f"fit_{ch}_detail.ply"), "--in-place"], log)
        else:
            # --bald: the bald skin maps when bald_skin.py made them (export_glb keeps the baked maps otherwise)
            c3, out3, sec3 = run([py, os.path.join(ROOT, "tools", "export_glb.py"), W] + ([] if a.no_bald else ["--bald"]), log)
        if c3 == 0:
            c4, out4, _ = run([py, os.path.join(ROOT, "tools", "check_glb.py"), os.path.join(M, "head.glb")], log)
            try: glb = json.loads([l for l in out4 if l.startswith("{")][-1])
            except Exception: glb = {"ok": False}
            c5, _, _ = run([py, os.path.join(ROOT, "tools", "glb_frames.py"), W, "--sparse", S["lens"]["sparse"]], log)
            if c5 != 0: notes.append("frames.json 실패 (glb 뷰어 사진 겹침만 안 됨)")
            c6, _, _ = run([py, os.path.join(ROOT, "tools", "glb_rig.py"), W, "--sparse", S["lens"]["sparse"]], log)
            if c6 != 0: notes.append("rig.json 실패 (glb 뷰어 편집·표정만 안 됨)")
        if not glb.get("ok"):
            if not has360: return {"status": "FAIL", "error": "head.glb 내보내기·검사 실패 (run_all.log 확인) - 뷰어가 없음"}
            notes.append("head.glb 내보내기·검사 실패 (run_all.log 확인), 360° 뷰어는 정상")
        res_ = {"status": "PASS", "viewer": os.path.join(M, "viewer.html") if has360 else None, "glb_viewer": f"npm.cmd run glb -- {a.id}",
                "shown": ch, "fit_sha": cur, "sec": round(sec + sec2 + sec3, 1),
                "glb": os.path.join(M, "head.glb") if glb.get("ok") else None, "glb_check": glb.get("errors") if glb else "export failed"}
        if notes: res_["notes"] = notes
        return res_

    if a.sparse:
        import pycolmap
        r = pycolmap.Reconstruction(a.sparse)
        sfm = lambda: {"status": "PASS", "provided": a.sparse, "registered": r.num_reg_images()}
        lens = lambda: {"status": "PASS", "provided": a.sparse, "sparse": os.path.abspath(a.sparse),
                        "focal_px": float(list(r.cameras.values())[0].params[0])}
    fns = {"prepare": prepare, "sfm": sfm, "lens": lens, "model": model, "viewer": viewer}
    for name in order:
        if not stage(name, fns[name]):
            print(f"중단: {name} 단계 실패 - {log} 확인"); rep["overall"] = "FAIL"; save(); sys.exit(1)
        if name == a.until: break
    st = [S[n]["status"] for n in order if n in S]
    # quality check with limits that hold for every capture (2026-10-19: a code change brought creases in and no gate saw
    # it). Never blocks the output, but a problem is reported and the run is not PASS. The comparison with an accepted
    # earlier result (qa_baseline.json) was removed on 2026-10-24 (만두): the baselines were inaccurate models.
    if "model" in S and a.until in ("model", "viewer"):
        c, out, sec = run([py, os.path.join(ROOT, "tools", "qa_check.py"), W] + (["--no-render"] if a.service else []), log)
        try: qa = json.loads([l for l in out if l.startswith("{")][-1])
        except Exception: qa = {"status": "ERROR"}
        rep["qa"] = {k: qa.get(k) for k in ("status", "problems", "warnings", "notes")}
        rep["qa"]["current"] = qa.get("current")
        print(f"[qa] {qa.get('status')}  " + "; ".join((qa.get("problems") or []) + (qa.get("notes") or [])), flush=True)
        for wmsg in qa.get("warnings") or []: print(f"     주의: {wmsg}", flush=True)
        if qa.get("warnings"): st.append("WARN")
        if not a.service: print(f"     회색 모델 그림: {os.path.join(W, 'model', 'qa_gray.png')}", flush=True)
        if qa.get("status") == "FAIL": st.append("WARN")
    if S.get("model", {}).get("pose_check") == "FAIL" and not a.no_pose_gate: st.append("FAIL")
    rep["overall"] = "FAIL" if "FAIL" in st else ("WARN" if "WARN" in st else "PASS"); save()
    print(f"완료: {rep['overall']}  (보고서 {rp})")
    if "viewer" in S:
        if S["viewer"].get("viewer"): print(f"360° 뷰어: {S['viewer']['viewer']}  또는  npm.cmd run viewer -- {a.id}")
        print(f"glb 뷰어 (사진 겹침·성형 편집·표정 트래킹): npm.cmd run glb -- {a.id}")


if __name__ == "__main__":
    main()
