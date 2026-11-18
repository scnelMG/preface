-- 3D 복원 입력을 영상 → 프레임 묶음으로 바꾼다 (S15P31B204-353).
-- EC2 추출 워커가 영상에서 프레임(최대 100장)·마스크·선택 정보·렌즈 메타를 골라 묶음 파일 1개로 S3에 올리면,
-- Spring이 묶음 key·체크섬을 저장하고 원본 영상을 바로 지운다(S3 + DB 주소). GPU 워커는 영상 대신 묶음을 받는다(INT-REC-01).
-- expand만 한다: 새 컬럼 추가, face_upload.object_key NULL 허용. 구버전 앱은 새 컬럼을 읽지 않고 object_key를 항상 채워 쓴다.

ALTER TABLE face_upload
  MODIFY COLUMN object_key VARCHAR(500) NULL COMMENT '얼굴 영상 S3 key (users/{userId}/uploads/{id}.mp4) — 프레임 추출 뒤 NULL(삭제할 key는 data_deletion_log에 남는다)',
  ADD COLUMN frames_object_key      VARCHAR(500) NULL COMMENT '프레임 묶음 S3 key (users/{userId}/uploads/{id}/frames-a{시도}.tar) — 3D 생성이 끝나면 NULL',
  ADD COLUMN frames_size_bytes      BIGINT       NULL COMMENT '프레임 묶음 크기',
  ADD COLUMN frames_checksum_sha256 CHAR(44)     NULL COMMENT '프레임 묶음 SHA-256(base64) — S3 체크섬과 비교',
  ADD COLUMN frame_count            INT          NULL COMMENT '묶음 안 프레임 장 수 (1~최대 장 수, 고정 아님)',
  ADD COLUMN lens_meta              JSON         NULL COMMENT '추출 워커가 영상에서 읽은 렌즈 정보(기종·35mm 환산 초점 등) — 서버는 해석하지 않고 GPU에 그대로 전달';

-- 추출 단계 상태. 작업은 추출 중에도 QUEUED다(FE에는 대기 중). 추출 대기열은 Redis가 아니라 이 행들이다(SKIP LOCKED로 가져간다)
ALTER TABLE reconstruction_job
  ADD COLUMN frames_ready_at    DATETIME    NULL COMMENT '프레임 묶음 저장 시각 — NULL이면 추출 대기, 채워지면 GPU 대기열' AFTER stage,
  ADD COLUMN extract_worker_id  VARCHAR(64) NULL COMMENT '추출을 가져간 워커 ID' AFTER frames_ready_at,
  ADD COLUMN extract_claimed_at DATETIME    NULL COMMENT '추출을 가져간 시각 — lease 만료 판단' AFTER extract_worker_id,
  ADD COLUMN extract_attempts   INT         NOT NULL DEFAULT 0 COMMENT '추출 시도 수 — 묶음 key에 들어가 시도마다 다른 key를 쓴다' AFTER extract_claimed_at,
  ADD KEY idx_recon_extract (status, frames_ready_at, extract_claimed_at);
