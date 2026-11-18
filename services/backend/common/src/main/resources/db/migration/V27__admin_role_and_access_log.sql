-- 관리자 페이지(S15P31B204-651). expand만 한다: 기본값 있는 컬럼과 새 테이블 추가. 구버전 앱은 이 컬럼·테이블을 읽지 않는다.

-- 회원 권한. ADMIN은 DB에서만 준다(가입·API로 바꾸는 길 없음). JWT에 싣지 않고 관리자 API마다 이 값을 읽어 바로 반영한다.
ALTER TABLE user
  ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'USER' COMMENT 'USER(일반) | ADMIN(관리자, DB에서만 지정)' AFTER status,
  ADD CONSTRAINT ck_user_role CHECK (role IN ('USER', 'ADMIN'));

-- 복원 작업 단계별 기록. 관리자 화면의 구간별 소요 시간·실패 단계 표시용(기록은 S15P31B204-652).
-- 추출(EXTRACT)은 재시도마다 attempt가 오른다. 작업이 물리 삭제되면 함께 지운다(CASCADE).
CREATE TABLE reconstruction_job_stage (
  id                     CHAR(36)      NOT NULL COMMENT '단계 기록 ID (UUID)',
  job_id                 CHAR(36)      NOT NULL COMMENT '복원 작업 ID',
  attempt                INT           NOT NULL COMMENT '같은 단계의 시도 번호 (1부터)',
  stage                  VARCHAR(30)   NOT NULL COMMENT 'EXTRACT(프레임 추출) / FRAME_SELECT / QUALITY_CHECK / RECONSTRUCT / FINALIZE',
  status                 VARCHAR(20)   NOT NULL COMMENT 'RUNNING / SUCCEEDED / FAILED',
  started_at             DATETIME(3)   NOT NULL COMMENT '단계 시작 시각',
  finished_at            DATETIME(3)   NULL     COMMENT '단계 종료 시각 (진행 중이면 NULL)',
  duration_ms            INT           NULL     COMMENT '단계 소요 시간',
  worker_id              VARCHAR(64)   NULL     COMMENT '처리한 워커 식별자',
  detail                 VARCHAR(1000) NULL     COMMENT '내부 상세 (관리자만, FE 사용자 화면 미노출)',
  log_object_key         VARCHAR(500)  NULL     COMMENT '단계 로그 S3 key (있을 때만)',
  PRIMARY KEY (id),
  KEY idx_job_stage_job (job_id, started_at),
  KEY idx_job_stage_stage_status (stage, status, started_at),
  CONSTRAINT fk_job_stage_job FOREIGN KEY (job_id) REFERENCES reconstruction_job (id) ON DELETE CASCADE,
  CONSTRAINT ck_job_stage_stage CHECK (stage IN ('EXTRACT', 'FRAME_SELECT', 'QUALITY_CHECK', 'RECONSTRUCT', 'FINALIZE')),
  CONSTRAINT ck_job_stage_status CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='복원 작업 단계별 기록';

-- 관리자 조회 기록(REQ-N-27). 추가만 하고 고치지 않는다. 서명 URL·이메일은 남기지 않는다.
-- admin_user_id·target_user_id 모두 FK를 걸지 않는다: 회원 행은 탈퇴 뒤 보관 기간이 끝나면 물리 삭제되는데(job-manager RetentionSweeper),
-- FK가 있으면 관리자였던 회원의 삭제가 막히고, CASCADE면 감사 기록이 사라진다. 기록은 회원이 지워져도 남긴다.
CREATE TABLE admin_access_log (
  id                     CHAR(36)      NOT NULL COMMENT '조회 기록 ID (UUID)',
  admin_user_id          CHAR(36)      NOT NULL COMMENT '조회한 관리자 회원 ID (FK 없음, 탈퇴 뒤에도 남김)',
  target_user_id         CHAR(36)      NULL     COMMENT '조회 대상 회원 ID (FK 없음, 탈퇴 뒤에도 남김)',
  target_type            VARCHAR(30)   NOT NULL COMMENT 'JOB / FACE_MODEL / CAPTURE_IMAGE / STORAGE',
  target_id              CHAR(36)      NULL     COMMENT '대상 ID (목록 조회면 NULL)',
  request_path           VARCHAR(255)  NOT NULL COMMENT '요청 경로 (쿼리 문자열 제외)',
  accessed_at            DATETIME(3)   NOT NULL COMMENT '조회 시각',
  PRIMARY KEY (id),
  KEY idx_admin_access_target (target_user_id, accessed_at),
  KEY idx_admin_access_admin (admin_user_id, accessed_at),
  CONSTRAINT ck_admin_access_log_target_type CHECK (target_type IN ('JOB', 'FACE_MODEL', 'CAPTURE_IMAGE', 'STORAGE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='관리자 조회 기록';
