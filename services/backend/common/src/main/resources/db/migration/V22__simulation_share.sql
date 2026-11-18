-- 시안 공유 링크 (S15P31B204-574, 설계 docs/design/simulation-share.md). expand만 한다: 새 테이블 추가.
-- 링크를 가진 누구나 로그인 없이 공유 시점의 Before/After 3D를 본다. 토큰 원문은 저장하지 않고 SHA-256 해시만 둔다.
-- 시안·3D가 물리 삭제되면(탈퇴·30일 정리·빈 시안 삭제) 공유도 함께 지워진다(CASCADE). 소프트 삭제·탈퇴·동의 철회는 읽을 때 막는다.
CREATE TABLE simulation_share (
  id                     CHAR(36)      NOT NULL COMMENT '공유 ID (UUID)',
  user_id                CHAR(36)      NOT NULL COMMENT '공유한 회원 ID',
  simulation_id          CHAR(36)      NOT NULL COMMENT '원본 시안',
  face_model_id          CHAR(36)      NOT NULL COMMENT '시안의 3D (Before)',
  token_hash             CHAR(44)      NOT NULL COMMENT '링크 토큰 SHA-256(base64) — 원문은 만들 때 한 번만 응답',
  morph_state            JSON          NOT NULL COMMENT '공유 시점 simulation.morph_state 스냅숏 (weights·pointStrokes·eyeEdit)',
  hair_template_id       CHAR(36)      NULL     COMMENT '공유 시점 헤어 (NULL=없음)',
  expires_at             DATETIME(3)   NOT NULL COMMENT '만료 시각 — 만든 뒤 7일',
  revoked_at             DATETIME(3)   NULL     COMMENT '공유 끝낸 시각',
  created_at             DATETIME(3)   NOT NULL COMMENT '생성 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uk_share_token_hash (token_hash),
  KEY idx_share_simulation (simulation_id, created_at),
  CONSTRAINT fk_share_simulation FOREIGN KEY (simulation_id) REFERENCES simulation (id) ON DELETE CASCADE,
  CONSTRAINT fk_share_face_model FOREIGN KEY (face_model_id) REFERENCES face_model (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='시안 공유 링크';
