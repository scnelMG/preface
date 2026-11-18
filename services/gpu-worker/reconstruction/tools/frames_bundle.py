"""Frames bundle (lm-frames/1) for the split pipeline (2026-10-26, BE design: the EC2 worker extracts the frames, the
video is deleted, the GPU worker gets one bundle). The frame selection is NOT re-implemented: `extract` runs the
unchanged pipeline up to the prepare stage (prepare_capture.py: even time slots, sharpest frame per slot, blur / blink
rejection, MediaPipe pose, masks) and packs it with the lens record read from the video file - after the video is
deleted the GPU side cannot read it, and without the recorded focal length it would search the lens (other cameras,
other shape).

  extract (EC2, CPU only):  python tools/frames_bundle.py extract <video file> <frames.tar> [--job-id ID] [--device PROFILE]
                            [--capture-trace trace.json]
      stdout: one JSON line {bundle, bytes, sha256, frames, frameCount, focalPx, focalSource, quality, failCode, angle,
      extractSec}
      (contracts/frame-extraction "추출 명령": the EC2 worker reads `frames`; the video may be a file without extension)
      exit 0 = bundle made (PASS / WARN), 2 = quality failure (bundle still written, quality.proceed = false)
  run (GPU worker)       :  python tools/frames_bundle.py run <frames.tar> --id <run id> [run_all.py options ...]
      e.g. python tools/frames_bundle.py run frames.tar --id job123 --shape-only --no-lm

frames.tar (uncompressed: JPEG / PNG do not compress)
  manifest.json   format "lm-frames/1", jobId, sourceVideo {file, sha256, bytes, fps, seconds}, frameCount, quality
                  {status PASS|WARN|FAIL, failCode, proceed, notes, advice, angle}, extractSec, versions, files {path: sha256}
  lens.json       focalPx (number|null, the value the GPU uses), focalSource ("file"|"same-model file"|"device profile"|
                  "none"), focal35mm, deviceMake, deviceModel, lensModel, deviceProfile, imageWidth, imageHeight
  prepare.json    prepare_capture output (input_dir reduced to the folder name: no local paths)
  images/*.jpg    selected frames (long side up to 1920 px, run_all FRAME_MAX_SIDE; EXIF rotation applied)
  masks/*.png     head masks, only when prepare_capture made them (fixed-camera captures)
Quality: run_all.py's prepare stage status, and FAIL when fewer than 20 frames have a face -> failCode QUALITY_NO_FACE
(prepare keeps frames without a face, so its status alone passes a video with no face; S15P31B204-374).
Angle (S15P31B204-662, plan S1-1): the GPU worker's 5-view pick (app/reconstruction/worker.py pick_captures) fails with
QUALITY_ANGLE when the most-turned face frame of one side is under SIDE_MIN_DEG or no frame is within FRONT_MAX_DEG of
frontal. It reads this same prepare.json, so the same rule here fails such a video before any GPU job (it used to be only
a WARN here and fail at the very end). Web recordings carry the guide's head-angle trace (claim capture.trace): it is
re-checked, compared with the frame yaw (dropped with a note when they disagree) and used only to tell WHY a side is
short - "turn" (the head never turned that far) or "selection" (it did, but no selected frame has it: S1-6 / S1-2).
The trace does not pass a video: the GPU can only use the frames in the bundle.
Personal data: frames are face photos - same retention as the video. This tool uploads nothing.
"""
import argparse, hashlib, io, json, os, shutil, subprocess, sys, tarfile, tempfile, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
FORMAT = "lm-frames/1"
VIDEO_EXT = (".mov", ".mp4", ".m4v", ".avi", ".mkv")
MIN_FACE_FRAMES = 20   # contracts/frame-extraction "품질 실패": fewer frames with a face -> QUALITY_NO_FACE
# Same values as app/reconstruction/worker.py SIDE_MIN_DEG / FRONT_MAX_DEG (tests/test_frames_bundle.py keeps them equal).
# 35 vs the web guide's 50 deg is open (plan S1-1, meeting): change both together.
SIDE_MIN_DEG = 35.0
FRONT_MAX_DEG = 15.0
# capture.trace (contracts/frame-extraction claim-response capture.trace, written by the web guide)
TRACE_MAX_POINTS = 2000
TRACE_MIN_FOUND = 20     # fewer face samples than this: the trace says nothing about the turn
TRACE_TOL_DEG = 12.0     # web vs server MediaPipe on the same video: the trace (20 Hz) should reach at least the frames' range


