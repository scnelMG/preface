"""Hairline on skin triangles for head.glb (S15P31B204-722), on the GNM template mean head (synthetic, no person)."""

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")

from reconstruction.tools.export_glb import TEMPLATE
from reconstruction.tools.glb_hairline import (
    closest_on_triangles,
    extras_for,
    hairline_on_skin,
    rebuild,
)


def template_skin():
    tpl = np.load(TEMPLATE)
    V = tpl["vertices"].astype(np.float64)
    F = tpl["triangles"].astype(np.int64)
    skin = tpl["materials"] == 0
    return V, F[skin[F].all(1)]


def test_closest_point_on_a_triangle():
    A, B, C = np.array([[0.0, 0, 0]]), np.array([[1.0, 0, 0]]), np.array([[0.0, 1, 0]])
    P = np.array([[0.2, 0.3, 0.5], [2.0, -1.0, 0.0], [-1.0, -1.0, 0.0], [0.6, 0.6, 0.0]])
    w = closest_on_triangles(P, *(np.repeat(x, len(P), 0) for x in (A, B, C)))
    q = w[:, :1] * A + w[:, 1:2] * B + w[:, 2:] * C
    np.testing.assert_allclose(q, [[0.2, 0.3, 0], [1, 0, 0], [0, 0, 0], [0.5, 0.5, 0]], atol=1e-12)
    np.testing.assert_allclose(w.sum(1), 1, atol=1e-12)


def test_points_on_the_skin_come_back_exactly():
    V, F = template_skin()
    rng = np.random.default_rng(0)
    t = rng.choice(len(F), 40, replace=False)
    w = rng.dirichlet([2, 2, 2], 40)
    curve = (w[:, :, None] * V[F[t]]).sum(1)
    pts, d = hairline_on_skin(V, F, curve)
    assert d.max() < 1e-9
    np.testing.assert_allclose(rebuild(pts, V), curve, atol=1e-6)


def test_rebuilds_on_a_moved_and_scaled_head():
    """the app's head is in another frame and size (GLB, eye distance 63 mm): the curve follows the skin"""
    V, F = template_skin()
    rng = np.random.default_rng(1)
    t = rng.choice(len(F), 30, replace=False)
    w = rng.dirichlet([2, 2, 2], 30)
    curve = (w[:, :, None] * V[F[t]]).sum(1)
    pts, _ = hairline_on_skin(V, F, curve)
    c, s = np.sin(0.3), np.cos(0.3)
    R = np.array([[s, 0, c], [0, 1, 0], [-c, 0, s]])
    moved = (V @ R.T) * 0.73 + [0.01, -0.27, 0.02]
    np.testing.assert_allclose(rebuild(pts, moved), (curve @ R.T) * 0.73 + [0.01, -0.27, 0.02], atol=1e-6)


def test_extras_block_and_off_surface_points():
    V, F = template_skin()
    t = np.arange(0, 2000, 100)
    centre = V[F[t]].mean(1)
    nrm = np.cross(V[F[t, 1]] - V[F[t, 0]], V[F[t, 2]] - V[F[t, 0]])
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    curve = centre + nrm * 0.001  # 1 mm off the skin
    block = extras_for({"chosen": "gnme", "curve": curve.tolist()}, "gnme", V, F, glb_scale=1.0)
    assert block["version"] == 1 and len(block["points"]) == len(curve)
    assert all(len(p) == 5 for p in block["points"])
    assert 0.9 < block["max_off_surface_mm"] < 1.1
    assert (
        extras_for({"chosen": "lm", "curve": curve.tolist()}, "gnme", V, F, 1.0) is None
    )  # made on another fit
    assert extras_for({"chosen": "gnme", "curve": []}, "gnme", V, F, 1.0) is None
