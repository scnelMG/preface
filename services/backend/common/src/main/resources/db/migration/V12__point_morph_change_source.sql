-- 점 드래그도 시안 이력의 독립적인 한 단계로 기록한다.
ALTER TABLE morph_change
  DROP CHECK ck_morph_change_source,
  ADD CONSTRAINT ck_morph_change_source CHECK (source IN ('INIT', 'CHAT', 'SLIDER', 'RESET', 'POINT'));
