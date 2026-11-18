import pytest

from app.consult import Action
from app.morph_values import calculate_candidate


def action(code: str, direction: int = 1, source: str = "콧대") -> Action:
    return Action(code=code, side="both", direction=direction, strength="small", source=source)


def test_nose_candidate_uses_model_limit_and_preserves_existing_eye_state():
    current = {"nose.bridge_height": 0.1, "eye.tail_angle.right": 0.2}
    candidate = calculate_candidate(
        [action("nose.bridge_height")], current, {"nose.bridge_height": (-0.5, 0.15)}
    )

    assert current == {"nose.bridge_height": 0.1, "eye.tail_angle.right": 0.2}
    assert candidate.weights == {"nose.bridge_height": 0.15, "eye.tail_angle.right": 0.2}
    assert [
        (change.code, change.before, change.candidate, change.range_limited) for change in candidate.changes
    ] == [("nose.bridge_height", 0.1, 0.15, True)]


def test_nose_candidate_ignores_inactive_eye_limit_but_preserves_eye_state():
    candidate = calculate_candidate(
        [action("nose.bridge_height")],
        {"eye.tail_angle.right": 0.2},
        {"nose.bridge_height": (-0.5, 0.5), "eye.tail_angle.right": (0, 0)},
    )

    assert candidate.weights == {"eye.tail_angle.right": 0.2, "nose.bridge_height": 0.1}
    assert [change.code for change in candidate.changes] == ["nose.bridge_height"]


def test_mixed_request_keeps_nose_candidate_and_skips_eye_and_unsupported_nose():
    candidate = calculate_candidate(
        [
            action("nose.tip_projection", source="코끝"),
            action("eye.tail_angle", source="눈꼬리"),
            action("nose.alar_width", source="콧볼"),
        ],
        {},
        {"nose.tip_projection": (-1, 1)},
    )

    assert [change.code for change in candidate.changes] == ["nose.tip_projection"]
    assert [item.source for item in candidate.skipped] == ["눈꼬리", "콧볼"]
    assert candidate.weights == {"nose.tip_projection": 0.1}


def test_two_nose_actions_are_one_candidate_and_zero_removes_weight():
    candidate = calculate_candidate(
        [action("nose.tip_projection", source="코끝 돌출"), action("nose.tip_height", -1, "코끝 높이")],
        {"nose.tip_height": 0.1},
        {"nose.tip_projection": (-1, 1), "nose.tip_height": (-1, 1)},
    )

    assert candidate.weights == {"nose.tip_projection": 0.1}
    assert [change.code for change in candidate.changes] == ["nose.tip_projection", "nose.tip_height"]
    assert candidate.changes[1].candidate == 0


def test_invalid_model_limits_fail_without_candidate():
    with pytest.raises(ValueError, match="invalid relative limit"):
        calculate_candidate([action("nose.bridge_height")], {}, {"nose.bridge_height": (0.2, 1)})

    with pytest.raises(ValueError, match="current weight outside model limit"):
        calculate_candidate(
            [action("nose.bridge_height")], {"nose.bridge_height": 0.8}, {"nose.bridge_height": (-0.5, 0.5)}
        )


def test_at_model_limit_does_not_claim_a_change():
    candidate = calculate_candidate(
        [action("nose.bridge_height")],
        {"nose.bridge_height": 0.3},
        {"nose.bridge_height": (-0.5, 0.3)},
    )

    assert candidate.changes == []
    assert candidate.weights == {"nose.bridge_height": 0.3}
    assert candidate.skipped[0].source == "콧대"


def test_decimal_steps_do_not_create_phantom_changes():
    limits = {"nose.bridge_height": (-0.5, 0.5)}
    increased = calculate_candidate([action("nose.bridge_height")], {"nose.bridge_height": 0.2}, limits)
    canceled = calculate_candidate(
        [action("nose.bridge_height"), action("nose.bridge_height", -1)],
        {"nose.bridge_height": 0.2},
        limits,
    )

    assert increased.weights == {"nose.bridge_height": 0.3}
    assert increased.changes[0].candidate == 0.3
    assert canceled.weights == {"nose.bridge_height": 0.2}
    assert canceled.changes == []
    assert canceled.skipped[0].reason == "요청이 서로 상쇄되어 바뀌는 값이 없어요."
