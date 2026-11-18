-- 선택적 코 편집 리그 원본. 복원 성공이나 이 컬럼 존재만으로 채팅 적용을 허용하지 않는다.
ALTER TABLE face_model
  ADD COLUMN rig_object_key VARCHAR(500) NULL COMMENT '원본 GLB와 함께 생성된 개인 얼굴 리그 S3 key' AFTER mesh_object_key;
