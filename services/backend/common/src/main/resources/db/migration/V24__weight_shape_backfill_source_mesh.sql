-- 소급 전환 뒤에도 원본 GLB를 복구·삭제할 수 있게 보관한다.
ALTER TABLE face_model ADD COLUMN source_mesh_object_key VARCHAR(500) NULL COMMENT '얼굴형 소급 전환 전 원본 GLB 키';
