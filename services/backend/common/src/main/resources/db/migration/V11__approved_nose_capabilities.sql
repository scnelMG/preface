-- 모델·리그 해시와 검증된 코 범위가 없으면 편집 승인으로 간주하지 않는다.
ALTER TABLE face_model
  ADD COLUMN approved_nose_capabilities JSON NULL COMMENT '원본 GLB·리그 결속과 검증된 코 효과별 상대 범위' AFTER chat_apply_ready;
