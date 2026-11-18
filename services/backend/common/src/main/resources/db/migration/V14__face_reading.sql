-- AI 관상(재미용, S15P31B204-438). 3D 생성 대기 중 프레임 묶음의 정면 프레임 1장으로 GMS가 부위별 풀이·조언을 만든다.
-- 3D(생성 작업) 1개당 1건만 만들고 결과 글(JSON)만 보관한다. 사진은 저장하지 않는다.
-- 생성 작업 행이 물리 삭제되면(탈퇴 등) FK CASCADE로 함께 지워진다.
-- expand만 한다: 새 테이블 추가. 기존 테이블·구버전 앱에 영향 없음.
CREATE TABLE face_reading (
  id                     CHAR(36)     NOT NULL COMMENT '관상 ID',
  user_id                CHAR(36)     NOT NULL COMMENT '회원 ID (본인 확인·삭제 조회용 비정규화)',
  reconstruction_job_id  CHAR(36)     NOT NULL COMMENT '3D 생성 작업 ID (작업 1개당 1건)',
  status                 VARCHAR(10)  NOT NULL COMMENT 'PENDING / DONE / FAILED',
  result                 JSON         NULL     COMMENT '부위별 풀이·종합·조언(DONE일 때)',
  fail_code              VARCHAR(30)  NULL     COMMENT '실패 사유 코드(FAILED일 때, 사용자 문구 아님)',
  model                  VARCHAR(50)  NULL     COMMENT '풀이를 만든 엔진·모델 이름',
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '요청 시각',
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '상태 변경 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_reading_job (reconstruction_job_id),
  KEY idx_reading_user (user_id),
  CONSTRAINT fk_reading_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT fk_reading_job FOREIGN KEY (reconstruction_job_id) REFERENCES reconstruction_job (id) ON DELETE CASCADE,
  CONSTRAINT ck_face_reading_status CHECK (status IN ('PENDING', 'DONE', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI 관상 결과 (재미용, 3D 1개당 1건)';
