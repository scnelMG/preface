-- 동의서 4종(2026-10-v1) 시행일을 약관·동의서 전문 페이지 시행일(2026-10-26)에 맞춘다 (S15P31B204-354).
-- V2는 적용된 파일이라 고치지 않고 여기서 UPDATE한다. DATETIME은 UTC로 저장하므로 2026-10-26 00:00 KST = 2026-10-25 15:00 UTC.
-- 운영 동의 기록이 아직 없어(1차 배포 전) 기존 동의의 의미가 바뀌지 않는다. 새 버전 행을 만들지 않는 이유: 내용은 같고 시행일 표기만 맞추는 것이라
-- 새 버전으로 쌓으면 기존(로컬·dev) 회원이 "최신 버전 아님"으로 보인다.
UPDATE consent_document
   SET effective_at = '2026-10-25 15:00:00'
 WHERE version = '2026-10-v1'
   AND consent_type IN ('TERMS', 'PRIVACY', 'FACE_DATA', 'FACE_PUBLIC');
