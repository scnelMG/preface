"""reconstruction/pipeline/ear_fit.py: adjust_ears_contour puts the ear rim on the photo's class border (S15P31B204-331).

Synthetic mesh, camera and class map only: no face images. Skipped without NumPy·SciPy·OpenCV (CI installs none).
"""

import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")
cv2 = pytest.importorskip("cv2")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline"))
from ear_fit import adjust_ears_contour


def _ear(sgn, n=10):
    """square ear patch on the +x (left) or -x (right) side of the head, its back standing out"""
    z, y = np.meshgrid(np.linspace(-0.3, 0.3, n), np.linspace(-0.3, 0.3, n))
    V = np.c_[sgn * (0.1 + 0.1 * (0.3 - z.ravel())), y.ravel(), z.ravel()]
    i = (np.arange(n - 1)[:, None] * n + np.arange(n - 1)).ravel()
    return V, np.r_[np.c_[i, i + 1, i + n], np.c_[i + 1, i + n + 1, i + n]]


def _scene():
    Vl, Fl = _ear(1)
    Vr, Fr = _ear(-1)
    V, F = np.r_[Vl, Vr], np.r_[Fl, Fr + len(Vl)]
    side = np.r_[np.ones(len(Vl), int), -np.ones(len(Vr), int)]
    L = np.zeros((468, 3))
    L[454], L[234], L[10], L[152], L[1] = (0.5, 0, 0), (-0.5, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)
    L[33], L[263] = (-0.5, 0, 0.5), (0.5, 0, 0.5)  # eye distance 1

    # camera on the left (+x) looking at the left ear; the photo's ear (skin) sits 0.06 x IOD higher
    R = np.array([[0.0, 0, -1], [0, -1, 0], [-1, 0, 0]])
    t = -R @ np.array([2.0, 0, 0])
    f, c = 500.0, 200.0
    Q = (Vl + [0, 0.06, 0]) @ R.T + t
    uv = np.c_[f * Q[:, 0] / Q[:, 2] + c, f * Q[:, 1] / Q[:, 2] + c]
    cm = np.zeros((400, 400), np.uint8)
    cv2.fillPoly(cm, [cv2.convexHull(np.round(uv).astype(np.int32))], 3)
    o = ("f", R, t, f, c, c, None, None, None, None, None, cm)
    return V, F, side, [o, o], L, len(Vl)


def test_ear_moves_onto_the_border_and_the_unseen_ear_copies_it():
    V, F, side, obs, L, nl = _scene()
    rep = {}
    out = adjust_ears_contour(V, F, np.ones(len(V)), side, obs, L, rep)
    left, right = rep["ear_fit"]["left"], rep["ear_fit"]["right"]
    assert left["applied"] and abs(left["shift_up_pct_iod"] - 6.0) <= 1.5
    assert abs(left["shift_forward_pct_iod"]) <= 1.5
    assert abs(out[:nl, 1].mean() - 0.06) < 0.02  # the mesh moved, not only the record
    # no frame sees the right ear: it takes the left ear's move, and the record says so
    assert right["applied"] and right["copied_from"] == "left"
    assert right["shift_up_pct_iod"] == left["shift_up_pct_iod"] and right["scale"] == left["scale"]
    assert "own" in right


def test_grid_shortcut_picks_the_exhaustive_winner():
    """S15P31B204-769: the grid moves a once-drawn rim per shift and redraws only the best top_k; with every
    placement redrawn (top_k = all) the result and the record are the same"""
    V, F, side, obs, L, _ = _scene()
    fast, full = {}, {}
    a = adjust_ears_contour(V, F, np.ones(len(V)), side, obs, L, fast)
    b = adjust_ears_contour(V, F, np.ones(len(V)), side, obs, L, full, top_k=10**6)
    assert np.array_equal(a, b) and fast == full
