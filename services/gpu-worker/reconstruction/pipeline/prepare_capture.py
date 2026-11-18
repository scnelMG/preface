"""Prepare a teammate's capture folder (photos and/or videos from several angles) for COLMAP.

input folder may mix:
  photos  .jpg .jpeg .png .webp .heic .heif   (iPhone HEIC needs `pip install pillow-heif`)
  videos  .mp4 .mov .m4v .avi .mkv            (one long head-turn video, or one short clip per angle)

steps
  1. photos: EXIF rotation applied, resized to --max-side, saved as JPEG (focal-length EXIF kept for COLMAP)
  2. videos: evenly spaced frames per clip (total ~--frames-total), sharpest kept
  3. blur filter (relative to the set median), face detection + head pose (MediaPipe) per image
  4. fixed-camera check: if the background barely changes while the head pose does, the person turned in front of
     a still phone -> face masks are REQUIRED for COLMAP (otherwise the still background breaks alignment)
  5. marker card check (ArUco ids 0/1, tools/scale) for mm scale
  6. prepare.json: counts, rejected, image sizes (single_camera), yaw/pitch coverage, masks decision, advice

usage: python prepare_capture.py <inputDir> <outDir> [--max-side 1920] [--frames-total 100] [--masks auto|on|off]
output: outDir/images/*.jpg, outDir/masks/<image>.jpg.png (COLMAP convention), outDir/prepare.json
Personal data: everything stays on this machine. Nothing is uploaded.
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from frame_slots import kept_frames, parse_exclude, progress_at, progress_slots, slot_frames, trace_progress_info  # noqa: E402  (S15P31B204-667)
PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".avi", ".mkv")


def ascii_stem(name):
    s = re.sub(r"[^A-Za-z0-9_-]+", "_", os.path.splitext(os.path.basename(name))[0]).strip("_")
    return (s or "img")[:40]


def load_photo(path, max_side):
    """-> (bgr ndarray, exif bytes or None, note)"""
    from PIL import Image, ImageOps
    ext = os.path.splitext(path)[1].lower()
    if ext in (".heic", ".heif"):
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            return None, None, "heic_unsupported"
    try:
        im = Image.open(path)
        exif = im.getexif()
        im = ImageOps.exif_transpose(im).convert("RGB")
    except Exception:
        return None, None, "unreadable"
    s = max_side / max(im.size)
    if s < 1:
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    exif_bytes = None
    if exif:
        exif[0x0112] = 1  # orientation already applied
        try:
            exif_bytes = exif.tobytes()
        except Exception:
            exif_bytes = None
    return np.asarray(im)[:, :, ::-1].copy(), exif_bytes, None


def save_jpg(path, bgr, exif_bytes=None):
    from PIL import Image
    im = Image.fromarray(bgr[:, :, ::-1])
    kw = {"quality": 95}
    if exif_bytes:
        kw["exif"] = exif_bytes
    im.save(path, "JPEG", **kw)


def exclude_ms(a):
    """--exclude-ms "start-end,start-end" (ms of the video) -> [(start, end)]; empty / missing -> []"""
    return parse_exclude(getattr(a, "exclude_ms", ""))


def pose_rows(a):
    """--pose-trace file (web guide capture trace) -> its rows [t_ms, yaw, pitch, found], or None"""
    path = getattr(a, "pose_trace", "")
    if not path: return None
    import json as _json
    return _json.load(open(path, encoding="utf-8"))["trace"]


def pose_gyro(a):
    """--pose-trace file -> (gyro rows [t_ms, deg] or None, gyroVersion or None). The gyro lines the left / right progress
    of the pose slots up with the phone's turn (frame_slots.gyro_yaw, S15P31B204-735)"""
    path = getattr(a, "pose_trace", "")
    if not path: return None, None
    import json as _json
    with open(path, encoding="utf-8") as f: tr = _json.load(f)
    return tr.get("gyro") or None, tr.get("gyroVersion")


