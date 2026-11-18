-- =====================================================================
-- V1__init.sql — Preface 초기 스키마 (MySQL 8, InnoDB, utf8mb4)
-- 원본: 기획 문서 03_DDL_v2.7.sql (2026-10-23) · 설명: docs/erd 참고(팀 ERD https://www.erdcloud.com/d/GLNuiNCCza853XGLz)
-- 테이블 15 · FK 18 · CHECK 12. QR 연결 링크·업로드 전용 세션·refresh token은 Redis(테이블 없음).
-- 규칙: 이 파일은 적용된 뒤 고치지 않는다. 스키마 변경은 V2__...sql부터 새 파일로 추가한다(expand → contract).
-- =====================================================================
SET NAMES utf8mb4;

-- 회원
CREATE TABLE user (
  id                     CHAR(36)      NOT NULL COMMENT '회원 ID (UUID)',
  nickname               VARCHAR(50)   NULL     COMMENT '표시 이름 (제공자 프로필, 탈퇴 시 NULL 처리)',
  email                  VARCHAR(255)  NULL     COMMENT '제공자 이메일 (선택 동의, 탈퇴 시 NULL 처리)',
  status                 VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE / WITHDRAWN — 회원 행은 동의 4종 저장 성공 뒤에만 생성 (REQ-F-01)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  deleted_at             DATETIME      NULL     COMMENT '탈퇴(소프트 삭제) 시각',
  PRIMARY KEY (id),
  CONSTRAINT ck_user_status CHECK (status IN ('ACTIVE', 'WITHDRAWN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='회원';

-- 소셜 계정
CREATE TABLE social_account (
  id                     CHAR(36)      NOT NULL COMMENT '소셜 계정 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  provider               VARCHAR(20)   NOT NULL COMMENT 'KAKAO / GOOGLE',
  provider_user_id       VARCHAR(255)  NOT NULL COMMENT '제공자 측 사용자 식별자 (sub / id) — 구글 sub 규격 최대 255자 (S-05)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '연결 시각 (INSERT·DELETE만 — updated_at 없음)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_social_provider_user (provider, provider_user_id),
  KEY idx_social_user (user_id),
  CONSTRAINT fk_social_account_user FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  CONSTRAINT ck_social_account_provider CHECK (provider IN ('KAKAO', 'GOOGLE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='소셜 계정';

-- 동의서
CREATE TABLE consent_document (
  id                     CHAR(36)      NOT NULL COMMENT '동의서 ID',
  consent_type           VARCHAR(20)   NOT NULL COMMENT 'TERMS / PRIVACY / FACE_DATA / FACE_PUBLIC — 4종 모두 필수, 가입 때 한 번에 제출 (REQ-F-32)',
  version                VARCHAR(20)   NOT NULL COMMENT '동의서 버전 (예: 2026-10-v1)',
  title                  VARCHAR(100)  NOT NULL COMMENT '제목',
  content_url            VARCHAR(500)  NOT NULL COMMENT '본문 위치 (정적 문서 URL)',
  required               TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '필수 여부',
  effective_at           DATETIME      NOT NULL COMMENT '시행 시각 (최신 시행본이 현재 버전)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_consent_doc_type_version (consent_type, version),
  CONSTRAINT ck_consent_document_consent_type CHECK (consent_type IN ('TERMS', 'PRIVACY', 'FACE_DATA', 'FACE_PUBLIC'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='동의서';

-- 회원 동의 이력
CREATE TABLE user_consent (
  id                     CHAR(36)      NOT NULL COMMENT '동의 기록 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  consent_document_id    CHAR(36)      NOT NULL COMMENT '동의서 ID (종류·버전)',
  consent_type           VARCHAR(20)   NOT NULL COMMENT '조회 편의용 비정규화 (TERMS / PRIVACY / FACE_DATA / FACE_PUBLIC)',
  agreed                 TINYINT(1)    NOT NULL COMMENT '1=동의, 0=철회 — append-only, 철회도 새 행 (v2.7: action AGREE/WITHDRAW → agreed)',
  acted_at               DATETIME(3)   NOT NULL COMMENT '동의·철회 시각(ms, UTC) — 법적 증빙. 현재 상태 = 종류별 ORDER BY acted_at DESC 첫 행 (S-03). created_at 없음(같은 값이라 삭제)',
  PRIMARY KEY (id),
  KEY idx_consent_user_type (user_id, consent_type, acted_at),
  CONSTRAINT fk_user_consent_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT fk_user_consent_document FOREIGN KEY (consent_document_id) REFERENCES consent_document (id),
  CONSTRAINT ck_user_consent_consent_type CHECK (consent_type IN ('TERMS', 'PRIVACY', 'FACE_DATA', 'FACE_PUBLIC'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='회원 동의 이력';

-- 얼굴 영상 업로드
CREATE TABLE face_upload (
  id                     CHAR(36)      NOT NULL COMMENT '업로드 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  object_key             VARCHAR(500)  NOT NULL COMMENT '얼굴 영상 S3 key (users/{userId}/uploads/{id}.mp4)',
  content_type           VARCHAR(50)   NOT NULL COMMENT 'video/mp4, video/webm, video/quicktime',
  size_bytes             BIGINT        NOT NULL COMMENT '선언 크기 (presigned 발급 시 검증)',
  duration_ms            INT           NOT NULL COMMENT '영상 길이 (FE 선언값, API-CAP-01 필수)',
  status                 VARCHAR(20)   NOT NULL DEFAULT 'ISSUED' COMMENT 'ISSUED / UPLOADED / DELETED / EXPIRED',
  url_expires_at         DATETIME      NOT NULL COMMENT 'presigned URL 만료 시각',
  uploaded_at            DATETIME      NULL     COMMENT 'S3 객체 존재 확인 시각',
  retention_expires_at   DATETIME      NOT NULL COMMENT '원본 삭제 예정 시각 (S-04: 발급 시 url_expires_at+24h로 채움 -> REC-01 이후 Q-04 규칙으로 갱신: 복원 성공=즉시, 실패·취소=종료+24h)',
  deleted_at             DATETIME      NULL     COMMENT '원본 객체 삭제 시각',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  checksum_sha256        CHAR(44)      NOT NULL COMMENT '원본 영상 SHA-256(base64) — S3 체크섬과 비교, 불일치 CAP_005 (REQ-N-20)',
  video_meta             JSON          NULL     COMMENT '워커 ffprobe 추출 {width,height,fps,codec,rotation,hdr,bitrate,deviceModel,originalSuspect…} — GPS 미저장',
  PRIMARY KEY (id),
  KEY idx_upload_user (user_id),
  KEY idx_upload_retention (status, retention_expires_at),
  CONSTRAINT fk_face_upload_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT ck_face_upload_status CHECK (status IN ('ISSUED', 'UPLOADED', 'DELETED', 'EXPIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='얼굴 영상 업로드';

-- 3D 복원 작업
CREATE TABLE reconstruction_job (
  id                     CHAR(36)      NOT NULL COMMENT '복원 작업 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  face_upload_id         CHAR(36)      NOT NULL COMMENT '입력 업로드 ID (1업로드 1작업)',
  status                 VARCHAR(20)   NOT NULL DEFAULT 'QUEUED' COMMENT 'QUEUED / RUNNING / SUCCEEDED / FAILED / CANCELED',
  stage                  VARCHAR(30)   NULL     COMMENT '화면 4단계: FRAME_SELECT(프레임 고르기) → QUALITY_CHECK(입력 품질 확인) → RECONSTRUCT(3D 얼굴 만들기) → FINALIZE(마무리). 실패 시 실패한 단계가 남음',
  engine                 VARCHAR(30)   NULL     COMMENT '복원 엔진 (COLMAP / VGGT — Q-03 미결)',
  fail_codes             JSON          NULL     COMMENT '실패 코드 목록 "QUALITY_ANGLE","QUALITY_LIGHT" — 사용자 문구는 FE 사전 (D8)',
  fail_detail            VARCHAR(1000) NULL     COMMENT '워커 내부 디버그 메시지 (운영 로그용, FE 미노출)',
  quality_report         JSON          NULL     COMMENT '입력 품질 검사 결과 (얼굴 검출·각도·조명 수치)',
  started_at             DATETIME      NULL     COMMENT '워커 시작 시각',
  finished_at            DATETIME      NULL     COMMENT '종료 시각',
  duration_ms            INT           NULL     COMMENT '처리 시간 (REQ-N-12 목표 <= 5분)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각 = 큐 등록 시각 (queued_at 대신)',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_job_upload (face_upload_id),
  KEY idx_job_user_status (user_id, status),
  KEY idx_job_user_created (user_id, created_at),
  CONSTRAINT fk_job_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT fk_job_face_upload FOREIGN KEY (face_upload_id) REFERENCES face_upload (id),
  CONSTRAINT ck_reconstruction_job_stage CHECK (stage IN ('FRAME_SELECT', 'QUALITY_CHECK', 'RECONSTRUCT', 'FINALIZE')),
  CONSTRAINT ck_reconstruction_job_status CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='3D 복원 작업';

-- 3D 얼굴 모델
CREATE TABLE face_model (
  id                     CHAR(36)      NOT NULL COMMENT '3D 얼굴 모델 ID (Before)',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  reconstruction_job_id  CHAR(36)      NOT NULL COMMENT '생성 작업 ID',
  mesh_object_key        VARCHAR(500)  NOT NULL COMMENT 'Before 메시 S3 key (GLB 가정)',
  texture_object_key     VARCHAR(500)  NULL     COMMENT '텍스처 S3 key (GLB 내장 시 NULL)',
  thumbnail_object_key   VARCHAR(500)  NULL     COMMENT 'Before 정면 썸네일 webp S3 key (워커 생성, 얼굴 파생 이미지 — 3D 삭제 시 함께 삭제)',
  mesh_format            VARCHAR(10)   NOT NULL DEFAULT 'GLB' COMMENT '메시 포맷',
  morph_schema_version   VARCHAR(20)   NOT NULL COMMENT '이 메시가 지원하는 morph 파라미터 스키마 버전',
  measurements           JSON          NULL     COMMENT '부위별 측정값 (LLM 입력용 텍스트 수치, 이미지 아님)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  title                  VARCHAR(100)  NOT NULL DEFAULT '내 머리' COMMENT '작업실 머리 목록 표시 이름 [제안] — 같으면 번호',
  deleted_at             DATETIME      NULL     COMMENT '소프트 삭제 — 30일 뒤 배치가 물리 삭제 + S3 삭제 (FN-HIS-03)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_face_model_job (reconstruction_job_id),
  KEY idx_face_model_user (user_id, created_at),
  KEY idx_face_model_deleted (deleted_at),
  CONSTRAINT fk_face_model_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT fk_face_model_job FOREIGN KEY (reconstruction_job_id) REFERENCES reconstruction_job (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='3D 얼굴 모델';

-- 헤어 템플릿
CREATE TABLE hair_template (
  id                     CHAR(36)      NOT NULL COMMENT '헤어 템플릿 ID',
  name                   VARCHAR(50)   NOT NULL COMMENT '표시 이름',
  mesh_object_key        VARCHAR(500)  NOT NULL COMMENT '헤어 메시 key (공용 자산, 개인정보 아님)',
  thumbnail_object_key   VARCHAR(500)  NULL     COMMENT '썸네일 key',
  sort_order             INT           NOT NULL DEFAULT 0 COMMENT '정렬',
  active                 TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '노출 여부',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='헤어 템플릿';

-- morph 파라미터
CREATE TABLE morph_parameter (
  id                     CHAR(36)      NOT NULL COMMENT '파라미터 ID',
  code                   VARCHAR(60)   NOT NULL COMMENT 'morph 키 (예: nose.bridge_height)',
  schema_version         VARCHAR(20)   NOT NULL COMMENT 'morph 스키마 버전',
  part                   VARCHAR(20)   NOT NULL COMMENT 'EYE / NOSE / CONTOUR',
  sub_part               VARCHAR(30)   NOT NULL COMMENT '세부 부위 (예: BRIDGE, TIP, ALAR, JAW)',
  label                  VARCHAR(50)   NOT NULL COMMENT '슬라이더 표시 이름',
  min_value              DECIMAL(5, 3) NOT NULL COMMENT '허용 하한 (clamp)',
  max_value              DECIMAL(5, 3) NOT NULL COMMENT '허용 상한 (clamp)',
  default_value          DECIMAL(5, 3) NOT NULL DEFAULT 0 COMMENT '기본값 (원본=0)',
  step                   DECIMAL(5, 3) NOT NULL DEFAULT 0.05 COMMENT '슬라이더 단위 (% 표시, Q-18)',
  sort_order             INT           NOT NULL DEFAULT 0 COMMENT '정렬',
  active                 TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '노출 여부',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_morph_code_version (code, schema_version),
  KEY idx_morph_part (schema_version, part)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='morph 파라미터';

-- 시뮬레이션
CREATE TABLE simulation (
  id                     CHAR(36)      NOT NULL COMMENT '시뮬레이션 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID',
  face_model_id          CHAR(36)      NOT NULL COMMENT '대상 3D (Before)',
  hair_template_id       CHAR(36)      NULL     COMMENT '적용 헤어 (NULL=없음)',
  title                  VARCHAR(100)  NOT NULL COMMENT '시안 이름 — 생성 시 {yyyy.MM.dd} 시안, 시안 저장 팝업·이름 바꾸기(API-HIS-05)',
  morph_state            JSON          NOT NULL COMMENT '현재 가중치 전체 {schemaVersion, weights{code:value}} — After = 원본 + 이 값',
  current_seq            INT           NOT NULL DEFAULT 0 COMMENT 'undo 포인터 (morph_change.seq)',
  state_version          INT           NOT NULL DEFAULT 0 COMMENT '낙관적 잠금 버전 (동시 수정 충돌 감지)',
  has_changes            TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '생성 이후 편집·대화 여부 — 0이면 빈 시안(목록 제외, 24h 뒤 정리)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각 — 편집·대화(CON-01)마다 갱신, 최근 기록 정렬 기준',
  deleted_at             DATETIME      NULL     COMMENT '소프트 삭제 — 30일 뒤 물리 삭제 (FN-HIS-03). 빈 시안은 즉시 물리 삭제',
  PRIMARY KEY (id),
  KEY idx_sim_user_recent (user_id, deleted_at, updated_at),
  KEY idx_sim_face_model (face_model_id, deleted_at),
  KEY idx_sim_empty_cleanup (has_changes, created_at),
  KEY idx_sim_deleted (deleted_at),
  CONSTRAINT fk_sim_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT fk_sim_face_model FOREIGN KEY (face_model_id) REFERENCES face_model (id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_hair_template FOREIGN KEY (hair_template_id) REFERENCES hair_template (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='시뮬레이션';

-- 상담 메시지
CREATE TABLE consult_message (
  id                     CHAR(36)      NOT NULL COMMENT '메시지 ID',
  simulation_id          CHAR(36)      NOT NULL COMMENT '시뮬레이션 ID',
  role                   VARCHAR(20)   NOT NULL COMMENT 'USER / ASSISTANT',
  content                TEXT          NOT NULL COMMENT '본문 (USER=FastAPI 마스킹본 maskedUserContent, ASSISTANT=금칙어 검사 통과본) — 원문 미저장 (D5)',
  masked                 TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'USER: 인물명 등 인물 마스킹 발생',
  intent                 VARCHAR(20)   NULL     COMMENT 'ASSISTANT: CONSULT / CLARIFY / UNDO / REDO / RESET / TERM_INFO / OUT_OF_SCOPE / UNSUPPORTED_PART',
  needs_clarification    TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '되묻기 여부 (FN-CON-02)',
  options                JSON          NULL     COMMENT '되묻기 선택지 {id,label}',
  filtered               TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '금칙어로 대체 문구 처리됨 (FN-EDIT-05)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  seq                    INT           NOT NULL COMMENT '시뮬레이션 내 메시지 순번 1부터 (대화 정렬 기준, S-01). USER=n+1·ASSISTANT=n+2를 한 트랜잭션에서',
  PRIMARY KEY (id),
  UNIQUE KEY uk_msg_sim_seq (simulation_id, seq),
  CONSTRAINT fk_msg_simulation FOREIGN KEY (simulation_id) REFERENCES simulation (id) ON DELETE CASCADE,
  CONSTRAINT ck_consult_message_role CHECK (role IN ('USER', 'ASSISTANT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='상담 메시지';

-- 변경 요청
CREATE TABLE change_request (
  id                     CHAR(36)      NOT NULL COMMENT '변경 요청 ID',
  simulation_id          CHAR(36)      NOT NULL COMMENT '시뮬레이션 ID',
  consult_message_id     CHAR(36)      NOT NULL COMMENT '요청을 만든 ASSISTANT 메시지',
  status                 VARCHAR(20)   NOT NULL COMMENT 'COMPLETE / INCOMPLETE / APPLIED',
  part                   VARCHAR(20)   NULL     COMMENT 'EYE / NOSE / CONTOUR (검색용 컬럼)',
  sub_part               VARCHAR(30)   NULL     COMMENT '세부 부위',
  direction              VARCHAR(30)   NULL     COMMENT '변화 방향 (enum 후보 Q-10)',
  degree                 VARCHAR(10)   NULL     COMMENT 'LOW / MID / HIGH (약/중/강)',
  request_json              JSON          NOT NULL COMMENT '변경 요청 전체 (원문 요약·용어 매핑·확인 필요 항목 포함, 스키마 변동 대비)',
  request_schema_version    VARCHAR(20)   NOT NULL COMMENT '요청 스키마 버전',
  applied_at             DATETIME      NULL     COMMENT '3D 반영 시각',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_request_message (consult_message_id),
  KEY idx_request_sim (simulation_id, created_at),
  KEY idx_request_part (part),
  CONSTRAINT fk_request_simulation FOREIGN KEY (simulation_id) REFERENCES simulation (id) ON DELETE CASCADE,
  CONSTRAINT fk_request_message FOREIGN KEY (consult_message_id) REFERENCES consult_message (id) ON DELETE CASCADE,
  CONSTRAINT ck_change_request_status CHECK (status IN ('COMPLETE', 'INCOMPLETE', 'APPLIED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='변경 요청';

-- 가중치 변경 이력
CREATE TABLE morph_change (
  id                     CHAR(36)      NOT NULL COMMENT '변경 ID',
  simulation_id          CHAR(36)      NOT NULL COMMENT '시뮬레이션 ID',
  seq                    INT           NOT NULL COMMENT '시뮬레이션 내 순번 (0=초기 상태)',
  source                 VARCHAR(20)   NOT NULL COMMENT 'INIT / CHAT / SLIDER / RESET',
  change_request_id        CHAR(36)      NULL     COMMENT 'CHAT 반영 시 근거 변경 요청',
  delta                  JSON          NULL     COMMENT '이번에 바뀐 항목 {code, from, to, clamped}',
  state_after            JSON          NOT NULL COMMENT '변경 후 가중치 전체 (undo 시 이 값으로 복원)',
  clamped                TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '허용 범위 clamp 발생',
  summary                VARCHAR(300)  NULL     COMMENT '변경 요약 문구',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_change_sim_seq (simulation_id, seq),
  KEY idx_change_request (change_request_id),
  CONSTRAINT fk_change_simulation FOREIGN KEY (simulation_id) REFERENCES simulation (id) ON DELETE CASCADE,
  CONSTRAINT fk_change_request FOREIGN KEY (change_request_id) REFERENCES change_request (id) ON DELETE SET NULL,
  CONSTRAINT ck_morph_change_source CHECK (source IN ('INIT', 'CHAT', 'SLIDER', 'RESET'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='가중치 변경 이력';

-- 삭제 기록
CREATE TABLE data_deletion_log (
  id                     CHAR(36)      NOT NULL COMMENT '삭제 기록 ID',
  user_id                CHAR(36)      NOT NULL COMMENT '대상 회원',
  target_type            VARCHAR(30)   NOT NULL COMMENT 'FACE_UPLOAD / FACE_MODEL / SIMULATION / USER',
  target_id              CHAR(36)      NOT NULL COMMENT '대상 레코드 ID',
  object_key             VARCHAR(500)  NULL     COMMENT '삭제 대상 S3 key',
  reason                 VARCHAR(30)   NOT NULL COMMENT 'RETENTION_POLICY / USER_REQUEST / WITHDRAWAL / CONSENT_WITHDRAWN / SOFT_DELETE_EXPIRED(소프트 삭제 30일 경과) / EMPTY_SIMULATION(빈 시안 정리) — DRAFT_EXPIRED·OVERWRITTEN은 v1.4 폐지',
  status                 VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / DONE / FAILED',
  retry_count            INT           NOT NULL DEFAULT 0 COMMENT 'S3 삭제 재시도 횟수',
  completed_at           DATETIME      NULL     COMMENT '완료 시각',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  PRIMARY KEY (id),
  KEY idx_del_status (status, created_at),
  KEY idx_del_user (user_id),
  CONSTRAINT fk_del_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT ck_data_deletion_log_status CHECK (status IN ('PENDING', 'DONE', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='삭제 기록';

-- 알림
CREATE TABLE notification (
  id                     CHAR(36)      NOT NULL COMMENT '알림 ID',
  type                   VARCHAR(30)   NOT NULL COMMENT 'RECON_SUCCEEDED / RECON_FAILED (1차)',
  title                  VARCHAR(100)  NOT NULL COMMENT '서버 고정 문구 (금칙어 예외 목록 관리)',
  body                   VARCHAR(255)  NULL     COMMENT '본문',
  target_kind            VARCHAR(20)   NULL     COMMENT 'FACE_MODEL / RECON_JOB — 누르면 이동할 대상',
  target_id              CHAR(36)      NULL     COMMENT '대상 ID (face_model.id 또는 reconstruction_job.id)',
  read_at                DATETIME      NULL     COMMENT '읽은 시각 (NULL=안 읽음)',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시각',
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정 시각',
  user_id                CHAR(36)      NOT NULL COMMENT '알림 받는 회원 (탈퇴 시 물리 삭제)',
  PRIMARY KEY (id),
  KEY idx_noti_user_created (user_id, created_at),
  KEY idx_noti_user_unread (user_id, read_at),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES user (id) ON DELETE CASCADE,
  CONSTRAINT ck_notification_type CHECK (type IN ('RECON_SUCCEEDED', 'RECON_FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='알림';
