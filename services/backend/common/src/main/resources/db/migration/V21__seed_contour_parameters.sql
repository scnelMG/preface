-- 윤곽 조절 6종(광대·볼살·턱끝 앞뒤·길이·폭·사각턱) 카탈로그. 데이터만 추가한다(스키마 변경 없음).
-- 원본: contracts/edit/effects-v1.md "윤곽". 코드는 GLB morph target 쌍 `<code>_neg`/`<code>_pos`로 움직인다
-- (services/gpu-worker/reconstruction/tools/contour_morphs.py). 코처럼 리그·메시 검사기가 없고, 서버는 이 범위로만 clamp한다.
-- 끝값 크기는 시연용 범위이며 임상 범위가 아니다. 모델별 자동 한계는 아직 없다.
-- 생성 모델이 쓰는 v1과 v2 모두에 넣는다. sort_order는 눈 뒤(부위 순서 코 → 눈 → 윤곽 유지).
INSERT INTO morph_parameter (id, code, schema_version, part, sub_part, label, min_value, max_value, default_value, step, sort_order, active) VALUES
  ('5d1e7a30-2b9c-4f6e-8a11-000000000001', 'contour.cheekbone',       'v1', 'CONTOUR', 'CHEEKBONE',       '광대 크기',   -1.000, 1.000, 0, 0.01, 600, 1),
  ('5d1e7a30-2b9c-4f6e-8a11-000000000002', 'contour.cheek_volume',    'v1', 'CONTOUR', 'CHEEK_VOLUME',    '볼살',        -1.000, 1.000, 0, 0.01, 610, 1),
  ('5d1e7a30-2b9c-4f6e-8a11-000000000003', 'contour.chin_projection', 'v1', 'CONTOUR', 'CHIN_PROJECTION', '턱끝 앞뒤',   -1.000, 1.000, 0, 0.01, 620, 1),
  ('5d1e7a30-2b9c-4f6e-8a11-000000000004', 'contour.chin_length',     'v1', 'CONTOUR', 'CHIN_LENGTH',     '턱끝 길이',   -1.000, 1.000, 0, 0.01, 630, 1),
  ('5d1e7a30-2b9c-4f6e-8a11-000000000005', 'contour.chin_width',      'v1', 'CONTOUR', 'CHIN_WIDTH',      '턱끝 폭',     -1.000, 1.000, 0, 0.01, 640, 1),
  ('5d1e7a30-2b9c-4f6e-8a11-000000000006', 'contour.jaw_angle',       'v1', 'CONTOUR', 'JAW_ANGLE',       '사각턱',      -1.000, 1.000, 0, 0.01, 650, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000001', 'contour.cheekbone',       'v2', 'CONTOUR', 'CHEEKBONE',       '광대 크기',   -1.000, 1.000, 0, 0.01, 600, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000002', 'contour.cheek_volume',    'v2', 'CONTOUR', 'CHEEK_VOLUME',    '볼살',        -1.000, 1.000, 0, 0.01, 610, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000003', 'contour.chin_projection', 'v2', 'CONTOUR', 'CHIN_PROJECTION', '턱끝 앞뒤',   -1.000, 1.000, 0, 0.01, 620, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000004', 'contour.chin_length',     'v2', 'CONTOUR', 'CHIN_LENGTH',     '턱끝 길이',   -1.000, 1.000, 0, 0.01, 630, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000005', 'contour.chin_width',      'v2', 'CONTOUR', 'CHIN_WIDTH',      '턱끝 폭',     -1.000, 1.000, 0, 0.01, 640, 1),
  ('5d1e7a30-2b9c-4f6e-8a21-000000000006', 'contour.jaw_angle',       'v2', 'CONTOUR', 'JAW_ANGLE',       '사각턱',      -1.000, 1.000, 0, 0.01, 650, 1);
