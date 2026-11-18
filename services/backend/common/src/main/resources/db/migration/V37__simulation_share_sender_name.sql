-- 공유 링크에 보내는 사람 이름(S15P31B204-843, 설계 docs/design/simulation-share.md).
-- 공유한 사람이 링크를 만들 때 직접 적은 표시 이름만 둔다(선택, 1~20자). 계정 닉네임을 자동으로 넣지 않는다.
-- expand만 한다: NULL 허용 컬럼 추가. 구버전 앱은 이 컬럼을 읽지 않는다.
ALTER TABLE simulation_share
  ADD COLUMN sender_name VARCHAR(20) NULL COMMENT '받는 사람에게 보일 이름 (공유한 사람이 직접 입력, NULL=표시 안 함)' AFTER hair_asset_id;
