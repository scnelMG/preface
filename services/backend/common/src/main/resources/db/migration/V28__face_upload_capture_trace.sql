-- 웹 녹화 촬영 기록(S15P31B204-640, 계획 S0-1·S0-8·F-3): 가이드 meta·단계 구간·머리 각도 trace·카메라 트랙 설정.
-- 서버는 해석하지 않고 추출 워커 claim 응답(capture.trace)으로 넘긴다. 예전 업로드·파일 올리기는 NULL(expand만).
-- 원본 영상을 지우면(job-manager 삭제 처리) 함께 비우고, 탈퇴 때는 행째 지운다.
ALTER TABLE face_upload
  ADD COLUMN capture_trace JSON NULL COMMENT '웹 녹화 촬영 기록(meta·steps·trace·trackSettings). 서버는 해석하지 않고 추출 워커에 전달';
