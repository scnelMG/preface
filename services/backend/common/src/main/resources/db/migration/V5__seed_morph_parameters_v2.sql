-- morph 파라미터 v2 카탈로그 (S15P31B204-294). 데이터만 추가한다(스키마 변경 없음).
-- 원본: contracts/edit/effects-v1.md (S15P31B204-71). 코드·좌우·방향·상대값 범위를 그대로 옮긴다.
--  - 눈은 사용자 본인 기준 좌우 코드(.left/.right)로 따로 저장한다. 좌우 없는 eye.size·eye.tail_angle(v1 가정 항목)은 v2에 복사하지 않는다.
--  - 공개 weight는 모델별 한계에 대한 상대값: 양방향 [-1, 1], 쌍꺼풀 홈·애교살 [0, 1]. 누락 키는 0(원본).
--  - 코 세부 조절 6개는 슬라이더·조절점용으로 저장한다(edge_blend는 저장 코드 없음). 상담은 세부 코드를 만들지 않는다.
-- 모델별 실제 허용량(capabilities·형상 검사)은 이 범위보다 좁을 수 있다. 여기 범위는 DB 공통 검증일 뿐이다.
-- 기존 V3(v1) 행은 그대로 둔다. 값을 바꿀 때는 이 파일을 고치지 않고 새 migration으로 UPDATE·INSERT 한다.
INSERT INTO morph_parameter (id, code, schema_version, part, sub_part, label, min_value, max_value, default_value, step, sort_order, active) VALUES
  ('5d1e7a30-2b9c-4f6e-8a20-000000000001', 'nose.bridge_height', 'v2', 'NOSE', 'BRIDGE', '콧대 높이', -1.000, 1.000, 0, 0.05, 10, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000002', 'nose.bridge_hump', 'v2', 'NOSE', 'BRIDGE_HUMP', '콧등 굴곡', -1.000, 1.000, 0, 0.05, 20, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000003', 'nose.bridge_width', 'v2', 'NOSE', 'BRIDGE_WIDTH', '콧대 폭', -1.000, 1.000, 0, 0.05, 30, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000004', 'nose.radix_height', 'v2', 'NOSE', 'RADIX', '코 시작점 높이', -1.000, 1.000, 0, 0.05, 40, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000005', 'nose.tip_projection', 'v2', 'NOSE', 'TIP_PROJECTION', '코끝 돌출', -1.000, 1.000, 0, 0.05, 50, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000006', 'nose.tip_height', 'v2', 'NOSE', 'TIP', '코끝 높이', -1.000, 1.000, 0, 0.05, 60, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000007', 'nose.tip_rotation', 'v2', 'NOSE', 'TIP_ROTATION', '코끝 회전', -1.000, 1.000, 0, 0.05, 70, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000008', 'nose.tip_width', 'v2', 'NOSE', 'TIP_WIDTH', '코끝 폭', -1.000, 1.000, 0, 0.05, 80, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000009', 'nose.tip_fullness', 'v2', 'NOSE', 'TIP_FULLNESS', '코끝 볼륨', -1.000, 1.000, 0, 0.05, 90, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000010', 'nose.alar_width', 'v2', 'NOSE', 'ALAR', '콧볼 폭', -1.000, 1.000, 0, 0.05, 100, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000011', 'nose.alar_flare', 'v2', 'NOSE', 'ALAR_FLARE', '콧볼 벌어짐', -1.000, 1.000, 0, 0.05, 110, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000012', 'nose.columella_show', 'v2', 'NOSE', 'COLUMELLA_SHOW', '비주 노출', -1.000, 1.000, 0, 0.05, 120, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000013', 'nose.columella_relative_angle', 'v2', 'NOSE', 'COLUMELLA_ANGLE', '코끝-윗입술 상대 각도', -1.000, 1.000, 0, 0.05, 130, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000014', 'nose.bridge_height_position', 'v2', 'NOSE', 'BRIDGE_POSITION', '콧대 높이 위치', -1.000, 1.000, 0, 0.05, 140, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000015', 'nose.bridge_height_span', 'v2', 'NOSE', 'BRIDGE_SPAN', '콧대 높이 구간', -1.000, 1.000, 0, 0.05, 150, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000016', 'nose.bridge_hump_position', 'v2', 'NOSE', 'HUMP_POSITION', '콧등 굴곡 위치', -1.000, 1.000, 0, 0.05, 160, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000017', 'nose.radix_level', 'v2', 'NOSE', 'RADIX_LEVEL', '코 시작점 위치', -1.000, 1.000, 0, 0.05, 170, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000018', 'nose.alar_balance', 'v2', 'NOSE', 'ALAR_BALANCE', '콧볼 좌우 균형', -1.000, 1.000, 0, 0.05, 180, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000019', 'nose.columella_width', 'v2', 'NOSE', 'COLUMELLA_WIDTH', '비주 폭', -1.000, 1.000, 0, 0.05, 190, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000020', 'eye.open.left', 'v2', 'EYE', 'OPEN', '눈 뜨임(왼쪽)', -1.000, 1.000, 0, 0.05, 200, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000021', 'eye.open.right', 'v2', 'EYE', 'OPEN', '눈 뜨임(오른쪽)', -1.000, 1.000, 0, 0.05, 210, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000022', 'eye.inner_corner.left', 'v2', 'EYE', 'INNER_CORNER', '눈 안쪽 끝(왼쪽)', -1.000, 1.000, 0, 0.05, 220, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000023', 'eye.inner_corner.right', 'v2', 'EYE', 'INNER_CORNER', '눈 안쪽 끝(오른쪽)', -1.000, 1.000, 0, 0.05, 230, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000024', 'eye.outer_corner.left', 'v2', 'EYE', 'OUTER_CORNER', '눈 바깥쪽 폭(왼쪽)', -1.000, 1.000, 0, 0.05, 240, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000025', 'eye.outer_corner.right', 'v2', 'EYE', 'OUTER_CORNER', '눈 바깥쪽 폭(오른쪽)', -1.000, 1.000, 0, 0.05, 250, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000026', 'eye.tail_angle.left', 'v2', 'EYE', 'TAIL', '눈꼬리 각도(왼쪽)', -1.000, 1.000, 0, 0.05, 260, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000027', 'eye.tail_angle.right', 'v2', 'EYE', 'TAIL', '눈꼬리 각도(오른쪽)', -1.000, 1.000, 0, 0.05, 270, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000028', 'eye.double_lid_depth.left', 'v2', 'EYE', 'DOUBLE_LID', '쌍꺼풀 홈 진하기(왼쪽)', 0.000, 1.000, 0, 0.05, 280, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000029', 'eye.double_lid_depth.right', 'v2', 'EYE', 'DOUBLE_LID', '쌍꺼풀 홈 진하기(오른쪽)', 0.000, 1.000, 0, 0.05, 290, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000030', 'eye.lid_fullness.left', 'v2', 'EYE', 'LID_FULLNESS', '눈두덩 볼륨(왼쪽)', -1.000, 1.000, 0, 0.05, 300, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000031', 'eye.lid_fullness.right', 'v2', 'EYE', 'LID_FULLNESS', '눈두덩 볼륨(오른쪽)', -1.000, 1.000, 0, 0.05, 310, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000032', 'eye.aegyo_fullness.left', 'v2', 'EYE', 'AEGYO', '애교살(왼쪽)', 0.000, 1.000, 0, 0.05, 320, 1),
  ('5d1e7a30-2b9c-4f6e-8a20-000000000033', 'eye.aegyo_fullness.right', 'v2', 'EYE', 'AEGYO', '애교살(오른쪽)', 0.000, 1.000, 0, 0.05, 330, 1);
