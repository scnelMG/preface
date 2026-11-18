-- 관리자 회원 목록·검색(S15P31B204-707). 조회 기록 대상 종류에 USER(회원 목록·검색)를 더한다.
-- 값을 넓히기만 한다(expand): 구버전 앱은 USER를 쓰지 않으므로 그대로 동작한다. MySQL은 CHECK를 고치는 문법이 없어 지우고 다시 만든다.
ALTER TABLE admin_access_log
  DROP CHECK ck_admin_access_log_target_type;

ALTER TABLE admin_access_log
  MODIFY COLUMN target_type VARCHAR(30) NOT NULL COMMENT 'JOB / FACE_MODEL / CAPTURE_IMAGE / STORAGE / USER(회원 목록·검색)',
  ADD CONSTRAINT ck_admin_access_log_target_type CHECK (target_type IN ('JOB', 'FACE_MODEL', 'CAPTURE_IMAGE', 'STORAGE', 'USER'));
