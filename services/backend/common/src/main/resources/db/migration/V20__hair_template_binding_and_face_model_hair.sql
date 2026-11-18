-- 헤어 템플릿(S15P31B204-551): 템플릿 머리(GNM) 위에서 만든 헤어를 사용자 머리에 맞추려면 바인딩 파일과 대상 템플릿 버전이 필요하다.
-- 추천에 쓰는 속성(길이·앞머리·가르마)과 색 보정 기준색도 둔다. 기존 행이 없어 모두 NULL 허용으로 더한다(expand).
ALTER TABLE hair_template
    ADD COLUMN binding_object_key VARCHAR(500) NULL COMMENT '템플릿 삼각형 바인딩 파일 key (공용 자산)' AFTER mesh_object_key,
    ADD COLUMN head_template VARCHAR(30) NULL COMMENT '바인딩한 머리 템플릿·위상 버전 (예: gnm-v3)' AFTER binding_object_key,
    ADD COLUMN hair_length VARCHAR(10) NULL COMMENT 'short / medium / long' AFTER head_template,
    ADD COLUMN bangs VARCHAR(10) NULL COMMENT 'none / partial / full' AFTER hair_length,
    ADD COLUMN part VARCHAR(10) NULL COMMENT 'none / left / center / right (정면 사진 보는 사람 기준)' AFTER bangs,
    ADD COLUMN base_rgb CHAR(7) NULL COMMENT '텍스처 기본색 #rrggbb (색 보정 기준)' AFTER part;

-- 워커가 촬영 프레임으로 추정한 머리 속성. 추천 전용이고 이미지가 아니다. 없으면 추천하지 않는다.
ALTER TABLE face_model
    ADD COLUMN hair_meta JSON NULL COMMENT '추정 머리 속성 {schemaVersion, length, bangs, part, color, rgb}';
