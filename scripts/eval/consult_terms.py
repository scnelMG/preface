"""AI-74 합성 용어 문장 검색 비교. GMS 키와 원문 응답은 출력하거나 저장하지 않는다."""

import argparse
import csv
import json
import math
import os
import re
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / "services/backend/api/src/main/resources/consult-terms-v1.json"
CASES = ROOT / "docs/ai/consult-term-eval-v1.tsv"
GMS = "https://gms.ssafy.io/gmsapi"
FLOOR = 1_782_000


def normalized(text):
    return re.sub(r"[^0-9a-z가-힣]", "", text.lower())


def keyword_card(query, cards):
    text = normalized(query)
    hits = [card["id"] for card in cards if any(normalized(alias) in text for alias in card["aliases"])]
    return hits[0] if len(hits) == 1 else "NONE"


def gms_call(path, key, body=None):
    headers = {"Authorization": "Bearer " + key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        GMS + path,
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"GMS HTTP {error.code}") from None


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def embedding_predictions(cards, cases, key):
    before = gms_call("/key-info", key).get("remainCredit")
    if not isinstance(before, (int, float)) or before < FLOOR + 300:
        raise RuntimeError("GMS 잔액 하한 또는 300크레딧 실험 여유 부족")
    texts = [" ".join([card["term"], *card["aliases"], card["meaning"]]) for card in cards]
    texts += [case["query"] for case in cases]
    result = gms_call("/api.openai.com/v1/embeddings", key, {"model": "text-embedding-3-small", "input": texts})
    rows = sorted(result.get("data", []), key=lambda row: row["index"])
    if len(rows) != len(texts):
        raise RuntimeError("임베딩 응답 수 불일치")
    vectors = [row["embedding"] for row in rows]
    if len({len(vector) for vector in vectors}) != 1:
        raise RuntimeError("임베딩 차원 불일치")
    predictions = []
    for query_vector in vectors[len(cards) :]:
        ranked = sorted(
            ((cosine(query_vector, vector), card["id"]) for vector, card in zip(vectors, cards)),
            reverse=True,
        )
        best, second = ranked[0], ranked[1]
        predictions.append(best[1] if best[0] >= 0.42 and best[0] - second[0] >= 0.06 else "NONE")
    after = gms_call("/key-info", key).get("remainCredit")
    if not isinstance(after, (int, float)):
        raise RuntimeError("GMS 사후 잔액 조회 실패")
    return predictions, result.get("usage", {}), before - after


def report(name, cases, predictions):
    correct = sum(case["expected"] == predicted for case, predicted in zip(cases, predictions))
    false_positive = sum(
        case["expected"] == "NONE" and predicted != "NONE"
        for case, predicted in zip(cases, predictions)
    )
    print(f"{name}: {correct}/{len(cases)} correct; NONE false positives={false_positive}")
    for case, predicted in zip(cases, predictions):
        if case["expected"] != predicted:
            print(f"  {case['id']}: expected={case['expected']} predicted={predicted}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedding", action="store_true", help="합성 문장만 GMS 임베딩에 보낸다")
    args = parser.parse_args()
    cards = json.loads(CARDS.read_text(encoding="utf-8"))
    with CASES.open(encoding="utf-8", newline="") as file:
        cases = list(csv.DictReader(file, delimiter="\t"))
    if len({card["id"] for card in cards}) != len(cards):
        raise RuntimeError("중복 카드 ID")
    report("keyword", cases, [keyword_card(case["query"], cards) for case in cases])
    if args.embedding:
        key = os.getenv("GMS_KEY")
        if not key:
            raise RuntimeError("GMS_KEY 환경 변수 없음")
        predictions, usage, debit = embedding_predictions(cards, cases, key)
        report("embedding", cases, predictions)
        print("embedding tokens=", usage.get("total_tokens", "unknown"), "observed_credit_debit=", debit)


if __name__ == "__main__":
    main()
