"""reconstruction/pipeline/ear_fit.py: mean_ear_shape gives the ear the mean ear's shape, kept in place (S15P31B204-764).

Synthetic mesh only. Skipped without NumPy·SciPy (CI installs neither).
"""

import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline"))
from ear_fit import mean_ear_shape
from template_fit import umeyama


def _grid(n=24):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    V = np.c_[x.ravel(), y.ravel(), np.zeros(n * n)]
    i = (np.arange(n - 1)[:, None] * n + np.arange(n - 1)).ravel()
    F = np.r_[np.c_[i, i + 1, i + n], np.c_[i + 1, i + n + 1, i + n]]
    return V, F


def test_ear_takes_the_mean_shape_and_far_skin_stays():
    M, F = _grid()
    ear = (M[:, 0] >= 8) & (M[:, 0] < 16) & (M[:, 1] >= 8) & (M[:, 1] < 16)
    M[ear, 2] = np.sin(M[ear, 0]) + 0.3 * M[ear, 1]  # a 3D "ear" on a flat "head"
    th = 0.3
    R = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    V = 1.2 * M @ R.T + [5.0, -2.0, 1.0]  # the fitted head: the mean, moved
    V[ear] += np.random.default_rng(0).normal(0, 0.4, (ear.sum(), 3))  # ... with a crumpled ear
    rep = {}
    out = mean_ear_shape(V, F, M, ear.astype(float), np.ones(len(V), int), rep, iod=10.0)

    s, Rf, t = umeyama(M[ear], out[ear])
    assert np.abs((s * (Rf @ M[ear].T)).T + t - out[ear]).max() < 1e-9  # exactly the mean shape
    assert abs(s - 1.2) < 0.05  # size kept from the fit
    far = np.abs(M[:, :2] - 12).max(1) > 12 - 1  # grid border, > 6 rings from the ear
    assert np.allclose(out[far], V[far])
    assert set(rep["mean_ear"]) == {"left"}  # no right ear vertices -> skipped
