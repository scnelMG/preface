-- 공유 시점 웹 헤어 (S15P31B204-842, 설계 docs/design/simulation-share.md). expand만 한다: NULL 허용 열 추가.
-- 편집실 헤어는 서버 헤어 템플릿(hair_template)이 아니라 웹에 들어 있는 정적 헤어(apps/web features/edit/hair/catalog.ts)라
-- hair_template_id에 담을 수 없다. 공유를 만들 때 고른 웹 헤어 ID를 따로 복사해 받은 사람 화면에도 같은 헤어를 씌운다.
ALTER TABLE simulation_share
  ADD COLUMN hair_asset_id VARCHAR(36) NULL COMMENT '공유 시점 웹 헤어 ID (NULL=없음, 예: dandy)' AFTER hair_template_id;
