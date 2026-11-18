"""Deterministic numeric edit candidates; mesh validation is a separate gate."""

import math
from dataclasses import dataclass
from decimal import Decimal

from app.consult import NOSE_CODES, Action, Skipped

STEP = {"small": 0.1, "medium": 0.2, "large": 0.3}  # Temporary until AI-76 calibration.


@dataclass(frozen=True)
class Change:
    code: str
    before: float
    candidate: float
    range_limited: bool


@dataclass(frozen=True)
class Candidate:
    weights: dict[str, float]
    changes: list[Change]
    skipped: list[Skipped]


def calculate_candidate(
    actions: list[Action], current: dict[str, float], limits: dict[str, tuple[float, float]]
) -> Candidate:
    """Calculate relative nose weights without claiming that the final mesh is valid."""
    if any(isinstance(value, bool) or not math.isfinite(value) for value in current.values()):
        raise ValueError("non-finite current weight")
    nose_limits = {code: bounds for code, bounds in limits.items() if code in NOSE_CODES}
    for low, high in nose_limits.values():
        if not all(math.isfinite(value) for value in (low, high)) or not -1 <= low <= 0 <= high <= 1:
            raise ValueError("invalid relative limit")
    if any(not low <= current[code] <= high for code, (low, high) in nose_limits.items() if code in current):
        raise ValueError("current weight outside model limit")

    requested: dict[str, Decimal] = {}
    sources: dict[str, str] = {}
    skipped: list[Skipped] = []
    for action in actions:
        if action.code not in NOSE_CODES:
            skipped.append(Skipped(source=action.source, reason="1차에는 코만 조절할 수 있어요."))
            continue
        if action.side != "both":
            raise ValueError("nose action has no side")
        if action.code not in nose_limits:
            skipped.append(Skipped(source=action.source, reason="이 모델에서는 조절할 수 없어요."))
            continue
        requested[action.code] = requested.get(
            action.code, Decimal(str(current.get(action.code, 0.0)))
        ) + action.direction * Decimal(str(STEP[action.strength]))
        sources[action.code] = action.source

    weights = dict(current)
    changes: list[Change] = []
    for code, value in requested.items():
        low, high = nose_limits[code]
        candidate = min(max(value, Decimal(str(low))), Decimal(str(high)))
        before = Decimal(str(current.get(code, 0.0)))
        if candidate == before:
            reason = (
                "조절 한계에 도달해 바뀌는 값이 없어요."
                if candidate != value
                else "요청이 서로 상쇄되어 바뀌는 값이 없어요."
            )
            skipped.append(Skipped(source=sources[code], reason=reason))
            continue
        if candidate == 0:
            weights.pop(code, None)
        else:
            weights[code] = float(candidate)
        changes.append(Change(code, float(before), float(candidate), candidate != value))

    # shortcut: numeric bounds only; require the 3D mesh checker and BE contract before exposing INT-AI-02.
    return Candidate(weights, changes, skipped)
