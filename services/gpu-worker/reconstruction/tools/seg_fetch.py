"""Download MediaPipe's multiclass selfie segmentation model (Apache-2.0, ~16 MB) once:
classes per pixel 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others (accessories).
Used to tell skin from hair / clothes in the photos (ears, neck, upper body; 2026-10-16).
  python tools/seg_fetch.py            (writes assets/selfie_multiclass_256x256.tflite + a check on one capture frame)
"""
import glob, hashlib, json, os, sys, urllib.request
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
DST = os.path.join(ROOT, "assets", "selfie_multiclass_256x256.tflite")


def main():
    if not os.path.exists(DST) or os.path.getsize(DST) < 1_000_000:
        print("downloading", URL, flush=True)
        req = urllib.request.Request(URL, headers={"User-Agent": "live-mirror-poc"})
        tmp = DST + ".part"
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as fh:
            fh.write(r.read())
        b = open(tmp, "rb").read(8)
        if b[4:8] != b"TFL3": raise SystemExit("not a tflite model (download blocked?)")
        os.replace(tmp, DST)
    sha = hashlib.sha256(open(DST, "rb").read()).hexdigest()
    info = {"file": DST, "bytes": os.path.getsize(DST), "sha256": sha}
    # self-check on one capture frame (class shares), so the result can be verified
    frames = sorted(glob.glob(os.path.join(ROOT, "work", "*", "prep", "images", "*.jpg")))
    if frames:
        import cv2, numpy as np, mediapipe as mp
        from mediapipe.tasks.python import vision, BaseOptions
        seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_buffer=open(DST, "rb").read()), output_category_mask=True))
        img = cv2.imread(frames[len(frames) // 2])
        r = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
        cm = r.category_mask.numpy_view()
        names = ["background", "hair", "body_skin", "face_skin", "clothes", "others"]
        info["check_frame"] = os.path.relpath(frames[len(frames) // 2], ROOT)
        info["class_share_pct"] = {n: round(float((cm == i).mean() * 100), 1) for i, n in enumerate(names)}
    json.dump(info, open(os.path.join(ROOT, "assets", "selfie_multiclass.json"), "w"), indent=1)
    print(json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
