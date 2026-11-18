-- S15P31B204-724: 생성 v1의 코 조절 범위를 엔진의 상대 가중치 한계에 맞춘다.
-- 기존 모델 승인과 시안 가중치는 보존한다. 실제 적용 범위는 모델별 승인과 형상 검사로 결정한다.
UPDATE morph_parameter
SET min_value = -1.000, max_value = 1.000
WHERE schema_version = 'v1'
  AND code IN ('nose.bridge_height', 'nose.tip_height', 'nose.alar_width');