def usable_faces(images):
    """Frames pick_captures may use: a real face, not a marker photo, with a yaw."""
    return [im for im in images if im.get("face") and not im.get("false_face") and not im.get("marker") and im.get("yaw") is not None]


def read_trace(path):
    """capture.trace file -> list of found yaw values, or (None, reason). The server checked only the counts and the time
    order, so the values are checked again here; anything off drops the whole trace (it is optional)."""
    if not path: return None, None
    try: tr = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError): return None, "trace 파일을 읽지 못함"
    if not isinstance(tr, dict) or tr.get("version") != 1: return None, f"trace 형식 버전 {tr.get('version') if isinstance(tr, dict) else '?'}"
    pts = tr.get("trace")
    if not isinstance(pts, list) or not pts or len(pts) > TRACE_MAX_POINTS: return None, "trace 표본 수가 범위 밖"
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")
    yaws, last = [], -1.0
    for p in pts:
        if not (isinstance(p, list) and len(p) == 4 and num(p[0]) and p[0] >= last and p[3] in (0, 1) and not isinstance(p[3], bool)):
            return None, "trace 표본 모양이 틀림"
        last = p[0]
        if p[3] == 1:
            if not (num(p[1]) and num(p[2]) and abs(p[1]) <= 180 and abs(p[2]) <= 90): return None, "trace 각도 값이 틀림"
            yaws.append(float(p[1]))
        elif p[1] is not None or p[2] is not None: return None, "trace 얼굴 없는 표본에 각도가 있음"
    if len(yaws) < TRACE_MIN_FOUND: return None, f"trace 얼굴 표본 {len(yaws)}개 (기준 {TRACE_MIN_FOUND}개 미만)"
    return yaws, None


# S15P31B204-667 (plan S1-6): web guide recordings end with a front pose and, when the steps were quick, a wait at the
# front until the 24 s minimum. Even time slots spend many of the 100 frames there (6 originals, frontal dwell cut in a
# 600-frame simulation: front 301 -> 239, 15-75 deg +49, 75+ deg +13, largest yaw gap 11.3 -> 9.0 deg, no extra time).
# Switch EXTRACT_TRACE_CUT=1 (default off until web recordings on dev confirm the time mapping).
TRACE_CUT_ENV = "EXTRACT_TRACE_CUT"
# The guide writes a step's name when the PREVIOUS step is done, and the previous step's hold (1 s at a side or head
# pose, 2 s at the front, longer while the voice speaks) comes first in it (guideEngine.ts record(): stepIndex++ then
# holdUntil). So the 2nd backfront starts with the chin-down hold, the 1st backfront with the left-end hold.
GUIDE_ORDER = ["recleft", "sweepleft", "backfront", "headup", "headdown", "backfront"]
TRACE_CUT_GUIDES = {"live-capture-2026-11-07": GUIDE_ORDER, "live-capture-2026-11-08": GUIDE_ORDER}
TRACE_CUT_DURATION_TOL_MS = 1500.0   # trace end vs video length
TRACE_CUT_MIN_FRONT_MS = 1500.0      # frontal (|yaw| < 12, face found) time that must stay after the cuts
TRACE_CUT_MIN_KEEP_MS = 10000.0
TRACE_CUT_FRONT_DEG = 12.0
TRACE_CUT_FRONT_PITCH_DEG = 8.0      # back at the front: pitch near the front hold's
TRACE_CUT_HOLD_MS = 1000.0           # shortest hold of a side / head pose
TRACE_CUT_SUSTAIN_MS = 300.0         # a pose counts after this long (one-frame tracker jumps at the profile do not)
TRACE_CUT_RETURN_DEG = 45.0          # left-end return: from inside 45 deg (MediaPipe is reliable there) to the front


def _sustained(rows, t0, t1, ok):
    """First time in [t0, t1) from which ok(row) holds for TRACE_CUT_SUSTAIN_MS without a break; None when never."""
    start = None
    for r in rows:
        if r[0] < t0: continue
        if r[0] >= t1: break
        if ok(r):
            start = r[0] if start is None else start
            if r[0] - start >= TRACE_CUT_SUSTAIN_MS: return start
        else:
            start = None
    return None


