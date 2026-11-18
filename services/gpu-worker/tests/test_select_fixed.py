"""reconstruction/pipeline/scan_to_model.py: the fixed candidate choice and the shared quality helpers."""

import importlib.util
import sys
from pathlib import Path

import pytest

pytest.importorskip("numpy")

_pipe = Path(__file__).resolve().parents[1] / "reconstruction" / "pipeline"
sys.path.insert(0, str(_pipe))
_spec = importlib.util.spec_from_file_location("scan_to_model", _pipe / "scan_to_model.py")
stm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(stm)


def test_default_pool_is_fixed_to_the_eye_candidate():
    # service default: --no-lm + eye step -> gnmb (base, not evaluated), gnm, gnme
    assert stm.fixed_choice(["gnmb", "gnm", "gnme"], eye_parts=True) == "gnme"
    # the eye step failed (no gnme) -> gnm
    assert stm.fixed_choice(["gnmb", "gnm"], eye_parts=True) == "gnm"
    assert stm.fixed_choice(["gnmb", "gnm", "gnme"], eye_parts=False) == "gnm"


def test_real_alternatives_or_selection_options_keep_the_evaluation():
    assert stm.fixed_choice(["lm", "gnmb", "gnm", "gnme"], eye_parts=True) is None
    assert stm.fixed_choice(["gnmb", "gnm", "gnme", "gnme_pr"], eye_parts=True) is None
    assert stm.fixed_choice(["gnmb", "gnm", "gnme"], eye_parts=True, eval_gnmb=True) is None
    assert stm.fixed_choice(["gnmb", "gnm", "gnme"], eye_parts=True, select_prefer="gnm") is None
    assert stm.fixed_choice(["gnmb", "gnm", "gnme"], eye_parts=True, select_max_crease=0.15) is None
    assert stm.fixed_choice(["lm"], eye_parts=True) is None


def test_accept_of_matches_the_limits():
    acc = stm.accept_of({"front_0_15": {"pct_iod": 1.5}, "side_35_90": {"pct_iod": 7.8}})
    assert acc["front_0_15"] == {"limit_pct_iod": 2.0, "value": 1.5, "pass": True}
    assert acc["side_35_90"]["pass"] is False
    assert acc["three_quarter_15_35"] == {"limit_pct_iod": 3.0, "value": None, "pass": None}


def test_line_holdout_abs_uses_holdout_rows_per_band():
    row = lambda band, hold, v: {"band": band, "holdout": hold, "outline": {"median_abs": v}}
    pf = [
        row("front_0_15", True, 1.0),
        row("front_0_15", True, 3.0),
        row("front_0_15", False, 50.0),
        row("side_35_90", True, 4.0),
    ]
    assert stm.line_holdout_abs(pf) == 3.0  # mean of the band medians 2.0 and 4.0; training rows ignored
    assert stm.line_holdout_abs([row("front_0_15", False, 1.0)]) is None
