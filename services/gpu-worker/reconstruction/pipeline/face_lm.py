"""MediaPipe face landmarks per frame, detected once per work folder and read back (S15P31B204-451).

The model sub-steps (mv_landmarks, frame_check, template_fit, pose_refine, profile_sil, eyelid_offset, eye_fit,
eye_color, pitch_pose) each detected the same full frames with the same face_landmarker.task (num_faces=1): about 14
passes per job at ~3 s each. Measured 2026-10-29 (RunPod 3090, synthetic bundle): a new detector and the
facial-transformation option give identical landmarks (max diff 0.0), so one cache serves every caller.

  lm, M = face_lm.landmarks(images, name, img)   lm: 478 [x, y, z] normalized like MediaPipe (pixels = x * W, y * H)
                                                 M: 4x4 facial transformation; (None, None) without a face
Cache: <images>/../lm_cache_v1/<name>.json, keyed by the image file size and mtime, written atomically (candidates
run in parallel processes). A missing or unreadable cache file is detected again.
"""
import json, os, threading

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = os.path.join(HERE, "..", "assets", "face_landmarker.task")
_tl = threading.local()   # one detector per thread (MediaPipe tasks are not thread safe)


def _detect(img):
    """BGR image -> {"lm", "M"} (both None without a face)"""
    import cv2, mediapipe as mp, numpy as np
    det = getattr(_tl, "det", None)
    if det is None:
        det = _tl.det = mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_buffer=open(TASK, "rb").read()), num_faces=1,
            output_facial_transformation_matrixes=True))
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))))
    if not r.face_landmarks:
        return {"lm": None, "M": None}
    return {"lm": [[p.x, p.y, p.z] for p in r.face_landmarks[0]],
            "M": np.asarray(r.facial_transformation_matrixes[0]).tolist()}


def landmarks(images, name, img=None, detect=_detect):
    """(lm, M) for images/name; img = the already loaded BGR frame (read here when None)"""
    path = os.path.join(images, name)
    st = os.stat(path)
    key = [st.st_size, st.st_mtime_ns]
    cache = os.path.join(os.path.dirname(os.path.abspath(images)), "lm_cache_v1", name + ".json")
    try:
        with open(cache, encoding="utf-8") as f:
            c = json.load(f)
        if c["key"] == key:
            return c["lm"], c["M"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    if img is None:
        import cv2
        img = cv2.imread(path)
        if img is None:
            return None, None
    c = dict(detect(img), key=key)
    try:   # json keeps the floats exactly (repr round trip)
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        tmp = f"{cache}.{os.getpid()}.{threading.get_ident()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(c, f)
        os.replace(tmp, cache)
    except OSError:
        pass   # no cache this time; the result is still right
    return c["lm"], c["M"]


def prefetch(images, names, detect=_detect):
    """detect the frames that have no cache yet, side by side (S15P31B204-702): the first caller of a job walked the
    frames one by one on one core. One detector per thread; the per-frame result is the same as a serial detection.
    Returns how many frames were detected"""
    todo = [n for n in names if not _cached(images, n)]
    if len(todo) < 2:
        return 0
    from parallel import thread_map
    thread_map(lambda n: landmarks(images, n, detect=detect), todo)
    return len(todo)


def _cached(images, name):
    try:
        st = os.stat(os.path.join(images, name))
        with open(os.path.join(os.path.dirname(os.path.abspath(images)), "lm_cache_v1", name + ".json"), encoding="utf-8") as f:
            return json.load(f)["key"] == [st.st_size, st.st_mtime_ns]
    except (OSError, ValueError, KeyError, TypeError):
        return False
