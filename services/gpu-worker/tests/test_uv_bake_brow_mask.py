"""reconstruction/pipeline/uv_bake.py: protect_uv_mask brow outline (S15P31B204-413).

Synthetic mesh / UV only: no face images. Skipped without NumPy·OpenCV (CI installs neither).
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


def test_brow_mask_follows_the_arch_not_its_hull():
    # 468 landmark vertices, vertex i = landmark i; texel (x, y) -> uv (x / (S-1), 1 - y / (S-1))
    px = np.full((468, 2), 230.0)  # other rings: a dot in the corner
    xs = np.array([40, 70, 100, 130, 160], float)
    arch = 100 - 20 * np.sin(np.pi * (xs - 40) / 120)  # upper edge, highest in the middle
    upper, lower = np.c_[xs, arch], np.c_[xs[::-1], arch[::-1] + 12]  # outer -> inner, inner -> outer
    px[uv_bake.BROW_L] = np.r_[upper, lower]
    uv = np.c_[px[:, 0] / (S - 1), 1 - px[:, 1] / (S - 1)]
    F = np.arange(468).reshape(-1, 3)
    m = uv_bake.protect_uv_mask(S, uv, F, uv, F, list(range(468)))
    assert m[86, 100] > 0.9  # on the brow
    assert m[105, 100] < 0.05  # under the arch: inside the convex hull, outside the brow
