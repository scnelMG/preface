ALTER TABLE face_model ADD COLUMN previous_mesh_object_key VARCHAR(500) NULL
    COMMENT '윤곽 복구 전의 체중 변형 GLB 키';
