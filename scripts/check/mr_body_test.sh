#!/bin/sh
# mr_body.sh 자체 테스트. 실행: sh scripts/check/mr_body_test.sh
set -u
DIR="$(dirname "$0")"
TMP="$(mktemp)"
PASS=0
FAIL=0

GOOD='| 이슈 | 유형 | 영역 |
| --- | --- | --- |
| S15P31B204-12 | feat | FE |

## 무엇을, 왜

<!-- 안내 주석 -->
정면 촬영 가이드를 표시한다.

## 검증

<!-- 실행한 명령 -->
- `pnpm --filter web test` → 48 passed

## 영향

- API·계약: 없음
- DB: 없음
- 모델·GPU: 없음
- 설정·환경 변수: 없음
- 배포·복구: 없음'

expect() { # 기대(ok|ng) 설명 / 본문은 $TMP
  if sh "$DIR/mr_body.sh" "$TMP" >/dev/null 2>&1; then got=ok; else got=ng; fi
  if [ "$got" = "$1" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: 기대 $1, 결과 $got: $2"; fi
}
case_of() { printf '%s\n' "$GOOD" | sed "$1" > "$TMP"; }

printf '%s\n' "$GOOD" > "$TMP";                                      expect ok "올바른 본문"
case_of 's/| FE |/| FE, BE |/';                                      expect ok "영역 여러 개"
printf '%s\n' "$GOOD" | tr '\n' '\r' | sed 's/\r/\r\n/g' > "$TMP";   expect ok "CRLF 줄바꿈"
case_of 's/정면 촬영 가이드를 표시한다.//';                          expect ng "무엇을, 왜 비어 있음 (주석만)"
case_of '/pnpm --filter/d';                                          expect ng "검증 비어 있음"
case_of 's/- DB: 없음/- DB: /';                                      expect ng "영향 항목 값 없음"
case_of '/- 배포·복구: 없음/d';                                       expect ng "영향 항목 빠짐"
case_of 's/| S15P31B204-12 | feat | FE |/| S15P31B204-<번호> | <유형> | <영역> |/'; expect ng "표 자리표시자"
case_of 's/| FE |/| WEB |/';                                         expect ng "잘못된 영역"
case_of 's/| feat |/| feature |/';                                   expect ng "잘못된 유형"
case_of 's/## 영향/## 영향도/';                                       expect ng "영향 섹션 이름 다름"
case_of 's/정면 촬영 가이드를 표시한다./<요약>/';                    expect ng "본문 자리표시자"

rm -f "$TMP"
echo "mr_body.sh 테스트: 통과 $PASS, 실패 $FAIL"
[ "$FAIL" -eq 0 ]
