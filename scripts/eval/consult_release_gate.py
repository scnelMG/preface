"""AI-304: 상담 기준선과 후보의 비식별 관측 결과를 배포 전에 비교한다."""

import argparse
import csv
import math
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation


CASE_COLUMNS = ("case_id", "category", "expected_intent", "expected_effects")
RESULT_COLUMNS = (
    "case_id", "intent", "effects", "claimed_applied", "duration_ms",
    "input_tokens", "output_tokens", "observed_debit", "gms_calls",
)
INTENTS = {"EDIT", "REPLY", "CLARIFY", "ERROR"}
EFFECT = re.compile(r"[a-z][a-z0-9_.]*:[+-]:(?:both|left|right)")


def read_rows(path, columns):
    with open(path, encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if tuple(reader.fieldnames or ()) != columns:
            raise ValueError(f"{path}: 필요한 열은 {','.join(columns)}")
        rows = {}
        for row in reader:
            case_id = row["case_id"]
            if not re.fullmatch(r"[A-Za-z0-9_-]+", case_id or "") or case_id in rows:
                raise ValueError(f"{path}: 비어 있거나 중복된 case_id")
            if set(row) != set(columns) or any(value is None for value in row.values()):
                raise ValueError(f"{path}: 누락된 값 ({case_id})")
            rows[case_id] = row
        if not rows:
            raise ValueError(f"{path}: 사례가 없음")
        return rows


def effects(value):
    if not value:
        return ()
    parts = value.split("|")
    if len(parts) != len(set(parts)) or not all(EFFECT.fullmatch(part) for part in parts):
        raise ValueError("효과 형식은 code:+/-:both/left/right, 복합은 |로 구분")
    return tuple(sorted(parts))


def number(value, label, integral=False):
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{label}: 숫자 필요") from None
    if not result.is_finite() or result < 0 or (integral and result != result.to_integral_value()):
        raise ValueError(f"{label}: 0 이상의 유한한 {'정수' if integral else '숫자'} 필요")
    return result


def validate(cases, results, name):
    if cases.keys() != results.keys():
        raise ValueError(f"{name}: 기준 사례와 결과의 case_id가 다름")
    for case_id, case in cases.items():
        expected = case["expected_intent"]
        if not case["category"] or expected not in INTENTS - {"ERROR"}:
            raise ValueError(f"{case_id}: 잘못된 기대 유형")
        expected_effects = effects(case["expected_effects"])
        if (expected == "EDIT") != bool(expected_effects):
            raise ValueError(f"{case_id}: 기대 편집과 효과가 불일치")
        row = results[case_id]
        if row["intent"] not in INTENTS or row["claimed_applied"] not in {"true", "false"}:
            raise ValueError(f"{name}/{case_id}: 잘못된 결과 유형 또는 적용 문구 표시")
        actual_effects = effects(row["effects"])
        if (row["intent"] == "EDIT") != bool(actual_effects):
            raise ValueError(f"{name}/{case_id}: 결과 편집과 효과가 불일치")
        for column in ("duration_ms", "input_tokens", "output_tokens", "observed_debit", "gms_calls"):
            number(row[column], f"{name}/{case_id}/{column}", column != "observed_debit")


def percentile(values, percent):
    ordered = sorted(values)
    return ordered[math.ceil(len(ordered) * percent) - 1]


def summary(cases, results):
    categories = defaultdict(lambda: [0, 0])
    critical = []
    durations = []
    totals = {column: Decimal(0) for column in ("input_tokens", "output_tokens", "observed_debit", "gms_calls")}
    for case_id, case in cases.items():
        row = results[case_id]
        expected_effects = effects(case["expected_effects"])
        actual_effects = effects(row["effects"])
        correct = (row["intent"] == case["expected_intent"]
                   and actual_effects == expected_effects
                   and (row["claimed_applied"] == "true") == (row["intent"] == "EDIT"))
        categories[case["category"]][0] += int(correct)
        categories[case["category"]][1] += 1
        if (row["intent"] == "EDIT" and actual_effects != expected_effects) or (
            row["claimed_applied"] == "true" and row["intent"] != "EDIT"
        ):
            critical.append(case_id)
        durations.append(number(row["duration_ms"], "duration_ms"))
        for column in totals:
            totals[column] += number(row[column], column)
    return categories, critical, totals, percentile(durations, Decimal("0.5")), percentile(durations, Decimal("0.95"))


def gate(cases, baseline, candidate, max_calls, max_debit, max_tokens):
    validate(cases, baseline, "baseline")
    validate(cases, candidate, "candidate")
    base = summary(cases, baseline)
    new = summary(cases, candidate)
    failures = []
    if new[1]:
        failures.append("중대 오편집: " + ", ".join(new[1]))
    for category, (correct, total) in sorted(new[0].items()):
        old_correct, old_total = base[0][category]
        if correct * old_total < old_correct * total:
            failures.append(f"{category} 유형 성공률 하락")
    if new[2]["gms_calls"] > max_calls:
        failures.append("GMS 호출 상한 초과")
    if new[2]["observed_debit"] > max_debit:
        failures.append("관측 크레딧 차감 상한 초과")
    if new[2]["input_tokens"] + new[2]["output_tokens"] > max_tokens:
        failures.append("입력·출력 토큰 합계 상한 초과")
    return base, new, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cases", help="비식별 기대 사례 CSV")
    parser.add_argument("baseline", help="현행 버전 관측 결과 CSV")
    parser.add_argument("candidate", help="후보 버전 관측 결과 CSV")
    parser.add_argument("--max-gms-calls", type=int, required=True)
    parser.add_argument("--max-observed-debit", required=True)
    parser.add_argument("--max-total-tokens", required=True)
    args = parser.parse_args()
    try:
        max_calls = number(str(args.max_gms_calls), "GMS 호출 상한", True)
        max_debit = number(args.max_observed_debit, "관측 크레딧 차감 상한")
        max_tokens = number(args.max_total_tokens, "토큰 합계 상한", True)
        cases = read_rows(args.cases, CASE_COLUMNS)
        baseline = read_rows(args.baseline, RESULT_COLUMNS)
        candidate = read_rows(args.candidate, RESULT_COLUMNS)
        base, new, failures = gate(cases, baseline, candidate, max_calls, max_debit, max_tokens)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    for label, result in (("baseline", base), ("candidate", new)):
        categories, critical, totals, p50, p95 = result
        print(f"{label}: critical={len(critical)} p50={p50}ms p95={p95}ms "
              f"calls={totals['gms_calls']} input={totals['input_tokens']} "
              f"output={totals['output_tokens']} observedDebit={totals['observed_debit']}")
        for category, (correct, total) in sorted(categories.items()):
            print(f"  {category}: {correct}/{total}")
    print("FAIL: " + "; ".join(failures) if failures else "PASS")
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
