# 회원 시안 눈 상태 저장 v1 (S15P31B204-509)

눈 카드의 직접 조절과 상담 적용은 **같은 시안 `morphState.eyeEdit`**를 바꾼다. 코 `weights`와 눈 상태는 한 `stateVersion`·`morph_change` 이력을 공유한다. 기존 시안에 `eyeEdit`가 없으면 쌍꺼풀 비활성·높이 20·깊이 65·트임 0의 기본 상태로 읽는다. 예전 `eye.double_lid_depth` 가중치는 새 라인 높이·모양으로 변환하지 않는다.

## 형식

```json
{
  "L": {"enabled": false, "style": "inout", "values": {"height": 20, "crease": 65, "inner": 0, "outer": 0, "lower": 0, "upper": 0}, "curve": [0.0427, 0.07844, 0.086, 0.1126, 0.1464]},
  "R": {"enabled": false, "style": "inout", "values": {"height": 20, "crease": 65, "inner": 0, "outer": 0, "lower": 0, "upper": 0}, "curve": [0.0427, 0.07844, 0.086, 0.1126, 0.1464]}
}
```

`L`·`R`은 GLB 좌표 기준이다. 화면 왼쪽 눈은 `R`이다. 모양은 `inline|inout|outline`, 값은 엔진 단위 0~100이다. 화면 %는 승인된 모델별 상한 대비 비율이다. 이번 UI는 양쪽 눈만 조절하고 깊이 `crease=65`를 고정한다.

## 서버 API

- `GET /api/v1/simulations/{id}`: `morphState.eyeEdit`와 `eyeReview`, `eyePartsSha256`, `eyeCapabilities`를 준다. 판정·파일 해시·승인 범위가 없는 모델은 눈 조절이 잠긴다.
- `PATCH /api/v1/simulations/{id}/eye-state`: `{ "stateVersion": 3, "eyeEdit": { ... } }`. 한 번에 눈 상태 전체를 보내고 `EditResultResponse`를 받는다. 시안 소유자·버전 확인, 모델 판정·승인 상한 확인, 이력 1건 기록이 원자적이다.
- 기존 코 PATCH·상담·점 조절은 눈 상태를 보존한다. undo/redo/reset은 눈·코가 공유하는 이력에서 움직인다. 코+눈 상담은 두 변화를 같은 이력 1건으로 기록해야 한다.

## 모델 문턱

복원 워커의 성공 결과 `eyeReview:{L,R}`은 GLB `asset.extras['live-mirror'].eye_review`와 같은 `present|absent` 판정이다. 없으면 기존 모델처럼 눈 기능 전체를 잠근다. 이미 주름이 있는 눈(`present`)에는 새 라인을 저장하지 않고 트임만 허용한다.

`face_model.approved_eye_capabilities`에는 `{schemaVersion,meshSha256,rigSha256,eyePartsSha256,engine,rigVersion,topologyVersion,limits}`를 저장한다. 메시·리그 해시와 엔진·리그·위상 버전은 승인된 코 원본·리그 결속과, 눈 판정 파일 해시는 저장된 `face_model.eye_parts_sha256`과 같아야 한다. 새 모델은 복원 워커 성공 결과의 `eyeApproval`로 채운다(S15P31B204-521, [`contracts/reconstruction`](../reconstruction/README.md)). 워커가 같은 엔진으로 단독 안전 한계를 재고, Spring은 코 승인과 같은 거래에서 결속·판정이 모두 맞을 때만 저장한다. 맞지 않거나 `eyeApproval`이 없는 모델(기존 모델 포함)은 null로 남아 눈 기능이 잠긴다. **승인값이 없거나 하나라도 다르면 눈 저장·눈 상담 적용은 거절한다.** `limits` 키는 `inner`·`outer`·`lower`·`upper`와 무쌍 눈이 있을 때의 `<종류>:height`이며, 없는 키는 0(잠금)으로 본다. 서버는 단독 한계만 확인한다. 여러 조절을 함께 올린 조합은 화면이 놓을 때마다 같은 엔진으로 다시 검사한다. 서버가 메시로 한계를 다시 계산하는 검사(코의 edit-validator에 해당)는 아직 없다.

## 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-11-01 | 눈 상태·모델 판정·승인 문턱과 코 공통 이력 경계를 정의했다. |
| 2026-11-01 | 눈 판정 파일 해시와 엔진·리그·위상·스키마 버전을 승인 결속에 추가했다. |
| 2026-11-02 | 새 모델의 승인값을 복원 워커 `eyeApproval`로 채우는 경로를 정했다(S15P31B204-521). |
