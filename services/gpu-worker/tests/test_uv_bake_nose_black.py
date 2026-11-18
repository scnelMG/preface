"""reconstruction/pipeline/uv_bake.py: nose_black_clean (S15P31B204-413).

Synthetic flat map only: no face images. Skipped without NumPy·OpenCV (CI installs neither).
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

S = 256
SKIN = (150, 170, 205)  # BGR


def test_nose_black_clean_refills_black_keeps_shading():
    tex = np.full((S, S, 3), SKIN, np.uint8)
    tex[100:110, 100:110] = (20, 20, 25)  # black smear (photo nostril)
    tex[140:150, 100:140] = (np.array(SKIN) * 0.6).astype(np.uint8)  # the nose's own shading (alar groove)
    tex[30:40, 30:40] = (20, 20, 25)  # black outside the nose region
    region = np.zeros((S, S), bool)
    region[80:180, 80:180] = True
    out, n = uv_bake.nose_black_clean(tex, region, region, 0.5)
    assert n > 0
    assert out[100:110, 100:110].min() > 120  # black refilled from the skin around it
    assert (out[143:147, 105:135] == tex[143:147, 105:135]).all()  # shading kept
    assert (out[30:40, 30:40] == tex[30:40, 30:40]).all()  # outside the nose untouched