def trace_cut(path, video_ms, enabled=None):
    """Time ranges of the video to leave out of the frame choice, from the web guide's steps -> {applied, excludeMs,
    cuts, frontKeptMs, reason}. Two duplicates are cut, each only when it is found cleanly:
      closing   the return to the front after the chin-down hold, the 2 s front and the wait to the 24 s minimum
      leftReturn  the way back from the left end to the front (the sweep already passed these angles; the right side
                is recorded once, so the left side got them twice). The left-end hold itself stays
    The sweep, both side holds, the first front hold and the head up / down holds stay. Any doubt (switch off, no /
    broken trace, unknown guide or step order, trace length off the video, too little front or length left) ->
    applied False and the frames are chosen as before."""
    on = os.environ.get(TRACE_CUT_ENV) == "1" if enabled is None else enabled
    if not on: return {"applied": False, "reason": "off"}
    if not path: return {"applied": False, "reason": "no trace"}
    pts, note = read_trace(path)
    if pts is None: return {"applied": False, "reason": note or "trace unreadable"}
    tr = json.load(open(path, encoding="utf-8"))
    order = TRACE_CUT_GUIDES.get(tr.get("guideVersion"))
    if not order: return {"applied": False, "reason": f"unknown guideVersion {tr.get('guideVersion')}"}
    steps = tr.get("steps") if isinstance(tr.get("steps"), list) else []
    names = [s.get("name") for s in steps if isinstance(s, dict)]
    if names != order:
        return {"applied": False, "reason": f"steps {names} (need {order})"}
    try: start = [float(s["startMs"]) for s in steps]
    except (KeyError, TypeError, ValueError): return {"applied": False, "reason": "a step has no startMs"}
    rows = tr["trace"]
    end_ms = max(float(rows[-1][0]), float((tr.get("meta") or {}).get("durationMs") or 0))
    if not video_ms or abs(end_ms - video_ms) > TRACE_CUT_DURATION_TOL_MS:
        return {"applied": False, "reason": f"trace {end_ms:.0f} ms vs video {video_ms or 0:.0f} ms"}
    found = lambda r: r[3] == 1
    front_rows = [r for r in rows if found(r) and start[3] <= r[0] < start[3] + 2000 and abs(r[1]) < TRACE_CUT_FRONT_DEG]
    if not front_rows: return {"applied": False, "reason": "no front hold before head up"}
    pitch0 = sorted(r[2] for r in front_rows)[len(front_rows) // 2]
    cuts, ranges = {}, []
    # closing: after the chin-down hold, the first sustained frontal pose (yaw and pitch back at the front hold's)
    close = _sustained(rows, start[5] + TRACE_CUT_HOLD_MS, end_ms + 1, lambda r: found(r) and abs(r[1]) < TRACE_CUT_FRONT_DEG
                       and abs(r[2] - pitch0) < TRACE_CUT_FRONT_PITCH_DEG)
    if close is None: cuts["closing"] = "no return to the front after the chin-down hold"
    else:
        ranges.append([close, max(end_ms, video_ms) + 1000]); cuts["closing"] = {"fromMs": round(close)}
    # left return: after the left-end hold, inside 45 deg on the LEFT side (the sweep's end sign) until the front is held
    tail = [r[1] for r in rows if found(r) and start[2] - 1000 <= r[0] < start[2]]
    side = (1 if sum(tail) > 0 else -1) if tail else 0
    ret = None if not side else _sustained(rows, start[2] + TRACE_CUT_HOLD_MS, start[3], lambda r: found(r)
                                           and 0 < side * r[1] < TRACE_CUT_RETURN_DEG)
    if ret is None or not 300 <= start[3] - ret <= 8000: cuts["leftReturn"] = "no clean return from the left end"
    else:
        ranges.append([ret, start[3]]); cuts["leftReturn"] = {"fromMs": round(ret), "toMs": round(start[3])}
    if not ranges: return {"applied": False, "cuts": cuts, "reason": "nothing found to cut"}
    inside = lambda t: any(s <= t <= e for s, e in ranges)
    front, prev = 0.0, None
    for r in rows:
        if prev is not None and not inside(r[0]) and found(r) and abs(r[1]) < TRACE_CUT_FRONT_DEG: front += min(r[0] - prev, 100.0)
        prev = r[0]
    kept = end_ms - sum(min(e, end_ms) - s for s, e in ranges)
    if front < TRACE_CUT_MIN_FRONT_MS: return {"applied": False, "cuts": cuts, "reason": f"front left {front:.0f} ms"}
    if kept < TRACE_CUT_MIN_KEEP_MS: return {"applied": False, "cuts": cuts, "reason": f"only {kept:.0f} ms left"}
    return {"applied": True, "excludeMs": [[round(s), round(e)] for s, e in sorted(ranges)], "cuts": cuts,
            "frontKeptMs": round(front), "keptMs": round(kept), "reason": "duplicate guide segments"}


# DEFAULT since 2026-11-09 (만두: on with the merge; EXTRACT_POSE_SLOTS=0 = time slots as before): spreads the frames over NEW head poses from the web guide trace
# (pipeline/frame_slots.trace_progress) instead of over time, so pauses, voice waits and poses seen twice add no frames
# wherever they happen (trace_cut only knows two guide steps). Any guide version; checks: a readable trace, its length
# within TRACE_CUT_DURATION_TOL_MS of the video. Applied -> trace_cut is not used.
POSE_SLOTS_ENV = "EXTRACT_POSE_SLOTS"


def pose_slots(path, video_ms, enabled=None):
    """-> {applied, reason}: may the trace place the frames (frame_slots progress) for this video?"""
    on = os.environ.get(POSE_SLOTS_ENV, "1") != "0" if enabled is None else enabled
    if not on: return {"applied": False, "reason": "off"}
    if not path: return {"applied": False, "reason": "no trace"}
    yaws, note = read_trace(path)
    if yaws is None: return {"applied": False, "reason": note or "trace unreadable"}
    with open(path, encoding="utf-8") as f: tr = json.load(f)
    end_ms = max(float(tr["trace"][-1][0]), float((tr.get("meta") or {}).get("durationMs") or 0))
    if not video_ms or abs(end_ms - video_ms) > TRACE_CUT_DURATION_TOL_MS:
        return {"applied": False, "reason": f"trace {end_ms:.0f} ms vs video {video_ms or 0:.0f} ms"}
    return {"applied": True, "reason": "pose slots"}


def video_length_ms(path):
    """Video length from the container (frame count / fps); None when unreadable."""
    try:
        import cv2
        cap = cv2.VideoCapture(path); n = cap.get(cv2.CAP_PROP_FRAME_COUNT); fps = cap.get(cv2.CAP_PROP_FPS); cap.release()
        return n / fps * 1000.0 if n > 0 and fps > 0 else None
    except Exception:
        return None


def angle_check(images, trace_yaws=None, trace_note=None):
    """Same rule as pick_captures on the bundle's prepare.json images -> {status PASS|FAIL, short, yawMin, yawMax,
    frontYaw, sideMinDeg, trace}. No usable face at all is face_check's QUALITY_NO_FACE, not this."""
    ok = usable_faces(images)
    if not ok: return None
    lo, hi = min(im["yaw"] for im in ok), max(im["yaw"] for im in ok)
    front = min((im["yaw"] for im in ok), key=abs)
    short = [side for side, deg in (("LEFT", -lo), ("RIGHT", hi)) if deg < SIDE_MIN_DEG]
    tr = None
    if trace_yaws is not None:
        tlo, thi = min(trace_yaws), max(trace_yaws)
        tr = {"yawMin": round(tlo, 1), "yawMax": round(thi, 1), "used": tlo <= lo + TRACE_TOL_DEG and thi >= hi - TRACE_TOL_DEG}
        if not tr["used"]:
            mirrored = -thi <= lo + TRACE_TOL_DEG and -tlo >= hi - TRACE_TOL_DEG
            tr["note"] = "trace 각도가 프레임 각도 범위와 맞지 않아 버림" + (" (좌우 부호 반대 의심)" if mirrored else "")
        else:
            # did the head turn far enough on the short side? yes -> the frames missed it (selection), no -> turn more
            tr["cause"] = {side: "selection" if (-tlo if side == "LEFT" else thi) >= SIDE_MIN_DEG else "turn" for side in short}
    elif trace_note:
        tr = {"used": False, "note": trace_note}
    status = "FAIL" if short or abs(front) > FRONT_MAX_DEG else "PASS"
    return {"status": status, "short": short or (["FRONT"] if status == "FAIL" else []), "yawMin": round(lo, 1), "yawMax": round(hi, 1),
            "frontYaw": round(front, 1), "sideMinDeg": SIDE_MIN_DEG, "trace": tr}


def apply_angle(status, notes, angle):
    """QUALITY_NO_FACE (status already FAIL) wins; otherwise a failed angle check makes the bundle QUALITY_ANGLE."""
    if status == "FAIL" or not angle or angle["status"] != "FAIL": return status, notes, "QUALITY_NO_FACE" if status == "FAIL" else None
    sides = {"LEFT": f"왼쪽 {-angle['yawMin']:.0f}°", "RIGHT": f"오른쪽 {angle['yawMax']:.0f}°", "FRONT": f"정면에 가장 가까운 {angle['frontYaw']:.0f}°"}
    msg = "회전 부족: " + ", ".join(sides[s] for s in angle["short"]) + f" (옆 기준 {SIDE_MIN_DEG:.0f}°, 정면 기준 {FRONT_MAX_DEG:.0f}°)"
    return "FAIL", notes + [msg], "QUALITY_ANGLE"


def face_check(status, notes, images):
    """Count the frames where MediaPipe found a real face (prepare.json images[].face, not false_face); too few -> FAIL."""
    n = sum(1 for im in images if im.get("face") and not im.get("false_face"))
    if n < MIN_FACE_FRAMES and status != "FAIL":
        return "FAIL", notes + [f"얼굴이 잡힌 프레임 {n}장 (기준 {MIN_FACE_FRAMES}장 미만)"], n
    return status, notes, n


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def versions():
    out = {"python": sys.version.split()[0]}
    for m in ("cv2", "mediapipe", "numpy", "PIL"):
        try: out[m] = __import__(m).__version__
        except Exception: out[m] = None
    try:
        import cv2; bi = cv2.getBuildInformation(); i = bi.find("avcodec:")
        out["ffmpegAvcodec"] = bi[i:i + 40].split("(")[1].split(")")[0] if i >= 0 else None
    except Exception: out["ffmpegAvcodec"] = None
    out["code"] = {f: sha256(os.path.join(ROOT, f))[:12] for f in
                   ("pipeline/prepare_capture.py", "pipeline/video_meta.py", "pipeline/run_all.py", "tools/frames_bundle.py")}
    return out


def video_suffix(path):
    """Extension for a video whatever its file name: the EC2 worker stores the download as plain 'input' (no extension),
    and prepare_capture / run_all only take known video extensions. ISO BMFF ('ftyp') -> .mov for QuickTime brands else
    .mp4; EBML (WebM / Matroska; the capture spec allows webm) -> .mkv (prepare_capture has no .webm, FFmpeg reads both)."""
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXT: return ext
    head = open(path, "rb").read(16)
    if head[4:8] == b"ftyp": return ".mov" if head[8:12] == b"qt  " else ".mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3": return ".mkv"
    if ext == ".webm": return ".mkv"
    raise SystemExit(f"영상 형식을 알 수 없습니다: {os.path.basename(path)}")


def device_for_model(model):
    """Device profile for a recorded model string (e.g. Samsung "SM-S921N"), same rule as run_all.py: a profile 'match'
    entry contained in the model string, the longest one wins. None when no profile matches."""
    prof = json.load(open(os.path.join(ROOT, "assets", "device_profiles.json"), encoding="utf-8"))
    hit = [k for k, p in prof.items() if not k.startswith("_") and any(m.lower() in model.lower() for m in p.get("match", []))]
    return sorted(hit, key=lambda k: -max(len(m) for m in prof[k]["match"]))[0] if hit else None


def device_arg(device, device_model):
    """--device when given, else the profile for --device-model (S15P31B204-618: a web recording carries no lens record, the
    browser knows the model - Galaxy UA client hints, iPhone chosen by the user). None -> lens search as before. The video's
    own lens record / model still wins inside run_all.py, so this is only the starting value."""
    return device or (device_for_model(device_model) if device_model else None)


def lens_record(rep, video, size, device):
    """lens.json. The recorded focal length (run_all.py lens policy, kept in run_all.json 'lens_source') wins; else the
    device profile, chosen as run_all.py does it (model string matched against assets/device_profiles.json 'match');
    run_all resolves that profile only in its lens stage, so it is resolved here for the GPU side."""
    from video_meta import read as read_meta
    from run_all import device_focal
    try: meta = read_meta(video)
    except Exception: meta = {}
    src = rep.get("lens_source") or {}
    if src.get("focal35_mm") and not src.get("focal_px"):
        # S15P31B204-565: run_all (--until prepare) keeps only the 35 mm record; it becomes px on the PREPARED frames
        # (`size`), never on the original video (a 3840 px 4K video gave the smaller prepared frames a 1.2x focal)
        from video_meta import focal_px_on_frame
        src = {**src, "focal_px": focal_px_on_frame(src["focal35_mm"], size, still=src.get("still", False))}
    w, h = [int(v) for v in size.split("x")]
    lens = {"focalPx": None, "focalSource": "none", "focal35mm": meta.get("focal35"), "deviceMake": meta.get("make"),
            "deviceModel": meta.get("model"), "lensModel": meta.get("lens_model"), "deviceProfile": None, "imageWidth": w, "imageHeight": h}
    if src.get("focal_px"):
        lens.update(focalPx=src["focal_px"], focalSource=src.get("source", "file"), focal35mm=src.get("focal35_mm", lens["focal35mm"]))
        if src.get("estimate"):   # Samsung lens box (S15P31B204-467): recorded, but its meaning for video is not confirmed
            lens.update(focalEstimate=True, samsungLens=src.get("samsung_lens"))
        return lens
    if not device and meta.get("model"):
        device = device_for_model(meta["model"])
    if device:
        f, _ = device_focal(device, size)
        lens.update(focalPx=f, focalSource="device profile", deviceProfile=device)
    return lens


def extract(a):
    src = os.path.abspath(a.video)
    if not os.path.isfile(src): raise SystemExit(f"영상 파일 1개를 주세요: {src}")
    if not os.path.exists(os.path.join(ROOT, "assets", "face_landmarker.task")):
        raise SystemExit("assets/face_landmarker.task 없음: python tools/fetch_models.py 를 먼저 실행하세요")
    stem = os.path.splitext(os.path.basename(src))[0] if os.path.splitext(src)[1].lower() in VIDEO_EXT + (".webm",) else os.path.basename(src)
    in_dir = tempfile.mkdtemp(prefix="lmvid_")
    rid = "_bundle-" + (getattr(a, "work_id", None) or a.job_id or time.strftime("%Y%m%d-%H%M%S"))
    W = os.path.join(ROOT, "work", rid)
    a.device = device_arg(a.device, getattr(a, "device_model", None))
    try:
        return _extract(a, src, os.path.join(in_dir, stem), in_dir, rid, W)
    finally:
        # the video link (in_dir) goes whatever happens; the selected frames (W) stay only with --keep (S15P31B204-448:
        # a failed prepare left the video and the frames behind until the container restarted)
        shutil.rmtree(in_dir, ignore_errors=True)
        if not a.keep: shutil.rmtree(W, ignore_errors=True)


def _extract(a, src, stem_path, in_dir, rid, W):
    vid = stem_path + video_suffix(src)
    try: os.link(src, vid)   # run_all takes a folder with exactly this one capture
    except Exception: shutil.copy2(src, vid)
    if os.path.exists(W): shutil.rmtree(W)
    t0 = time.time()
    vms = video_length_ms(vid)
    pose = pose_slots(getattr(a, "capture_trace", None), vms)
    cut = {"applied": False, "reason": "pose slots"} if pose["applied"] else trace_cut(getattr(a, "capture_trace", None), vms)
    p = subprocess.run([sys.executable, os.path.join(ROOT, "pipeline", "run_all.py"), "--input", in_dir, "--id", rid, "--until", "prepare"]
                       + (["--device", a.device] if a.device else [])
                       + ([f"--prep-exclude-ms={','.join(f'{s}-{e}' for s, e in cut['excludeMs'])}"] if cut.get("applied") else [])
                       + ([f"--prep-pose-trace={a.capture_trace}"] if pose["applied"] else []),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    try: rep = json.load(open(os.path.join(W, "run_all.json"), encoding="utf-8"))
    except Exception:
        sys.stderr.write(p.stdout[-2000:] + p.stderr[-2000:]); raise SystemExit("prepare 실패: run_all.json 없음")
    st = rep["stages"].get("prepare", {}); P = os.path.join(W, "prep")
    pj = json.load(open(os.path.join(P, "prepare.json"), encoding="utf-8"))
    pj["input_dir"] = os.path.basename(src)   # no local / temp paths in the bundle: the source video name only
    json.dump(pj, open(os.path.join(P, "prepare.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    lens = lens_record(rep, vid, (st.get("size") or ["1080x1920"])[0], a.device)
    sec = round(time.time() - t0, 1)
    files = ["prepare.json"] + sorted(f"{sub}/{f}" for sub in ("images", "masks") if os.path.isdir(os.path.join(P, sub))
                                      for f in os.listdir(os.path.join(P, sub)))
    status, notes, n_face = face_check(st.get("status", "FAIL"), st.get("notes", []), pj.get("images", []))
    angle = angle_check(pj.get("images", []), *read_trace(getattr(a, "capture_trace", None)))
    status, notes, fail_code = apply_angle(status, notes, angle)
    vin = (pj.get("videos_in") or [{}])[0]
    lens_bytes = json.dumps(lens, indent=1, ensure_ascii=False).encode("utf-8")
    man = {"format": FORMAT, "jobId": a.job_id, "created": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
           "sourceVideo": {"file": os.path.basename(src), "sha256": sha256(src), "bytes": os.path.getsize(src), "fps": vin.get("fps"), "seconds": vin.get("seconds")},
           "frameCount": sum(f.startswith("images/") for f in files),
           "frames": {"size": st.get("size"), "yawRange": st.get("yaw_range"), "pitchRange": st.get("pitch_range"),
                      "fixedCamera": st.get("fixed_camera"), "masks": any(f.startswith("masks/") for f in files), "faceFrames": n_face,
                      "traceCut": {**cut, **{k: vin[k] for k in ("frames_excluded", "exclude_ignored") if k in vin}},
                      "poseSlots": {**pose, **(vin.get("pose_slots") or {})}},
           "quality": {"status": status, "failCode": fail_code, "proceed": status != "FAIL",
                       "notes": notes, "advice": pj.get("advice", []), "angle": angle},
           "extractSec": sec, "versions": versions(),
           "files": {**{f: sha256(os.path.join(P, f)) for f in files}, "lens.json": hashlib.sha256(lens_bytes).hexdigest()}}
    out = os.path.abspath(a.out); os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with tarfile.open(out, "w") as t:
        for name, data in (("manifest.json", json.dumps(man, indent=1, ensure_ascii=False).encode("utf-8")), ("lens.json", lens_bytes)):
            ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = int(time.time()); t.addfile(ti, io.BytesIO(data))
        for f in files: t.add(os.path.join(P, f), f)
    print(json.dumps({"bundle": out, "bytes": os.path.getsize(out), "sha256": sha256(out), "frames": man["frameCount"], "frameCount": man["frameCount"],
                      "focalPx": lens["focalPx"], "focalSource": lens["focalSource"], "quality": status,
                      "failCode": man["quality"]["failCode"], "angle": angle, "traceCut": cut.get("applied", False), "poseSlots": pose["applied"], "extractSec": sec}, ensure_ascii=False))
    return 0 if status != "FAIL" else 2


def focal_is_estimate(lens):
    """S15P31B204-467: a device-profile focal length that was not checked with a real video, and the Samsung lens box value
    (focalEstimate), are searched around when the fixed trial fails (run_all.py --focal-estimate). Other recorded values
    (iPhone file, same-model file) and 'measured' profiles are not."""
    if not lens.get("focalPx"): return False
    if lens.get("focalEstimate"): return True   # Samsung lens box value
    if lens.get("focalSource") != "device profile": return False
    from run_all import profile_measured
    return not profile_measured(lens.get("deviceProfile") or "")


def run(a, extra):
    bundle = os.path.abspath(a.bundle)
    W = os.path.join(ROOT, "work", a.id)
    if os.path.exists(os.path.join(W, "run_all.json")) and not a.force: raise SystemExit(f"{W} 이미 있음 (--force 로 덮어쓰기)")
    if os.path.exists(W): shutil.rmtree(W)
    P = os.path.join(W, "prep"); os.makedirs(P)
    with tarfile.open(bundle) as t:
        man = json.load(t.extractfile("manifest.json")); lens = json.load(t.extractfile("lens.json"))
        if man.get("format") != FORMAT: raise SystemExit(f"지원하지 않는 형식: {man.get('format')}")
        if not man["quality"]["proceed"]: raise SystemExit(f"추출 단계 품질 실패: {man['quality']['failCode']}")
        for m in t.getmembers():
            if m.name in ("manifest.json", "lens.json"): continue
            if m.name not in man["files"] or not m.isfile(): raise SystemExit(f"목록에 없는 파일: {m.name}")   # also blocks ../ paths
            t.extract(m, P, filter="data")
    bad = [f for f, h in man["files"].items() if f != "lens.json" and sha256(os.path.join(P, f)) != h]
    if bad: raise SystemExit(f"체크섬 불일치 {len(bad)}개: {bad[:3]}")
    fr = man["frames"]; q = man["quality"]
    rep = {"id": a.id, "input": f"bundle:{os.path.basename(bundle)}",
           "stages": {"prepare": {"frames": man["frameCount"], "size": fr["size"], "yaw_range": fr["yawRange"], "pitch_range": fr["pitchRange"],
                                  "fixed_camera": fr["fixedCamera"], "status": q["status"], "notes": q["notes"], "sec": 0.0,
                                  "from_bundle": {"sha256": sha256(bundle), "extract_sec": man.get("extractSec")}}},
           "bundle": {"format": man["format"], "jobId": man.get("jobId"), "sourceVideo": man["sourceVideo"], "lens": lens, "versions": man["versions"]}}
    if lens.get("focalPx"):
        rep["lens_source"] = {"source": lens["focalSource"], "focal_px": lens["focalPx"], "focal35_mm": lens.get("focal35mm"),
                              "lens_model": lens.get("lensModel"), "via": "bundle"}
    json.dump(rep, open(os.path.join(W, "run_all.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    in_dir = tempfile.mkdtemp(prefix="lmbundle_")   # no video here: the lens comes from the bundle (--focal)
    cmd = [sys.executable, os.path.join(ROOT, "pipeline", "run_all.py"), "--input", in_dir, "--id", a.id] \
          + (["--focal", str(lens["focalPx"])] if lens.get("focalPx") else []) \
          + (["--focal-estimate"] if focal_is_estimate(lens) else []) + extra
    print("$ " + " ".join(cmd), flush=True)
    try: return subprocess.call(cmd)
    finally: shutil.rmtree(in_dir, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    e = sp.add_parser("extract"); e.add_argument("video"); e.add_argument("out"); e.add_argument("--job-id")
    e.add_argument("--work-id", help="work folder name work/_bundle-<work id> (default: --job-id). The extractor passes <job id>-a<attempt> so two attempts of one job never share a folder (S15P31B204-594)")
    e.add_argument("--device", help="device lens profile when the video carries no lens record (assets/device_profiles.json)")
    e.add_argument("--device-model", help="model string the browser knew (e.g. SM-S921N, iPhone 16 Pro): resolved to --device "
                                          "via device_profiles.json 'match' when --device is not given (S15P31B204-618)")
    e.add_argument("--capture-trace", help="claim capture.trace saved as JSON (web recordings, S15P31B204-662): explains a "
                                           "QUALITY_ANGLE failure, never passes one")
    e.add_argument("--keep", action="store_true", help="keep work/_bundle-<id> (debug)")
    r = sp.add_parser("run"); r.add_argument("bundle"); r.add_argument("--id", required=True); r.add_argument("--force", action="store_true")
    a, extra = ap.parse_known_args()
    if a.cmd == "extract":
        if extra: ap.error(f"unknown options {extra}")
        sys.exit(extract(a))
    sys.exit(run(a, extra))


if __name__ == "__main__":
    main()
