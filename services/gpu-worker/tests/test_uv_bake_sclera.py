"""reconstruction/pipeline/uv_bake.py: sclera_spill_clean (S15P31B204-569).

Synthetic eye map only: no face images. Skipped without NumPy·OpenCV (CI installs neither).
"""

import importlib.util
import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")
PIPE = Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline"
sys.path.insert(0, str(PIPE))
_spec = importlib.util.spec_from_file_location("uv_bake", PIPE / "uv_bake.py")
uv_bake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uv_bake)


def test_sclera_spill_clean_refills_iris_band_keeps_iris_and_corner_shade():
    S = 256
    yy, xx = np.mgrid[:S, :S]
    ang = (np.hypot(yy - S / 2, xx - S / 2) / 2).astype(
        np.float32
    )  # gaze angle grows with the distance from the centre
    tex = np.full((S, S, 3), (200, 205, 210), np.uint8)  # white of the eye (BGR)
    tex[ang < 21] = (40, 45, 60)  # iris (model): stays
    tex[(ang >= 21) & (ang < 30)] = (70, 75, 90)  # photo iris / limbus spilled onto the sclera
    tex[(ang >= 42) & (ang < 50)] = (175, 180, 185)  # softer shading toward the eye corner: stays
    lid = (ang >= 30) & (ang < 42) & (yy < S / 2 - 50)
    tex[lid] = (120, 160, 215)  # eyelid skin over the upper ball (saturated): not a fill source
    out, n = uv_bake.sclera_spill_clean(tex, ang, th_i=21.0, ratio=0.7)
    band = (ang >= 23) & (ang < 28)
    assert n > 0
    # refilled with sclera (the corner shade 175-185 may blend in: < 30), not with the lid skin (mean diff > 40)
    assert np.abs(out[band].astype(int) - (200, 205, 210)).mean(1).max() < 30
    assert (out[ang < 20] == tex[ang < 20]).all()  # iris untouched
    assert (out[(ang >= 43) & (ang < 49)] == tex[(ang >= 43) & (ang < 49)]).all()  # corner shading kept
