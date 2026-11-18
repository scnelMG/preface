-- 모델별 눈 판정과 검증된 한계가 없으면 눈 저장은 열리지 않는다.
ALTER TABLE face_model
    ADD COLUMN eye_review JSON NULL,
    ADD COLUMN eye_parts_sha256 CHAR(64) NULL,
    ADD COLUMN approved_eye_capabilities JSON NULL;
