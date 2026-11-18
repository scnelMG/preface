# INT-AI-02 코 편집 최종 메시 검사 v1

2026-10-27. 관련 Jira: S15P31B204-72, -307, -308. 1차 실제 편집은 코에 한정한다. 이 문서는 **서버 내부 검사 경계**이며, 모델별 capabilities 승인이나 서비스 편집 성공을 뜻하지 않는다.

## 경계

Spring만 사설 네트워크의 `POST /internal/ai/v1/morph`를 호출한다. `X-Internal-Secret`은 서버 환경 변수로 전달한다. 검사기는 얼굴 파일을 API 응답에 싣지 않고, Spring이 모델 DB key에서 발급한 10분짜리 S3 GET URL로 원본 GLB와 해당 `rig.json`을 직접 읽는다. 이 URL과 얼굴 데이터는 로그·Jira·MR 본문에 남기지 않는다. 허용된 S3 호스트의 HTTPS URL만 받으며 요청 본문은 16 KiB, GLB는 200 MiB, 리그는 32 MiB로 제한한다.

검사기는 CPU 워커 스레드에서 요청을 처리해 헬스와 다른 HTTP 응답을 막지 않는다. 동시에 한 건만 검사하고, 그 사이 들어온 요청은 거절하지 않고 도착 순서대로 기다린다(최대 30초·16건, `EDIT_VALIDATOR_QUEUE_WAIT_MS`·`EDIT_VALIDATOR_QUEUE_MAX`). 그 안에 차례를 받지 못하면 503 `EDIT_VALIDATOR_BUSY`, 검사 스레드가 뜨지 못하거나 죽거나 시간 초과면 503 `EDIT_VALIDATOR_UNAVAILABLE`, 입력·자산 검사 실패는 422 `EDIT_VALIDATION_FAILED`다(S15P31B204-592). 요청 본문 수신 제한은 5초, 워커 실행 제한은 45초다. Spring은 사용자 편집의 503·시간 초과를 적용 실패로 처리하며 자동 재시도로 변경 거래를 중복 생성하지 않는다. 3D 생성 결과 검사(INT-REC-03)에서는 503·연결 실패·시간 초과를 "검사 일시 불가"로 보고 워커에 503 `REC_023`을 준다(워커가 같은 결과를 다시 보낸다).

Spring은 얼굴 모델의 소유권과 시안 `stateVersion`을 확인하고, **승인된 capabilities에서 보관한** 원본 GLB·리그 SHA-256 및 현재/후보 코 가중치를 보낸다. 기존 눈 값은 시안에서 읽기·보존만 하고 이 검사에 보내지 않는다. FE 입력 URL·해시·검사 결과를 신뢰하지 않는다.

코 점 드래그를 사용하는 시안에는 `currentPointStrokes`·`candidatePointStrokes` 배열을 함께 보낸다([점 계약](point-strokes-v1.md)). 채팅·슬라이더 요청은 두 배열에 같은 현재 점 상태를 담아 합성된 최종 메시를 검사한다. 검사 결과의 `actualPointStrokes`는 후보와 정확히 같아야 하며 안전하지 않은 점 요청은 축소 적용하지 않고 거절한다.

BE는 `face_model.approved_nose_capabilities`에 원본/리그 해시·fit/엔진/리그/위상 버전과 승인된 코 코드별 상대 범위를 보관한다. 이 값이 없거나 `chat_apply_ready=false`이면 채팅은 `EDIT_030`, 슬라이더는 `EDIT_031`(409)로 거절하고 상태·이력·undo를 바꾸지 않는다. `GET /simulations/{id}`의 `capabilities`는 이 승인 범위만 내리며, 승인이 없는 모델은 `null`이다. DB 공통 범위나 `rig.json` 키 존재를 승인 범위로 추정하지 않는다.

승인 메타데이터의 등록·취소와 끝값 검증은 [모델 승인 계약](nose-approval-v1.md)을 따른다.

```json
{
  "meshUrl": "<서명 URL>", "rigUrl": "<서명 URL>",
  "meshSha256": "<64자리 hex>", "rigSha256": "<64자리 hex>",
  "currentWeights": {"nose.bridge_height": 0.2},
  "candidateWeights": {"nose.bridge_height": 0.4}
}
```

검사기는 해시·리그 버전·원본 fit을 확인하고 현재 상태와 후보 상태를 **같은 원본 GLB의 최종 피부 메시**에 적용한다. 후보가 안전하지 않으면 현재→후보의 직선 경로에서 결정적으로 값을 줄이고 저장 정밀도인 소수 셋째 자리로 맞춘 뒤 그 최종값을 다시 검사한다. 결과에 실제값만 넣고 요청값을 성공값으로 돌려주지 않는다.

```json
{
  "valid": true, "actualWeights": {"nose.bridge_height": 0.4}, "limited": false,
  "meshSha256": "<64자리 hex>", "rigSha256": "<64자리 hex>",
  "fitSha": "<원본 fit SHA>", "engine": "<코 엔진 버전>",
  "rigVersion": "<리그 버전>", "topologyVersion": "<위상 버전>",
  "canonicalValid": true, "skinValid": true, "selfIntersections": 0
}
```

`valid=false`이거나 HTTP 오류·시간 초과·해시/버전 불일치면 Spring은 얼굴·`stateVersion`·변경 이력·undo를 바꾸지 않는다. `valid=true`여도 Spring이 원본 모델, 리그/엔진 버전, 지원 코드·방향·모델별 범위, 결과값의 유한성, 현재 상태와 후보 사이의 값, 요청 ID와 버전을 재검증한 뒤 **실제값**만 한 거래로 저장한다. 슬라이더와 채팅은 같은 검사를 사용한다. 검사기만 배포됐다는 이유로 `chat_apply_ready`를 열지 않는다.

## 변경 이력

| 버전 | 날짜 | 내용 |
| --- | --- | --- |
| 1 | 2026-10-27 | 코 전용 요청별 GLB/리그 검사 입력과 실제값·실패 경계를 정의했다. |
| 1.1 | 2026-10-27 | 승인 메타데이터 저장·EDIT-03 노출과 채팅/슬라이더 미승인 거절 경계를 추가했다. |
| 1.1.1 | 2026-10-27 | 승인 등록·취소와 모델별 끝값 검증 계약을 연결했다. |
| 1.2 | 2026-10-27 | 자유 코 점 배열을 전체 메시 검사 입력·응답에 포함하고 불안전한 점 이동은 거절한다. |
| 1.3 | 2026-11-05 | 검사기는 바쁠 때 바로 거절하지 않고 차례를 기다리게 하고, 검사기 장애(503)와 입력 검사 실패(422)를 나눴다. 생성 결과 검사의 일시 불가는 503 `REC_023` (S15P31B204-592). |
