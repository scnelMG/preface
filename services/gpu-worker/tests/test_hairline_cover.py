"""Headband / hat over the forehead counts as hair for the hairline (pipeline/hairline.py forehead_cover), synthetic class maps."""

import importlib.util
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("cv2")

_spec = importlib.util.spec_from_file_location(
    "hairline", Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline" / "hairline.py"
)
hairline = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hairline)
forehead_cover = hairline.forehead_cover

BG, HAIR, BODY, FACE, CLOTHES, OTHERS = range(6)


def test_headband_on_the_forehead_is_a_cover():
    cm = np.full((60, 40), BG, np.uint8)
    cm[5:15] = HAIR
    cm[15:22] = OTHERS  # headband
    cm[22:50] = FACE
    c = forehead_cover(cm)
    assert c[15:22].all() and c.sum() == 7 * 40


def test_collar_under_the_neck_is_not_a_cover():
    cm = np.full((60, 40), BG, np.uint8)
    cm[5:15] = HAIR
    cm[15:40] = FACE
    cm[40:48] = BODY  # neck
    cm[48:] = CLOTHES  # collar touches the neck only
    assert not forehead_cover(cm).any()


def test_no_cover_classes():
    cm = np.full((20, 20), FACE, np.uint8)
    assert not forehead_cover(cm).any()
