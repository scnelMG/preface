-- 설문용 얼굴 사진 5방향 보관 (S15P31B204-301, API 명세서 v2.9).
-- 워커가 촬영 영상에서 정면·좌·우·좌 45°·우 45° 프레임을 뽑아 S3에 올리고, 결과 보고(INT-REC-03) 때 key 5개를 저장한다.
-- 보관: 영구. 단 3D 삭제·탈퇴·얼굴 동의 철회 때 함께 삭제한다(행은 face_model CASCADE, S3 객체는 data_deletion_log로 삭제 작업이 지운다).
-- 새 테이블만 추가한다(expand). 기존 테이블·구버전 앱에 영향 없음.
CREATE TABLE face_capture_image (
  id                     CHAR(36)      NOT NULL COMMENT '사진 ID',
  face_model_id          CHAR(36)      NOT NULL COMMENT '3D 얼굴 모델 ID (3D 1개당 5행)',
  user_id                CHAR(36)      NOT NULL COMMENT '회원 ID (탈퇴·동의 철회 삭제 조회용 비정규화)',
  angle                  VARCHAR(10)   NOT NULL COMMENT 'FRONT / LEFT / RIGHT / LEFT_45 / RIGHT_45',
  object_key             VARCHAR(500)  NOT NULL COMMENT 'S3 key (users/{userId}/models/{jobId}/captures/{angle}.jpg) — 조회 API 없음, LLM 전송 금지',
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '저장 시각 (INSERT·DELETE만 — updated_at 없음)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_capture_model_angle (face_model_id, angle),
  KEY idx_capture_user (user_id),
  CONSTRAINT fk_capture_face_model FOREIGN KEY (face_model_id) REFERENCES face_model (id) ON DELETE CASCADE,
  CONSTRAINT fk_capture_user FOREIGN KEY (user_id) REFERENCES user (id),
  CONSTRAINT ck_face_capture_image_angle CHECK (angle IN ('FRONT', 'LEFT', 'RIGHT', 'LEFT_45', 'RIGHT_45'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='설문용 얼굴 사진 (5방향, 영구 보관)';
