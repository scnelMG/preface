"""reconstruction/pipeline/uv_bake.py: eye_front_last (S15P31B204-569).

Synthetic eyeballs only: no face images. Skipped without NumPy (CI installs none).
"""

import importlib.util
import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
PIPE = Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline"
sys.path.insert(0, str(PIPE))
_spec = importlib.util.spec_from_file_location("uv_bake", PIPE / "uv_bake.py")
uv_bake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(uv_bake)


def test_shared_eye_texel_takes_the_first_eyes_front():
    # two unit balls (components 1, 2) looking along +z; each has a front and a back triangle, all four on ONE uv triangle
    i = np.arange(30) + 0.5
    phi, th = np.arccos(1 - 2 * i / 30), np.pi * (1 + 5**0.5) * i
    ball = np.c_[np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)]
    V, mat, comp, F = [], [], [], []
    for cid, x in ((1, -3.0), (2, 3.0)):
        o = len(V)
        V += list(ball + [x, 0, 0]) + [
            [x - 0.1, 0, 1.1],
            [x + 0.1, 0, 1.1],
            [x, 0.1, 1.1],
        ]  # ball + iris points
        mat += [4] * 30 + [5] * 3
        comp += [cid] * 33
        z = ball[:, 2]
        F += [o + np.argsort(-z)[:3], o + np.argsort(z)[:3]]  # front triangle, back triangle
    V, mat, comp, F = np.array(V), np.array(mat), np.array(comp), np.array(F)
    UV = np.array([[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]])
    UT = np.zeros((4, 3), int) + [0, 1, 2]
    tris = np.arange(4)  # template order: front 1, back 1, front 2, back 2 -> "last wins" picked back 2
    order = uv_bake.eye_front_last(tris, V, F, mat, comp)
    assert sorted(order) == [0, 1, 2, 3]
    _, _, tt, _ = uv_bake.raster_layout(16, order, UV, UT)
    assert (tt == 0).all()  # every shared texel: the first eye's front triangle
