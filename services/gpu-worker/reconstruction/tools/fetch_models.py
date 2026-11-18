"""Download the model files the reconstruction code needs (not kept in git: binary model weights).

  python tools/fetch_models.py            # extract only: MediaPipe face landmarker (about 3.7 MB)
  python tools/fetch_models.py --all      # GPU worker: + selfie segmentation (16 MB) + GNM head (53 MB) + template link

Files are checked against the SHA-256 recorded here; a mismatch stops with an error and leaves nothing behind.
Without the segmentation and GNM files the model stage silently falls back to a weaker fit, so the GPU worker needs --all.
"""
import hashlib, os, subprocess, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
MODELS = {
    # MediaPipe Face Landmarker (Apache-2.0), same file as the PoC assets (2026-10-26 checked)
    "assets/face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"),
}
GPU_MODELS = {
    # MediaPipe Selfie Multiclass (Apache-2.0): version 1 = the PoC file = the "latest" seg_fetch.py gets (2026-10-26 checked)
    "assets/selfie_multiclass_256x256.tflite": (
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
        "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0"),
    # GNM Head v3 (Google, Apache-2.0, assets/GNM-LICENSE.txt), same URL and hash as tools/gnm_fetch.py
    "assets/gnm/v3_0/gnm_head.npz": (
        "https://huggingface.co/google/gnm-v3/resolve/main/v3_0/gnm_head.npz",
        "61d78bbfb4ad8e0b38495804a4caef3214d3df00f8c3f68761e63b41ce3747eb"),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def main():
    gpu = "--all" in sys.argv[1:]
    for rel, (url, sha) in (MODELS | GPU_MODELS if gpu else MODELS).items():
        dst = os.path.join(ROOT, rel)
        if os.path.exists(dst) and sha256(dst) == sha:
            print(f"ok   {rel}"); continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".part"
        req = urllib.request.Request(url, headers={"User-Agent": "preface-reconstruction"})
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
            while b := r.read(1 << 20): f.write(b)
        got = sha256(tmp)
        if got != sha:
            os.remove(tmp); sys.exit(f"checksum mismatch {rel}: {got}")
        os.replace(tmp, dst); print(f"got  {rel}")
    if gpu:
        # gnm_fetch.py finds the verified head file and only writes the link to our template (assets/gnm/template_map.npz)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "gnm_fetch.py")], check=True)


if __name__ == "__main__":
    main()
