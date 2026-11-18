-- 웹 실시간 촬영 가이드(S15P31B204-617): 어떻게 찍었는지와 FE가 아는 기종. 웹 녹화 영상에는 기기·렌즈 기록이 없어
-- 추출 워커가 기종으로 렌즈 표(device_profiles.json)를 쓴다. 예전 FE는 보내지 않으므로 NULL 허용(expand만).
ALTER TABLE face_upload
  ADD COLUMN capture_method VARCHAR(20) NULL COMMENT 'WEB_RECORDER(웹 녹화) | FILE(파일 올리기), 예전 업로드는 NULL',
  ADD COLUMN device_model VARCHAR(100) NULL COMMENT 'FE가 아는 기종(갤럭시 UA-CH 모델명, 아이폰은 사용자가 고른 이름). 렌즈 출발값으로만 쓴다',
  ADD CONSTRAINT ck_face_upload_capture_method CHECK (capture_method IS NULL OR capture_method IN ('WEB_RECORDER', 'FILE'));
