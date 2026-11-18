-- 채팅 적용(API-EDIT-05) 허용 플래그 (S15P31B204-307). 기본값 0 — 모델 생성 성공만으로 1로 바꾸지 않는다.
-- 모델별 지원 코드·좌우·범위와 리그 버전이 검증되고 서버 최종 형상 검사 경로가 준비된 모델만 1로 둔다.
-- 0이면 채팅 적용만 EDIT_030으로 막고, 슬라이더(API-EDIT-04)는 morph_parameter 범위 제한대로 허용한다(형상 검증 완료를 뜻하지 않음).
-- 이번 migration에는 형상 검사 경로가 없다. 수동 UPDATE로 chat_apply_ready=1을 넣는 절차는 후속 검증이 완료되기 전까지 사용 금지.
-- 새 컬럼만 추가(expand) — 구버전 앱은 이 컬럼을 읽지 않는다.
ALTER TABLE face_model
  ADD COLUMN chat_apply_ready TINYINT(1) NOT NULL DEFAULT 0 COMMENT '채팅 적용 허용 — 지원 코드·리그 버전·서버 형상 검사 준비 확인 후에만 1' AFTER morph_schema_version;
