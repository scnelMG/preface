# 기본 모델 체험 상담 v1 (S15P31B204-610)

## 범위

로그인 회원의 남녀 기본 모델 체험에서만 쓴다. 기존 `API-CON-01`의 시안 저장 상담과 별개로, 서버는 문장을 해석해 후보를 돌려주고 **시안·대화·얼굴 자산을 저장하지 않는다**. 비회원은 로그인 안내만 본다. 기본 모델의 체험 조절값과 대화는 현재 화면 메모리에 두며 페이지를 떠나면 지운다.

## 요청·응답

`POST /api/v1/sample-models/{sampleKey}/consult` · 사용자 토큰 필수. `sampleKey`는 `base-male` 또는 `base-female`이다. 요청 본문은 `content`(1~300자), `requestId`(UUID), `meshSha256`(공개 기본 모델 manifest의 해시), `weights`(현재 조절값), `supportedCodes`(화면이 실제 GLB에서 확인한 코드), `eyeAvailable`, `eyeFoldEnabled`, `eyeEdited`다. 사진·렌더·3D 바이트·서명 URL은 보내지 않는다.

화면은 현재 받은 GLB 바이트의 SHA-256을 manifest와 대조한 뒤에만 상담을 보낸다. 서버는 그 해시를 고정된 자산 버전과 다시 대조하고, 가중치의 코드·유한성·범위를 확인한다. 화면이 보낸 지원 코드는 기본 모델 허용 목록과 교집합만 쓴다. 모델 확인 실패나 범위 밖 요청은 AI를 부르지 않는다. 사용자별 3초 간격 제한을 Redis TTL로 적용한다. 응답은 기존 `AiConsult.Response`의 `intent`, `assistantMessage`, `changeRequest.actions`, `options`, `maskedUserContent`, `filtered` 등을 담는다. `UNDO`·`REDO`·`RESET`은 서버 상태를 바꾸지 않고 현재 브라우저 이력에만 적용한다.

화면은 후보를 실제 로드된 GLB 타깃·카탈로그·눈 판정/한계와 다시 대조하고, 허용된 조절만 원본 기준 3D에 적용한다. 체중 방향과 다른 조절의 복합 상태는 차단한다. 체중 상태에서 다른 조절로 옮기면 체중 방향값을 원본으로 돌리고 새 조절을 한 이력에 기록한다. 미지원·형상 준비 전·모호한 답은 얼굴을 바꾸지 않았다고 안내한다. kg에 따른 개인 얼굴 예측은 이 계약에 없다.

## 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-11-05 | 로그인 기본 모델의 비저장 채팅 API와 브라우저 적용 경계 정의 |
