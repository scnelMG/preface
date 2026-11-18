"""Head-turn video scan (any phone, no helper): the phone stays still, the person slowly turns the head.

prepare: video (or a folder of frames) -> evenly spaced sharp frames -> MediaPipe face landmarks + head pose per
frame -> face mask (convex hull of the face mesh, dilated, extended up to the hairline band) written in COLMAP's mask
format (<image>.png in a parallel folder) -> coverage report (yaw/pitch range, frames kept/rejected).
Because the head moves and the background does not, only masked face pixels may be used for matching: COLMAP then
solves the head-relative camera path as if the phone had orbited a still head.

usage:
  python video_scan.py prepare <video.mp4|framesDir> <outDir> [--frames 70] [--task face_landmarker.task]
  -> outDir/images/*.jpg, outDir/masks/*.jpg.png, outDir/coverage.json
then COLMAP with masks (tools/colmap/run_colmap.ps1 -Masks outDir/masks) or tools/colmap/sfm_check.py --masks.
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TASK = os.path.join(HERE, "..", "assets", "face_landmarker.task")


def read_frames(src, n_target):
    import cv2
    if os.path.isdir(src):
        names = sorted(f for f in os.listdir(src) if f.lower().endswith((".jpg", ".jpeg", ".png")))
        idx = np.linspace(0, len(names) - 1, min(n_target * 2, len(names))).astype(int)
        for i in sorted(set(idx)):
            yield names[i], cv2.imread(os.path.join(src, names[i]))
        return
    cap = cv2.VideoCapture(src)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    idx = set(np.linspace(0, max(total - 1, 0), min(n_target * 2, max(total, 1))).astype(int).tolist())
    k = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        if k in idx:
            yield f"frame_{k:05d}.jpg", fr
        k += 1


def head_angles(M):
    R = np.array(M)[:3, :3]
    yaw = np.degrees(np.arctan2(R[0, 2], R[2, 2]))
    pitch = np.degrees(np.arcsin(-np.clip(R[1, 2], -1, 1)))
    return float(yaw), float(pitch)


def make_detector(task=DEFAULT_TASK):
    import mediapipe as mp
    return mp.tasks.vision.FaceLandmarker.create_from_options(mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_buffer=open(task, "rb").read()), num_faces=1,
        output_facial_transformation_matrixes=True, output_face_blendshapes=True))


def face_mask_pose(det, fr, with_blink=False):
    """BGR frame -> (mask uint8 HxW, yaw, pitch) or None if no face. Mask = face-mesh hull extended toward the
    hairline and dilated, in COLMAP mask convention (white = use)."""
    import cv2
    import mediapipe as mp
    rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not r.face_landmarks:
        return None
    h, w = fr.shape[:2]
    pts = np.array([[p.x * w, p.y * h] for p in r.face_landmarks[0][:468]])
    # extend upward toward the hairline: push the top 10% of hull points up by 8% of face height
    fh = pts[:, 1].max() - pts[:, 1].min()
    top = pts[:, 1] < pts[:, 1].min() + 0.1 * fh
    pts2 = np.concatenate([pts, pts[top] - [0, 0.08 * fh]])
    hull = cv2.convexHull(pts2.astype(np.float32)).astype(np.int32)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(mask, hull, 255)
    mask = cv2.dilate(mask, np.ones((max(3, int(0.03 * fh)),) * 2, np.uint8))
    yaw, pitch = head_angles(r.facial_transformation_matrixes[0]) if r.facial_transformation_matrixes else (None, None)
    if with_blink:
        # eyes-open baseline: max of eyeBlinkLeft/Right blendshape (0 open .. 1 closed), None if unavailable
        blink = None
        if getattr(r, "face_blendshapes", None):
            sc = {c.category_name: c.score for c in r.face_blendshapes[0]}
            if "eyeBlinkLeft" in sc:
                blink = max(sc["eyeBlinkLeft"], sc.get("eyeBlinkRight", 0.0))
        return mask, yaw, pitch, blink
    return mask, yaw, pitch


def prepare(src, out, n_frames=70, task=DEFAULT_TASK):
    import cv2
    os.makedirs(os.path.join(out, "images"), exist_ok=True)
    os.makedirs(os.path.join(out, "masks"), exist_ok=True)
    det = make_detector(task)
    cands = []
    for name, fr in read_frames(src, n_frames):
        if fr is None:
            continue
        sharp = float(cv2.Laplacian(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        cands.append((name, fr, sharp))
    if not cands:
        raise SystemExit("no frames")
    thr = 0.5 * np.median([c[2] for c in cands])  # drop frames much blurrier than typical (motion blur)
    kept, rejected, poses = 0, {"blur": 0, "no_face": 0}, []
    for name, fr, sharp in cands:
        if sharp < thr:
            rejected["blur"] += 1
            continue
        fm = face_mask_pose(det, fr)
        if fm is None:
            rejected["no_face"] += 1
            continue
        mask, yaw, pitch = fm
        base = os.path.splitext(name)[0] + ".jpg"
        cv2.imwrite(os.path.join(out, "images", base), fr, [cv2.IMWRITE_JPEG_QUALITY, 95])
        cv2.imwrite(os.path.join(out, "masks", base + ".png"), mask)
        poses.append({"file": base, "yaw": yaw, "pitch": pitch, "sharpness": sharp})
        kept += 1
    yaws = [p["yaw"] for p in poses if p["yaw"] is not None]
    pitches = [p["pitch"] for p in poses if p["pitch"] is not None]
    cov = {"frames_kept": kept, "rejected": rejected,
           "yaw_range_deg": [min(yaws), max(yaws)] if yaws else None,
           "pitch_range_deg": [min(pitches), max(pitches)] if pitches else None,
           "advice": []}
    if yaws and min(yaws) > -45:
        cov["advice"].append("고개를 한쪽으로 더 돌려 주세요 (측면 45° 이상)")
    if yaws and max(yaws) < 45:
        cov["advice"].append("반대쪽으로도 45° 이상 돌려 주세요")
    if pitches and (max(pitches) - min(pitches)) < 25:
        cov["advice"].append("턱을 들고 내리는 동작을 추가해 주세요 (코 밑면)")
    cov["frames"] = poses
    json.dump(cov, open(os.path.join(out, "coverage.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: cov[k] for k in ("frames_kept", "rejected", "yaw_range_deg", "pitch_range_deg", "advice")}, ensure_ascii=False))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prepare"])
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--frames", type=int, default=70)
    ap.add_argument("--task", default=DEFAULT_TASK)
    a = ap.parse_args()
    prepare(a.src, a.out, a.frames, a.task)
