-- 표정 트래킹 리그 key(S15P31B204-879). 코·눈 승인이 해시로 묶인 rig.json과 따로 둔다.
-- expand만 한다: NULL 허용 컬럼 추가. 구버전 앱은 이 컬럼을 읽지 않고, 키가 없는 모델은 표정 트래킹을 켜지 않는다.
ALTER TABLE face_model
  ADD COLUMN expression_object_key VARCHAR(500) NULL COMMENT '표정 트래킹 리그 키 (NULL=없음)' AFTER source_rig_object_key;
