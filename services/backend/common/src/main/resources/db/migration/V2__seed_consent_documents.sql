-- 동의서 4종 첫 버전(2026-10-v1). 데이터만 추가한다(스키마 변경 없음).
-- content_url은 FE 정적 문서 경로 [가정] — 본문 확정 시 새 버전 행을 추가하고 이 행은 고치지 않는다(동의 증빙이 이 버전을 가리킨다).
INSERT INTO consent_document (id, consent_type, version, title, content_url, required, effective_at) VALUES
  ('8b0c1f52-6f0e-4c1a-9a51-000000000001', 'TERMS',       '2026-10-v1', '서비스 이용약관',            '/legal/terms/2026-10-v1',       1, '2026-10-01 00:00:00'),
  ('8b0c1f52-6f0e-4c1a-9a51-000000000002', 'PRIVACY',     '2026-10-v1', '개인정보 수집·이용',          '/legal/privacy/2026-10-v1',     1, '2026-10-01 00:00:00'),
  ('8b0c1f52-6f0e-4c1a-9a51-000000000003', 'FACE_DATA',   '2026-10-v1', '얼굴 데이터 수집·이용',       '/legal/face-data/2026-10-v1',   1, '2026-10-01 00:00:00'),
  ('8b0c1f52-6f0e-4c1a-9a51-000000000004', 'FACE_PUBLIC', '2026-10-v1', '얼굴 데이터 공개 범위',       '/legal/face-public/2026-10-v1', 1, '2026-10-01 00:00:00');
