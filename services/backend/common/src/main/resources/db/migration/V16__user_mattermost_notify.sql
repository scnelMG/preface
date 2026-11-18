-- Mattermost 완료 알림(S15P31B204-476). 사용자가 확인 코드로 본인 확인을 마친 Mattermost 아이디와 그 시각(= 알림 동의 시각).
-- 선택 기능이라 필수 동의 4종(consent)과 섞지 않고 회원 행에 둔다. 알림을 끄거나 탈퇴하면 두 값을 함께 비운다.
-- expand만 한다: NULL 허용 컬럼 추가. 구버전 앱은 이 컬럼을 읽지 않는다.
ALTER TABLE user
  ADD COLUMN mattermost_username  VARCHAR(64) NULL COMMENT 'Mattermost 아이디 (본인 확인을 마친 값만, 완료 알림 DM 대상)' AFTER email,
  ADD COLUMN mattermost_linked_at DATETIME    NULL COMMENT 'Mattermost 본인 확인·알림 동의 시각' AFTER mattermost_username;
