-- 기존 생성 모델의 morph 스키마 v1은 유지한다. 최종 코 리그와 모델별 승인을 통과한 모델만
-- 1차 UI의 코끝 돌출·내림(높이+회전)을 사용할 수 있도록 누락된 저장 코드만 추가한다.
-- 카탈로그 범위는 형상 안전 범위가 아니다. 실제 허용 범위는 모델별 승인과 매 요청 최종 메시 검사로 제한한다.
INSERT INTO morph_parameter
    (id, code, schema_version, part, sub_part, label, min_value, max_value, default_value, step, sort_order, active)
VALUES
    ('5d1e7a30-2b9c-4f6e-8a10-000000000006', 'nose.tip_projection', 'v1', 'NOSE', 'TIP_PROJECTION', '코끝 돌출', -1.000, 1.000, 0, 0.05, 21, 1),
    ('5d1e7a30-2b9c-4f6e-8a10-000000000007', 'nose.tip_rotation', 'v1', 'NOSE', 'TIP_ROTATION', '코끝 회전', -1.000, 1.000, 0, 0.05, 22, 1);
