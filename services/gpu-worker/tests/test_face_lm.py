"""reconstruction/pipeline/face_lm.py: the per-frame landmark cache (S15P31B204-451).

The detector is replaced by a stub, so this runs without OpenCV·MediaPipe. Synthetic data only: no face images.
"""

import importlib.util
import os
from pathlib import Path

RECON = Path(__file__).resolve().parents[1] / "reconstruction"
_spec = importlib.util.spec_from_file_location("face_lm", RECON / "pipeline" / "face_lm.py")
face_lm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(face_lm)

# floats that need repr to round trip
LM = [[0.1 + k / 3000, 0.7 - k / 7000, -0.0123456789 * k] for k in range(478)]
M = [
    [0.9998, -0.0175, 0.0012, 1.5],
    [0.0175, 0.9998, 0.0, -2.25],
    [0.0, 0.0, 1.0, -40.0],
    [0.0, 0.0, 0.0, 1.0],
]


class Stub:
    def __init__(self, result):
        self.result, self.calls = result, 0

    def __call__(self, img):
        self.calls += 1
        return self.result


def frame(tmp_path, data=b"synthetic"):
    images = tmp_path / "prep" / "images"
    images.mkdir(parents=True, exist_ok=True)
    (images / "f001.jpg").write_bytes(data)
    return str(images)


def test_second_read_comes_from_the_cache_with_identical_values(tmp_path):
    images, det = frame(tmp_path), Stub({"lm": LM, "M": M})
    first = face_lm.landmarks(images, "f001.jpg", img=object(), detect=det)
    second = face_lm.landmarks(images, "f001.jpg", img=object(), detect=det)
    assert det.calls == 1
    assert first == second == (LM, M)
    assert (tmp_path / "prep" / "lm_cache_v1" / "f001.jpg.json").exists()  # next to images/, not inside it


def test_no_face_is_cached_too(tmp_path):
    images, det = frame(tmp_path), Stub({"lm": None, "M": None})
    assert face_lm.landmarks(images, "f001.jpg", img=object(), detect=det) == (None, None)
    assert face_lm.landmarks(images, "f001.jpg", img=object(), detect=det) == (None, None)
    assert det.calls == 1


def test_a_changed_image_is_detected_again(tmp_path):
    images, det = frame(tmp_path), Stub({"lm": LM, "M": M})
    face_lm.landmarks(images, "f001.jpg", img=object(), detect=det)
    frame(tmp_path, b"another synthetic frame")  # other size -> other key
    face_lm.landmarks(images, "f001.jpg", img=object(), detect=det)
    assert det.calls == 2


def test_prefetch_detects_only_uncached_frames_side_by_side(tmp_path, monkeypatch):
    # S15P31B204-702: the first landmark pass of a job runs on several threads; later reads come from the cache
    import sys
    import threading
    import time
    import types

    monkeypatch.syspath_prepend(str(RECON / "pipeline"))  # prefetch imports parallel.py from there

    images = tmp_path / "prep" / "images"
    images.mkdir(parents=True)
    names = [f"f{i:03d}.jpg" for i in range(8)]
    for n in names:
        (images / n).write_bytes(b"synthetic " + n.encode())
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda p: object()))
    monkeypatch.setenv("LM_BAKE_WORKERS", "4")
    seen = set()

    def det(img):
        seen.add(threading.get_ident())
        time.sleep(0.05)  # long enough for the pool to hand frames to more than one thread
        return {"lm": LM, "M": M}

    face_lm.landmarks(str(images), names[0], img=object(), detect=det)  # already cached -> not detected again
    assert face_lm.prefetch(str(images), names, detect=det) == 7
    assert len(seen) > 1
    again = Stub({"lm": None, "M": None})
    assert all(face_lm.landmarks(str(images), n, img=object(), detect=again) == (LM, M) for n in names)
    assert again.calls == 0
    assert face_lm.prefetch(str(images), names, detect=again) == 0


def test_a_broken_cache_file_is_detected_again(tmp_path):
    images, det = frame(tmp_path), Stub({"lm": LM, "M": M})
    face_lm.landmarks(images, "f001.jpg", img=object(), detect=det)
    (tmp_path / "prep" / "lm_cache_v1" / "f001.jpg.json").write_text("{not json", encoding="utf-8")
    assert face_lm.landmarks(images, "f001.jpg", img=object(), detect=det) == (LM, M)
    assert det.calls == 2
    assert not [n for n in os.listdir(tmp_path / "prep" / "lm_cache_v1") if n.endswith(".tmp")]
