-- 기존 모델은 승인 정보가 없으므로 체중 방향 편집을 열지 않는다.
ALTER TABLE face_model ADD COLUMN approved_weight_shape JSON NULL COMMENT '생성 GLB 체중 방향 얼굴형 모프 승인 결속';

-- 상대 얼굴형 볼륨의 양방향 슬라이더. 끝값은 각 모델의 GLB에 이미 안전 범위로 구워져 있다.
INSERT INTO morph_parameter (id, code, schema_version, part, sub_part, label, min_value, max_value, default_value, step, sort_order, active) VALUES
  ('5d1e7a30-2b9c-4f6e-8a11-000000000007', 'contour.weight_shape', 'v1', 'CONTOUR', 'WEIGHT_SHAPE', '얼굴형 볼륨', -1.000, 1.000, 0, 0.01, 660, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000007', 'contour.weight_shape', 'v2', 'CONTOUR', 'WEIGHT_SHAPE', '얼굴형 볼륨', -1.000, 1.000, 0, 0.01, 660, 1);