def video_frames(path, n, max_side, exclude_ms=None, pose=None, gyro=(None, None)):
    import cv2
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    info = {"file": os.path.basename(path), "frames_total": total, "fps": round(fps, 2),
            "seconds": round(total / fps, 1) if fps else None}
    if total <= 0:
        info["error"] = "unreadable (codec?)"
        return info, []
    kept = list(range(total))
    want = None
    if pose:
        # OPTION --pose-trace: slots over new head poses (frame_slots.trace_progress), frame times = the video's own
        # presentation times (the same mapping as --exclude-ms). Too few filled slots -> time slots as before
        times = []
        while cap.grab():
            times.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        cap.release(); cap = cv2.VideoCapture(path)
        prog, pinfo = trace_progress_info(pose, *gyro)
        want = progress_slots(progress_at(times, prog), n) if prog and times else {}
        filled = len(set(want.values()))
        info["pose_slots"] = {"cells": round(prog[-1][1], 1) if prog else 0, "slots_filled": filled, "candidates": len(want), **pinfo}
        if filled < n // 2:
            info["pose_slots"]["ignored"] = f"{filled} of {n} slots"; want = None
    if want is None and exclude_ms:
        # cut ranges come in TIME (web guide trace, S15P31B204-667): browser recordings may have uneven frame gaps, so
        # every frame's own presentation time is read first (1-2.4 s for 700-2000 frames, 11/08) instead of k / fps
        times = []
        while cap.grab():
            times.append(cap.get(cv2.CAP_PROP_POS_MSEC))
        cap.release(); cap = cv2.VideoCapture(path)
        kept = kept_frames(times, exclude_ms)
        info.update(exclude_ms=[[round(s), round(e)] for s, e in exclude_ms], frames_excluded=len(times) - len(kept))
        if len(kept) < 2 * n:   # too little left to choose from: ignore the cut
            info["exclude_ignored"] = f"{len(kept)} frames left"; kept = list(range(len(times) or total))
    # read 2 candidates per slot (pose slots: up to 4) and keep the sharpest one (motion blur)
    if want is None: want = slot_frames(kept, n)
    best = {}
    k = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if k in want:
            s = max_side / max(fr.shape[:2])
            if s < 1:
                fr = cv2.resize(fr, (round(fr.shape[1] * s), round(fr.shape[0] * s)), interpolation=cv2.INTER_AREA)
            sharp = float(cv2.Laplacian(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
            i = want[k]
            if i not in best or sharp > best[i][2]:
                best[i] = (k, fr, sharp)
        k += 1
    info["frames_read"] = k
    return info, [best[i] for i in sorted(best)]


# MediaPipe pitch sign (checked 10/20 on eun02: at -51 deg the nose tip is at eye height): NEGATIVE = chin up (head
# tilted back, nostrils visible), POSITIVE = chin down (looking down at the phone)
POSE_BINS = {"chin_down": lambda y, p: p is not None and p >= 12, "chin_up": lambda y, p: p is not None and p <= -12,
             "left": lambda y, p: y is not None and y <= -40, "right": lambda y, p: y is not None and y >= 40,
             "noface": lambda y, p: y is None}


def bin_counts(items):
    return {b: sum(1 for it in items if it["src"] == "video" and f(it["yaw"], it["pitch"])) for b, f in POSE_BINS.items()}


def select_by_pose(items, target, bin_min):
    """W7f (2026-10-19): frames are first taken for every POSE bin (chin up / down >= 12 deg, head turned >= 40 deg left /
    right, no face = 60-90 deg profiles), at least bin_min each when the video has them (sharpest per time chunk, spread
    over the bin's time span), then the rest of the target is filled evenly over time. Before, 100 frames were taken
    evenly over time only and the short up / down parts of the video kept 0-7 frames (eun02 4/7, woo02 0/3) although
    the capture turned more than +-20 deg - too few for the nostril / under-chin / upper-lid observations (W7).
    Photos are always kept."""
    photos = [it for it in items if it["src"] != "video"]
    vids = sorted([it for it in items if it["src"] == "video"], key=lambda t: t["name"])
    chosen = set()

    def spread(group, k):
        """k frames spread over the group's order (sharpest in each chunk)"""
        if k <= 0 or not group: return []
        chunks = np.array_split(np.arange(len(group)), min(k, len(group)))
        return [max((group[i] for i in ch), key=lambda t: t["sharp"])["name"] for ch in chunks if len(ch)]
    for b, f in POSE_BINS.items():
        grp = [it for it in vids if f(it["yaw"], it["pitch"]) and it["name"] not in chosen]
        chosen.update(spread(grp, bin_min))
    rest = [it for it in vids if it["name"] not in chosen]
    chosen.update(spread(rest, max(0, target - len(chosen))))
    return photos + [it for it in vids if it["name"] in chosen]


EXTRA_BINS = {"chinup": lambda y, p: p is not None and p <= -12, "chindown": lambda y, p: p is not None and p >= 12}


def add_pose_extra(a, videos, items, blink_thr, rep, det):
    """W7f option C (2026-10-20): the even frames stay exactly as they are (left / right and in-between turns keep the
    camera chain intact - option B replaced them and eun02 lost its whole left turn in SfM). Only when the even set has
    fewer than the quota of chin-up / chin-down frames, more are read from the video (3x denser) and the missing ones
    added: sharp, not blinking, spread over the head turn (largest yaw distance to the frames already in the bin).
    Chin up comes first: nostrils, under the nose and the chin (W7-nose); chin down is of little use for the upper lid
    (the brow hides it - the side views show the lid profile best)."""
    import cv2
    from video_scan import face_mask_pose
    quota = {}
    for part in a.pose_extra.split(","):
        if ":" in part:
            k, v = part.split(":"); quota[k.strip()] = int(v)
    have = {b: [it for it in items if it["src"] == "video" and EXTRA_BINS[b](it["yaw"], it["pitch"])] for b in quota if b in EXTRA_BINS}
    need = {b: max(0, quota[b] - len(v)) for b, v in have.items()}
    stat = {b: {"quota": quota[b], "even_set": len(have[b]), "added": 0, "available": 0} for b in have}
    if not any(need.values()):
        rep["pose_extra"] = stat; return items
    taken = {it["name"] for it in items}
    vsharp = [it["sharp"] for it in items if it["src"] == "video"]
    thr = 0.5 * float(np.median(vsharp)) if vsharp else 0.0
    per = max(12, math.ceil(a.frames_total / len(videos))) * 3
    cands = []
    for vi, v in enumerate(videos):
        _, frs = video_frames(v, per, a.max_side, exclude_ms(a))
        for k, fr, sharp in frs:
            name = f"v{vi}_{ascii_stem(v)}_{k:05d}.jpg"
            if name in taken or sharp < thr: continue
            fm = face_mask_pose(det, fr, with_blink=True)
            if fm is None or (blink_thr is not None and fm[3] is not None and fm[3] > blink_thr): continue
            cands.append({"name": name, "bgr": fr, "exif": None, "sharp": sharp, "src": "video", "mask": fm[0],
                          "yaw": fm[1], "pitch": fm[2], "blink": fm[3], "marker": False})
    for b in have:
        pool = [c for c in cands if EXTRA_BINS[b](c["yaw"], c["pitch"]) and c["name"] not in taken]
        stat[b]["available"] = len(pool)
        chosen = list(have[b])
        for _ in range(need[b]):
            if not pool: break
            # farthest in yaw from the frames already in the bin (different turns of the head), then the sharpest
            best = max(pool, key=lambda c: (min([abs(c["yaw"] - x["yaw"]) for x in chosen] or [180.0]), c["sharp"]))
            best["extra"] = b; items.append(best); chosen.append(best); taken.add(best["name"]); pool.remove(best)
            stat[b]["added"] += 1
    rep["pose_extra"] = stat
    return items


YAW_EDGES = list(range(-90, 91, 15))                     # 15 deg head-turn bins (MediaPipe yaw)


def yaw_bin(yaw, side=None):
    """bin name of a frame: 'y-90..-75' ... 'y75..90' from MediaPipe yaw, 'noface-' / 'noface+' for profiles where
    MediaPipe found no face (side from the neighbouring frames), None when unknown"""
    if yaw is None: return None if side is None else f"noface{side}"
    i = int(np.clip(np.searchsorted(YAW_EDGES, yaw, side="right") - 1, 0, len(YAW_EDGES) - 2))
    return f"y{YAW_EDGES[i]}..{YAW_EDGES[i + 1]}"


def add_yaw_extra(a, videos, items, blink_thr, rep, det):
    """OPTION (2026-10-22, 만두 "각 각도별 균등하게 최소 프레임"): frames are taken evenly over TIME, so a capture that
    stays long in front (woo03: 107 s, side views 9 % of the time) gets few profile frames (10 beyond 75 deg vs woo02 21).
    The even frames stay exactly as they are (replacing them broke eun02's camera chain, W7f option B); only bins with
    fewer than --yaw-quota frames get frames ADDED: 15 deg yaw bins from MediaPipe, plus one bin per profile side for frames
    where MediaPipe finds no face (beyond ~65 deg; the side comes from the nearest frames with a face turned >= 35 deg).
    The video is scanned densely without keeping the images (memory); the chosen frames are read again at the end."""
    import cv2
    from video_scan import face_mask_pose
    vsharp = [it["sharp"] for it in items if it["src"] == "video"]
    thr = 0.5 * float(np.median(vsharp)) if vsharp else 0.0
    per = max(12, math.ceil(a.frames_total / len(videos))) * a.yaw_dense
    scan = []                                                            # (vi, k, name, sharp, yaw, pitch, blink, face)
    for vi, v in enumerate(videos):
        cap = cv2.VideoCapture(v); total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        want = set(np.linspace(0, max(total - 1, 0), per).astype(int).tolist()); k = 0
        while True:
            ok, fr = cap.read()
            if not ok: break
            if k in want:
                s = a.max_side / max(fr.shape[:2])
                if s < 1: fr = cv2.resize(fr, (round(fr.shape[1] * s), round(fr.shape[0] * s)), interpolation=cv2.INTER_AREA)
                sharp = float(cv2.Laplacian(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
                fm = face_mask_pose(det, fr, with_blink=True)
                scan.append({"vi": vi, "k": k, "name": f"v{vi}_{ascii_stem(v)}_{k:05d}.jpg", "sharp": sharp,
                             "yaw": None if fm is None else fm[1], "pitch": None if fm is None else fm[2],
                             "blink": None if fm is None else fm[3]})
            k += 1
        cap.release()
    # profile side of the no-face frames: nearest frames with a face (same video) turned >= 35 deg, same sign both sides
    for vi in range(len(videos)):
        sv = sorted([s for s in scan if s["vi"] == vi], key=lambda s: s["k"])
        faced = [s for s in sv if s["yaw"] is not None]
        for s in sv:
            if s["yaw"] is not None: continue
            prev = [f for f in faced if f["k"] < s["k"]][-1:]; nxt = [f for f in faced if f["k"] > s["k"]][:1]
            sg = {int(np.sign(f["yaw"])) for f in prev + nxt if abs(f["yaw"]) >= 35}
            s["side"] = ("+" if 1 in sg else "-") if len(sg) == 1 and all(abs(f["yaw"]) >= 35 for f in prev + nxt) else None
    by_name = {s["name"]: s for s in scan}

    def bin_of(it):
        if it["yaw"] is not None: return yaw_bin(it["yaw"])
        m = re.findall(r"_(\d{5})\.jpg$", it["name"]); vi = int(it["name"][1:it["name"].index("_")]) if it["name"].startswith("v") else 0
        if not m: return None
        near = min((s for s in scan if s["vi"] == vi), key=lambda s: abs(s["k"] - int(m[0])), default=None)
        return yaw_bin(None, near.get("side") if near else None)
    bins = [yaw_bin(e) for e in YAW_EDGES[:-1]] + ["noface-", "noface+"]
    have = {b: [] for b in bins}
    for it in items:
        if it["src"] != "video": continue
        b = bin_of(it)
        if b in have: have[b].append(int(re.findall(r"_(\d{5})\.jpg$", it["name"])[0]))
    taken = {it["name"] for it in items}
    stat = {b: {"even_set": len(have[b]), "available": 0, "added": 0} for b in bins}
    pick = []
    for b in bins:
        pool = [s for s in scan if s["name"] not in taken and s["sharp"] >= thr
                and (s["blink"] is None or blink_thr is None or s["blink"] <= blink_thr)
                and (yaw_bin(s["yaw"]) if s["yaw"] is not None else yaw_bin(None, s.get("side"))) == b]
        stat[b]["available"] = len(pool)
        ks = list(have[b])
        quota = (a.yaw_quota_profile or a.yaw_quota) if b.startswith("noface") else a.yaw_quota
        stat[b]["quota"] = quota
        for _ in range(max(0, quota - len(ks))):
            if not pool or len(pick) >= a.yaw_max_extra: break
            # farthest in time from the frames already in the bin (different passes through the angle), then the sharpest
            best = max(pool, key=lambda s: (min([abs(s["k"] - x) for x in ks] or [1e9]), s["sharp"]))
            pick.append((b, best)); ks.append(best["k"]); taken.add(best["name"]); pool.remove(best); stat[b]["added"] += 1
    # read the chosen frames again (only those) and add them like the even frames
    for vi, v in enumerate(videos):
        need = {s["k"]: (b, s) for b, s in pick if s["vi"] == vi}
        if not need: continue
        cap = cv2.VideoCapture(v); k = 0
        while need:
            ok, fr = cap.read()
            if not ok: break
            if k in need:
                b, s = need.pop(k)
                sc = a.max_side / max(fr.shape[:2])
                if sc < 1: fr = cv2.resize(fr, (round(fr.shape[1] * sc), round(fr.shape[0] * sc)), interpolation=cv2.INTER_AREA)
                fm = face_mask_pose(det, fr, with_blink=True)
                items.append({"name": s["name"], "bgr": fr, "exif": None, "sharp": s["sharp"], "src": "video",
                              "mask": None if fm is None else fm[0], "yaw": None if fm is None else fm[1],
                              "pitch": None if fm is None else fm[2], "blink": None if fm is None else fm[3],
                              "marker": False, "extra": f"yaw:{b}"})
            k += 1
        cap.release()
    rep["yaw_quota"] = {"quota": a.yaw_quota, "scanned": len(scan), "added": len(pick), "bins": stat}
    return items


def select_by_angle(a, videos, items, rep, det):
    """OPTION (2026-10-24, --select angle; 만두 "다각도의 얼굴을 비슷한 각도 간격으로"): the default takes frames evenly over
    TIME, so the long frontal part gets 40-58 frames, a fast turn leaves 22-27 deg gaps between neighbours, chin-down
    0-6 frames (10/23, 6 originals), and the left / right halves of the head are tied by few in-between angles (gyu01:
    left and right profiles disagree by ~0.08 x eye width at the nose, 10/24). Here the SAME number of frames is spread
    evenly over the head POSE (yaw, pitch) the video shows:
      1. the video is scanned --yaw-dense times denser (MediaPipe yaw / pitch / blink, sharpness); profiles where no face
         is found get a yaw from time (rise to 90 deg in the middle of the no-face stretch; 10/23: error median 3-7 deg)
      2. per 2.5 deg pose cell the sharpest open-eye frame stands for the cell
      3. reserved first: --angle-front frames near frontal (|yaw|, |pitch| < 10: texture, eye fit, crease measure) and
         --angle-profile frames per side at 80-100 deg with |pitch| < 12 (the profile outline is the nose / brow line
         there: 87-96 % of the rows vs 62-80 % beyond 100 / below 80 deg, gyu01 10/24), plus the pose extremes
      4. the rest by farthest-point sampling in pose space (every new frame = the pose farthest from all chosen ones)
    Photos are kept. --include-frames (frame numbers) are always taken (fixed evaluation frames of a test series)."""
    import cv2
    from video_scan import face_mask_pose
    per = max(12, math.ceil(a.frames_total / len(videos))) * a.yaw_dense
    inc = {int(x) for x in a.include_frames.split(",") if x.strip()} if a.include_frames else set()
    scan = []
    for vi, v in enumerate(videos):
        cap = cv2.VideoCapture(v); total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        want = set(np.linspace(0, max(total - 1, 0), per).astype(int).tolist()) | {k for k in inc if k < total}; k = 0
        while True:
            ok, fr = cap.read()
            if not ok: break
            if k in want:
                sc = a.max_side / max(fr.shape[:2])
                if sc < 1: fr = cv2.resize(fr, (round(fr.shape[1] * sc), round(fr.shape[0] * sc)), interpolation=cv2.INTER_AREA)
                sharp = float(cv2.Laplacian(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
                fm = face_mask_pose(det, fr, with_blink=True)
                scan.append({"vi": vi, "k": k, "name": f"v{vi}_{ascii_stem(v)}_{k:05d}.jpg", "sharp": sharp,
                             "yaw": None if fm is None else fm[1], "pitch": None if fm is None else fm[2],
                             "blink": None if fm is None else fm[3], "face": fm is not None})
            k += 1
        cap.release()
    # yaw of the no-face frames from time: between two faced frames turned >= 35 deg to the same side, the head rises
    # to 90 deg in the middle of the stretch (sin profile); pitch unknown there -> 0 (captures turn and nod separately)
    for vi in range(len(videos)):
        sv = sorted([s for s in scan if s["vi"] == vi], key=lambda s: s["k"])
        # false faces INSIDE a profile stretch (gyu01 k 307 / 317 / 330 / 339: "yaw -6..12, pitch -17..-50" while the head is
        # at 85-90 deg and no face is found in the frames around them): a detection read as near-frontal (|yaw| < 35)
        # whose neighbours (+-8 scanned frames) are mostly faceless is dropped; real frontal frames have faces around
        from face_flags import false_faces                       # shared rule (lens check / landmark triangulation too)
        ffk = false_faces(sv)
        for f in [t for t in sv if t["k"] in ffk]:
            f["face"] = False; f["yaw"] = None; f["pitch"] = None; f["false_face"] = True
        faced = [s for s in sv if s["face"] and s["yaw"] is not None]
        for s in sv:
            s["yaw_e"], s["pitch_e"] = s["yaw"], (s["pitch"] if s["pitch"] is not None else 0.0)
            if s["yaw"] is not None: continue
            prev = [f for f in faced if f["k"] < s["k"]][-1:]; nxt = [f for f in faced if f["k"] > s["k"]][:1]
            if prev and nxt and np.sign(prev[0]["yaw"]) == np.sign(nxt[0]["yaw"]) and min(abs(prev[0]["yaw"]), abs(nxt[0]["yaw"])) >= 35:
                # rises from the PREVIOUS frame's angle in the first half and falls to the NEXT one's in the second
                # (with the larger of the two as start, a stretch next to a detection at 84 deg was all >= 84: gyu01 left
                # profile 67 -> 84 deg had no frame)
                tau = (s["k"] - prev[0]["k"]) / max(1, nxt[0]["k"] - prev[0]["k"])
                m0 = abs(prev[0]["yaw"]) if tau <= 0.5 else abs(nxt[0]["yaw"])
                s["yaw_e"] = float(np.sign(prev[0]["yaw"]) * (m0 + (90 - min(m0, 90)) * np.sin(np.pi * tau)))
            elif bool(prev) != bool(nxt) and abs((prev or nxt)[0]["yaw"]) >= 35:
                # no-face stretch at the START / END of the video (gyu01 starts in profile): one neighbour only, the far
                # end of the stretch taken as the 90 deg turn (half of the sin profile)
                f0 = (prev or nxt)[0]; ends = [t["k"] for t in sv if not t["face"] and (t["k"] > f0["k"] if prev else t["k"] < f0["k"])]
                D = max(1, (max(ends) - f0["k"]) if prev else (f0["k"] - min(ends))); m0 = abs(f0["yaw"])
                s["yaw_e"] = float(np.sign(f0["yaw"]) * (m0 + (90 - m0) * np.sin(0.5 * np.pi * min(1.0, abs(s["k"] - f0["k"]) / D))))
            else:
                s["yaw_e"] = None
    bl = [s["blink"] for s in scan if s["blink"] is not None]
    blink_thr = max(a.max_blink, float(np.median(bl)) + 0.25) if len(bl) >= 5 else None
    thr = 0.5 * float(np.median([s["sharp"] for s in scan])) if scan else 0.0
    cand = [s for s in scan if s["yaw_e"] is not None and s["sharp"] >= thr
            and (blink_thr is None or s["blink"] is None or s["blink"] <= blink_thr)]
    # 2. one representative (sharpest) per 2.5 deg pose cell
    cell = {}
    for s in cand:
        key = (int(np.floor(s["yaw_e"] / 2.5)), int(np.floor(s["pitch_e"] / 2.5)))
        if key not in cell or s["sharp"] > cell[key]["sharp"]: cell[key] = s
    reps = list(cell.values())
    chosen = {s["name"]: s for s in scan if s["k"] in inc and s["yaw_e"] is not None}
    for s in scan:
        if s["k"] in inc and s["yaw_e"] is None: s["yaw_e"] = 0.0; chosen[s["name"]] = s   # evaluation frame, pose unknown

    def spread(group, k):
        if k <= 0 or not group: return []
        group = sorted(group, key=lambda t: t["k"]); chunks = np.array_split(np.arange(len(group)), min(k, len(group)))
        return [max((group[i] for i in ch), key=lambda t: t["sharp"]) for ch in chunks if len(ch)]
    # 3. reserved: frontal (spread over time, sharpest per chunk), profiles per side, pose extremes
    front = [s for s in cand if abs(s["yaw_e"]) < 10 and abs(s["pitch_e"]) < 10]
    for s in spread(front, a.angle_front): chosen[s["name"]] = s
    for sg in (-1, 1):
        prof = [s for s in cand if 80 <= sg * s["yaw_e"] <= 100 and abs(s["pitch_e"]) < 12]
        for s in spread(prof, a.angle_profile): chosen[s["name"]] = s
    if reps:
        for f in (lambda s: s["yaw_e"], lambda s: -s["yaw_e"], lambda s: s["pitch_e"], lambda s: -s["pitch_e"]):
            s = max(reps, key=f); chosen[s["name"]] = s
    # 4. farthest-point sampling over the cell representatives
    P = np.array([[s["yaw_e"], s["pitch_e"]] for s in reps]) if reps else np.zeros((0, 2))

    def dmin(pts):
        C = np.array([[s["yaw_e"], s["pitch_e"]] for s in chosen.values()])
        return np.min(np.linalg.norm(pts[:, None] - C[None], axis=2), axis=1) if len(C) else np.full(len(pts), 1e9)
    while len(chosen) < a.frames_total and len(reps):
        d = dmin(P); j = int(np.argmax(d))
        if d[j] <= 0: break
        chosen[reps[j]["name"]] = reps[j]
    # 5. angle gaps > --angle-gap between level neighbours (fast turns: the in-between frames are motion-blurred and fail
    #    the sharpness cut; gyu01 5 -> 23 deg, -86 -> -59 deg): filled with the best frame near the gap middle, sharpness
    #    relaxed to 0.25 x median (a blurred in-between frame still ties the two sides of the head together in SfM)
    loose = [s for s in scan if s["yaw_e"] is not None and abs(s["pitch_e"]) < 15 and s["sharp"] >= 0.5 * thr
             and (blink_thr is None or s["blink"] is None or s["blink"] <= blink_thr)]
    n_gap = 0
    for _ in range(a.angle_gap_max_add):
        lv = sorted(s["yaw_e"] for s in chosen.values() if abs(s["pitch_e"]) < 15)
        gl = [(lv[i + 1] - lv[i], lv[i], lv[i + 1]) for i in range(len(lv) - 1) if lv[i + 1] - lv[i] > a.angle_gap]
        best = None
        for g, lo, hi in sorted(gl, reverse=True):
            mid = 0.5 * (lo + hi)
            inside = [s for s in loose if lo + 2 < s["yaw_e"] < hi - 2 and s["name"] not in chosen]
            if inside:
                best = min(inside, key=lambda t: (round(abs(t["yaw_e"] - mid) / 2.5), -t["sharp"])); break
        if best is None: break
        chosen[best["name"]] = best; n_gap += 1
    dcov = dmin(P) if len(P) else np.zeros(1)          # how far the video's poses are from the nearest chosen frame
    picks = sorted(chosen.values(), key=lambda s: (s["vi"], s["k"]))
    ys = sorted(s["yaw_e"] for s in picks if abs(s["pitch_e"]) < 15)
    gaps = np.diff(ys) if len(ys) > 1 else np.zeros(1)
    # read the chosen frames again
    new = []
    for vi, v in enumerate(videos):
        need = {s["k"]: s for s in picks if s["vi"] == vi}
        if not need: continue
        cap = cv2.VideoCapture(v); k = 0
        while need:
            ok, fr = cap.read()
            if not ok: break
            if k in need:
                s = need.pop(k)
                sc = a.max_side / max(fr.shape[:2])
                if sc < 1: fr = cv2.resize(fr, (round(fr.shape[1] * sc), round(fr.shape[0] * sc)), interpolation=cv2.INTER_AREA)
                fm = face_mask_pose(det, fr, with_blink=True)
                new.append({"name": s["name"], "bgr": fr, "exif": None, "sharp": s["sharp"], "src": "video",
                            "mask": None if fm is None else fm[0], "yaw": None if fm is None else fm[1],
                            "pitch": None if fm is None else fm[2], "blink": None if fm is None else fm[3],
                            "marker": False, "extra": f"angle:{s['yaw_e']:.0f},{s['pitch_e']:.0f}", "false_face": bool(s.get("false_face"))})
            k += 1
        cap.release()
    rep["angle_select"] = {"scanned": len(scan), "candidates": len(cand), "cells": len(reps), "chosen": len(new),
                           "included": len(inc), "gap_filled": n_gap, "false_faces": int(sum(bool(s.get("false_face")) for s in scan)),
                           "front": int(sum(abs(s["yaw_e"]) < 10 and abs(s["pitch_e"]) < 10 for s in picks)),
                           "profile_left": int(sum(-100 <= s["yaw_e"] <= -80 for s in picks)),
                           "profile_right": int(sum(80 <= s["yaw_e"] <= 100 for s in picks)),
                           "yaw_range": [round(min(ys), 1), round(max(ys), 1)] if ys else None,
                           "pitch_range": [round(min(s["pitch_e"] for s in picks), 1), round(max(s["pitch_e"] for s in picks), 1)] if picks else None,
                           "max_yaw_gap_level": round(float(gaps.max()), 1), "coverage_max_deg": round(float(dcov.max()), 1),
                           "coverage_p90_deg": round(float(np.quantile(dcov, 0.9)), 1),
                           "scan": [[s["k"], None if s["yaw"] is None else round(s["yaw"], 1), None if s["yaw_e"] is None else round(s["yaw_e"], 1),
                                     round(s["pitch_e"], 1), int(s in cand), int(s["name"] in chosen)] for s in sorted(scan, key=lambda t: (t["vi"], t["k"]))]}
    return [it for it in items if it["src"] != "video"] + new


def marker_ids(det_aruco, bgr):
    import cv2
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if det_aruco[0] == "new":
        _, ids, _ = det_aruco[1].detectMarkers(g)
    else:
        _, ids, _ = cv2.aruco.detectMarkers(g, det_aruco[1])
    return set() if ids is None else set(int(x) for x in ids.ravel())


def main():
    import cv2
    from video_scan import make_detector, face_mask_pose, DEFAULT_TASK
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--max-side", type=int, default=1920)  # = run_all FRAME_MAX_SIDE
    ap.add_argument("--frames-total", type=int, default=100, help="frames taken from all videos together")
    ap.add_argument("--exclude-ms", default="", help="OPTION (2026-11-08, S15P31B204-667, off = ''): video time ranges in ms "
                    "'start-end,...' left out of the frame choice (web guide trace: the closing front pose / the wait to "
                    "the 24 s minimum). The same number of frames is spread over the rest; frame times are the video's own "
                    "presentation times. Time selection only (--select angle ignores it)")
    ap.add_argument("--pose-trace", default="", help="OPTION (2026-11-09, off = ''): web guide capture trace (JSON with "
                    "'trace' rows [t_ms, yaw, pitch, found]). The frames are spread evenly over NEW head poses instead of "
                    "over time: pauses, voice waits and poses seen twice add no frames (frame_slots.trace_progress). "
                    "Wins over --exclude-ms. Time selection only")
    ap.add_argument("--masks", default="auto", choices=["auto", "on", "off"])
    ap.add_argument("--task", default=DEFAULT_TASK)
    ap.add_argument("--max-blink", type=float, default=0.5, help="minimum blink threshold; the effective one is max(this, capture median + 0.25)")
    ap.add_argument("--pose-bins", type=int, default=0, help="W7f OPTION (0 = off): read this many times more video "
                    "frames, then keep --bin-min frames of every pose bin (chin up / down, left / right, profile) first and "
                    "fill the rest of --frames-total evenly over time. Try 3")
    ap.add_argument("--pose-extra", default="", help="W7f OPTION C (off = empty): keep the even frames and ADD frames "
                    "only for pose bins the even set misses, e.g. chinup:4,chindown:2 (chin up = pitch <= -12 deg: nostrils, "
                    "under the nose / chin; chin down = pitch >= 12 deg). Extra frames are marked \"extra\" in prepare.json")
    ap.add_argument("--yaw-quota", type=int, default=0, help="OPTION (2026-10-22, 0 = off): keep the even frames and ADD "
                    "frames until every 15 deg head-turn bin and each no-face profile side has at least this many. Try 5")
    ap.add_argument("--yaw-quota-profile", type=int, default=0, help="--yaw-quota: own quota for the two no-face profile bins "
                    "(beyond ~60 deg; they already hold 6-11 even frames, so --yaw-quota 5 added none there - woo03/woo02 10/22). "
                    "0 = same as --yaw-quota. Try 15")
    ap.add_argument("--yaw-dense", type=int, default=6, help="--yaw-quota: video scanned this many times denser than the even frames")
    ap.add_argument("--yaw-max-extra", type=int, default=40, help="--yaw-quota: at most this many frames added")
    ap.add_argument("--select", default="time", choices=["time", "angle"], help="OPTION (2026-10-24, default time = unchanged): "
                    "angle = the same --frames-total spread evenly over the head pose instead of over time (select_by_angle)")
    ap.add_argument("--angle-front", type=int, default=16, help="--select angle: frames kept near frontal (|yaw|, |pitch| < 10)")
    ap.add_argument("--angle-profile", type=int, default=5, help="--select angle: frames kept per side at 80-100 deg, |pitch| < 12")
    ap.add_argument("--angle-gap", type=float, default=8.0, help="--select angle: fill yaw gaps wider than this (deg) between level frames")
    ap.add_argument("--angle-gap-max-add", type=int, default=12, help="--select angle: at most this many gap frames on top of --frames-total")
    ap.add_argument("--include-frames", default="", help="--select angle: video frame numbers always taken (fixed evaluation "
                    "frames of a test series, e.g. the R0 / hand-traced frames), comma separated")
    ap.add_argument("--bin-min", type=int, default=8, help="W7f: frames kept per pose bin (when the video has them)")
    ap.add_argument("--drop-noface", action="store_true", help="old behaviour: with masks, drop frames where no face is found (profiles)")
    a = ap.parse_args()
    files = sorted(os.path.join(a.src, f) for f in os.listdir(a.src) if not f.startswith("."))
    photos = [f for f in files if f.lower().endswith(PHOTO_EXT)]
    videos = [f for f in files if f.lower().endswith(VIDEO_EXT)]
    if not photos and not videos:
        raise SystemExit(f"no photos/videos in {a.src} (supported: {PHOTO_EXT + VIDEO_EXT})")
    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "masks"), exist_ok=True)
    rep = {"input_dir": os.path.abspath(a.src), "photos_in": len(photos), "videos_in": [], "rejected": {}}
    rej = lambda k: rep["rejected"].__setitem__(k, rep["rejected"].get(k, 0) + 1)

    # 1-2. collect candidates: (name, bgr, exif, sharp, source)
    cands = []
    for i, p in enumerate(photos):
        bgr, exif, note = load_photo(p, a.max_side)
        if bgr is None:
            rej(note); continue
        sharp = float(cv2.Laplacian(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        cands.append((f"p{i:03d}_{ascii_stem(p)}.jpg", bgr, exif, sharp, "photo"))
    if videos:
        per = max(12, math.ceil(a.frames_total / len(videos))) * max(1, a.pose_bins)
        for vi, v in enumerate(videos):
            info, frs = video_frames(v, per, a.max_side, exclude_ms(a), pose_rows(a), pose_gyro(a))
            rep["videos_in"].append(info)
            for k, fr, sharp in frs:
                cands.append((f"v{vi}_{ascii_stem(v)}_{k:05d}.jpg", fr, None, sharp, "video"))

    # 3. blur filter per source type (photos and frames have different sharpness scales)
    keep = []
    for src in ("photo", "video"):
        group = [c for c in cands if c[4] == src]
        if not group:
            continue
        thr = (0.35 if src == "photo" else 0.5) * float(np.median([c[3] for c in group]))
        for c in group:
            (keep.append(c) if c[3] >= thr else rej("blur"))

    det = make_detector(a.task)
    try:
        aru = ("new", cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)))
    except AttributeError:
        aru = ("old", cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50))
    items = []
    for name, bgr, exif, sharp, src in keep:
        fm = face_mask_pose(det, bgr, with_blink=True)
        ids = marker_ids(aru, bgr)
        blink = None if fm is None else fm[3]
        items.append({"name": name, "bgr": bgr, "exif": exif, "sharp": sharp, "src": src,
                      "mask": None if fm is None else fm[0], "yaw": None if fm is None else fm[1],
                      "pitch": None if fm is None else fm[2], "blink": blink, "marker": {0, 1} <= ids})

    # 3b. eyes-open baseline (10/14 decision): drop BLINK frames only. The threshold is relative to this capture's
    # median, because the eyeBlink score is biased by eye shape (narrow / monolid eyes score high while open) - an
    # absolute cut could throw away most frames of a real person. Synthetic closed-eye heads keep all frames.
    bl = [it["blink"] for it in items if it.get("blink") is not None]
    blink_thr = None
    if len(bl) >= 5:
        blink_thr = max(a.max_blink, float(np.median(bl)) + 0.25)
        kept_items = []
        for it in items:
            if it.get("blink") is not None and it["blink"] > blink_thr:
                rej("eyes_closed")
            else:
                kept_items.append(it)
        items = kept_items
    rep["blink"] = {"median": round(float(np.median(bl)), 2) if bl else None, "threshold": None if blink_thr is None else round(blink_thr, 2)}
    if a.select == "angle" and videos:
        items = select_by_angle(a, videos, items, rep, det)
    elif a.pose_extra and videos and a.pose_bins <= 1:
        items = add_pose_extra(a, videos, items, blink_thr, rep, det)
    if a.yaw_quota > 0 and videos and a.pose_bins <= 1 and a.select != "angle":
        items = add_yaw_extra(a, videos, items, blink_thr, rep, det)
    if a.pose_bins > 1 and videos:
        before = bin_counts(items); n_read = len(items)
        items = select_by_pose(items, a.frames_total, a.bin_min)
        rep["pose_bins"] = {"read": n_read, "kept": len(items), "bin_min": a.bin_min, "available": before, "kept_per_bin": bin_counts(items)}

    # 4. fixed-camera check: background (outside face) difference between pairs with different head pose
    diffs = []
    faced = [it for it in items if it["mask"] is not None]
    by_size = {}
    for it in faced:
        by_size.setdefault(it["bgr"].shape[:2], []).append(it)
    for grp in by_size.values():
        grp = sorted(grp, key=lambda t: t["yaw"] or 0)
        n = len(grp)
        pairs = [(grp[i], grp[min(n - 1, i + max(1, n // 3))]) for i in range(0, max(n - 1, 0), max(1, n // 12))]
        for x, y in pairs:
            if abs((x["yaw"] or 0) - (y["yaw"] or 0)) < 8:
                continue
            sm = lambda im: cv2.resize(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), (96, 96), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
            bg = (cv2.resize(np.maximum(x["mask"], y["mask"]), (96, 96)) < 128)
            bg = cv2.erode(bg.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
            if bg.sum() < 500:
                continue
            diffs.append(float(np.abs(sm(x["bgr"]) - sm(y["bgr"]))[bg].mean()))
    fixed_score = float(np.median(diffs)) if diffs else None
    # <0.03 still background (fixed phone, head turns) / >0.06 background moves (phone moved around a still head)
    # in between (plain wall, exposure changes) -> uncertain: masks for videos (usually head-turn), none for photos
    if fixed_score is None:
        camera = "unknown"
    else:
        camera = "fixed" if fixed_score < 0.03 else "moving" if fixed_score > 0.06 else "uncertain"
    fixed_camera = camera == "fixed"
    auto_masks = fixed_camera or (camera in ("uncertain", "unknown") and bool(videos))
    use_masks = a.masks == "on" or (a.masks == "auto" and auto_masks)

    # write
    poses, sizes, n_marker = [], {}, 0
    # frames with no face found (near-90 deg profiles, 2026-10-19 capture = left/right 90 deg) are KEPT even when masks
    # are chosen: structure-from-motion uses head_masks.py (it builds a head mask for them from the segmentation), and
    # these frames carry the side profile / ear outline. --drop-noface restores the old behaviour.
    n_noface = 0
    for it in items:
        if it["mask"] is None:
            if use_masks and a.drop_noface:
                rej("no_face_with_masks"); continue
            n_noface += 1
        out_img = os.path.join(a.out, "images", it["name"])
        save_jpg(out_img, it["bgr"], it["exif"])
        if it["mask"] is not None:
            cv2.imwrite(os.path.join(a.out, "masks", it["name"] + ".png"), it["mask"])
        h, w = it["bgr"].shape[:2]
        sizes[f"{w}x{h}"] = sizes.get(f"{w}x{h}", 0) + 1
        n_marker += it["marker"]
        poses.append({"file": it["name"], "source": it["src"], "yaw": it["yaw"], "pitch": it["pitch"], "extra": it.get("extra"),
                      "face": it["mask"] is not None, "marker": it["marker"], "sharpness": round(it["sharp"], 1),
                      "blink": None if it.get("blink") is None else round(it["blink"], 2)})
    # 2026-10-24: MediaPipe false-face flag per image (pipeline/face_flags.py) - read by the lens check and the landmark
    # triangulation. Angle selection carries the flag of its dense scan; otherwise the rule runs on the kept frames.
    import face_flags as _ff
    fl = {it["name"]: it["false_face"] for it in items if "false_face" in it} if a.select == "angle" else {}
    if not fl: fl = _ff.prepare_flags({"images": poses})
    for p_ in poses: p_["false_face"] = bool(fl.get(p_["file"], False))
    yaws = [p["yaw"] for p in poses if p["yaw"] is not None]
    pitches = [p["pitch"] for p in poses if p["pitch"] is not None]
    rep.update({
        "images_kept": len(poses), "image_sizes": sizes, "single_camera": len(sizes) == 1 and not (photos and videos),
        "fixed_camera_score": fixed_score, "camera_motion": camera, "fixed_camera": fixed_camera, "use_masks": use_masks,
        "masks_dir": os.path.join(os.path.abspath(a.out), "masks") if use_masks else None,
        "yaw_range_deg": [round(min(yaws), 1), round(max(yaws), 1)] if yaws else None,
        "pitch_range_deg": [round(min(pitches), 1), round(max(pitches), 1)] if pitches else None,
        "marker_images": n_marker, "no_face_kept": n_noface, "advice": [], "images": poses})
    adv = rep["advice"]
    if len(poses) < 30:
        adv.append(f"사용 가능한 이미지가 {len(poses)}장뿐입니다. 40장 이상을 권장합니다.")
    if yaws and min(yaws) > -40:
        adv.append("한쪽 측면(45° 이상) 각도가 부족합니다.")
    if yaws and max(yaws) < 40:
        adv.append("반대쪽 측면(45° 이상) 각도가 부족합니다.")
    if pitches and max(pitches) - min(pitches) < 20:
        adv.append("위·아래 각도가 부족합니다(코 밑면). 턱을 든 각도와 숙인 각도를 추가해 주세요.")
    if n_marker < 3:
        adv.append(("마커 카드가 보이지 않습니다." if n_marker == 0 else f"마커 카드가 {n_marker}장에서만 보입니다.") + " mm 단위는 쓰지 않고 상대값(%)으로 표시됩니다.")
    if n_noface:
        adv.append(f"얼굴 점이 잡히지 않은 프레임 {n_noface}장(측면 60~90° 추정)은 옆 윤곽·귀·카메라 위치 계산에만 씁니다.")
    if rep["rejected"].get("eyes_closed"):
        adv.append(f"눈을 감은 프레임 {rep['rejected']['eyes_closed']}장을 뺐습니다 (눈 뜬 상태 기준). 촬영 중 눈을 뜨고 깜빡임을 줄여 주세요.")
    if rep["rejected"].get("heic_unsupported"):
        adv.append("HEIC 사진을 읽지 못했습니다: pip install pillow-heif (npm run setup이 설치를 시도합니다)")
    if any("error" in v for v in rep["videos_in"]):
        adv.append("읽지 못한 영상이 있습니다. MP4(H.264)로 다시 내보내 주세요.")
    if use_masks:
        adv.append("폰 고정·고개 돌리기 촬영으로 보고 얼굴 마스크를 사용합니다." + ("" if fixed_camera else " (배경 판정 불확실: 영상이라 마스크 선택, 바꾸려면 --masks off)"))
    json.dump(rep, open(os.path.join(a.out, "prepare.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({k: rep[k] for k in ("photos_in", "images_kept", "rejected", "image_sizes", "single_camera",
                                          "fixed_camera_score", "camera_motion", "use_masks", "yaw_range_deg", "pitch_range_deg",
                                          "marker_images", "advice")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
