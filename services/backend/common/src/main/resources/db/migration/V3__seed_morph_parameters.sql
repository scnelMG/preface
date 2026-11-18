-- morph 파라미터 1차 시드(schema v1, EYE·NOSE). 데이터만 추가한다(스키마 변경 없음).
-- NOSE 3종의 이름·범위는 API 명세서 v2.7 API-EDIT-01 예시값이다.
-- EYE 2종(eye.size, eye.tail_angle)과 그 범위(-0.5~0.5)는 [가정] — AI 파트 morph 목록 확정(REQ-N-11) 전까지 쓰는 최소값이다.
-- 값을 바꿀 때는 이 파일을 고치지 않고 새 migration으로 UPDATE·INSERT 한다.
INSERT INTO morph_parameter (id, code, schema_version, part, sub_part, label, min_value, max_value, default_value, step, sort_order, active) VALUES
  ('5d1e7a30-2b9c-4f6e-8a10-000000000001', 'nose.bridge_height', 'v1', 'NOSE', 'BRIDGE', '콧대 높이',   -0.500, 0.800, 0, 0.05, 10, 1),
  ('5d1e7a30-2b9c-4f6e-8a10-000000000002', 'nose.tip_height',    'v1', 'NOSE', 'TIP',    '코끝',        -0.500, 0.500, 0, 0.05, 20, 1),
  ('5d1e7a30-2b9c-4f6e-8a10-000000000003', 'nose.alar_width',    'v1', 'NOSE', 'ALAR',   '콧볼 너비',   -0.500, 0.500, 0, 0.05, 30, 1),
  ('5d1e7a30-2b9c-4f6e-8a10-000000000004', 'eye.size',           'v1', 'EYE',  'SIZE',   '눈 크기',     -0.500, 0.500, 0, 0.05, 40, 1),
  ('5d1e7a30-2b9c-4f6e-8a10-000000000005', 'eye.tail_angle',     'v1', 'EYE',  'TAIL',   '눈꼬리 각도', -0.500, 0.500, 0, 0.05, 50, 1);
