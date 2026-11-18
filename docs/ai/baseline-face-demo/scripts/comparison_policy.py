"""AI-579 합성 첫 비교의 근거·품질 게이트. 실제 사용자 모델에는 사용하지 않는다."""

import math

from grounded_gms import CARDS


REQUIRED_GATES = (
    "landmarksVerified", "viewAligned", "controlSupported", "safeRangeKnown", "shapeValidated",
)


def finite_number(value):
    return type(value) is int or (type(value) is float and math.isfinite(value))


def first_comparison(measurements, choice, model, *, measurement_bounds):
    card = CARDS.get("ALAR_FIRST_COMPARISON")
    if (not card or card.get("use") != "synthetic_comparison_hypothesis"
            or card.get("sourceType") != "expert_narrative"
            or card.get("measurements") != ["alarWidth", "intercanthalDistance"]
            or card.get("url") != "https://pmc.ncbi.nlm.nih.gov/articles/PMC9337225/"
            or card.get("control") != "nose.alar_width"
            or card.get("direction") != "narrow"):
        return {"status": "deferred", "reason": "근거 카드의 허용 범위 불일치"}
    if model.get("source") != "procedural_synthetic_3d_only":
        return {"status": "deferred", "reason": "실제 모델의 근거·품질 검증 전"}
    if not all(model.get(gate) is True for gate in REQUIRED_GATES):
        return {"status": "deferred", "reason": "측정·지원·형상 검사 미완료"}
    if choice != {"evidenceId": "ALAR_FIRST_COMPARISON", "visualAgreement": "AGREES"}:
        return {"status": "deferred", "reason": "시각적 정합 또는 출처 불확실"}
    if any(not finite_number(measurements.get(name)) or measurements[name] <= 0
           for name in card["measurements"]):
        return {"status": "deferred", "reason": "측정값 누락 또는 오류"}
    if not isinstance(measurement_bounds, dict):
        return {"status": "deferred", "reason": "측정 오차 범위 누락 또는 오류"}
    for name in card["measurements"]:
        bounds = measurement_bounds.get(name)
        if (not isinstance(bounds, (tuple, list)) or len(bounds) != 2
                or not all(map(finite_number, bounds))
                or not 0 < bounds[0] <= measurements[name] <= bounds[1]):
            return {"status": "deferred", "reason": "측정 오차 범위 누락 또는 오류"}
    if measurement_bounds["alarWidth"][0] <= measurement_bounds["intercanthalDistance"][1]:
        return {"status": "deferred", "reason": "근거의 적용 조건 미충족"}
    return {
        "status": "preview_hypothesis", "evidenceId": "ALAR_FIRST_COMPARISON",
        "source": card["url"], "control": card["control"], "direction": card["direction"],
        "magnitude": None, "applied": False,
    }
