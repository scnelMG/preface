-- 얼굴 데이터 동의서 2026-11-v3 (S15P31B204-770). 편집실 `원본 사진` 탭이 얼굴 사진 5방향 중 정면 1장을 본인 화면에 보여 주므로
-- 목적 셋째 줄에 그 쓰임을 더한다(FE apps/web/src/features/legal/documents/frontPhoto.ts). 새로 모으는 정보·보유 기간은 그대로다.
-- 이전 버전 행은 고치지 않는다(동의 증빙이 그 버전 본문을 가리킨다, V2 주석). 새 버전 행을 더하고, 시행일이 지나면 BE가 v3을 현재 버전으로 준다.
-- 시행일: 2026-11-11 00:00 KST = 2026-11-10 15:00 UTC(FE facts.ts FRONT_PHOTO_EFFECTIVE_AT과 같다). 7일 사전 고지 없이 바로 시행한다(사용자 결정 2026-11-11).
-- 기존 회원에게 다시 동의를 받지 않는다(사용자 결정 A). 업로드·3D 생성은 버전과 관계없이 FACE_DATA 최근 기록이 동의인지만 본다
-- (CaptureGuard, FaceUploadGateway.hasFaceDataConsent). 새로 가입하는 사람은 v3에 동의한다(ConsentSubmission은 현재 버전만 받는다).
INSERT INTO consent_document (id, consent_type, version, title, content_url, summary, required, effective_at) VALUES
  ('8b0c1f52-6f0e-4c1a-9a51-000000000019', 'FACE_DATA', '2026-11-v3', '얼굴 데이터 수집·이용', '/legal/face-data/2026-11-v3',
   '수집: 촬영한 얼굴 영상(20~60초)·3D 얼굴 모델·측정값 / 목적: 3D 얼굴 생성과 참고용 성형 상담 시뮬레이션 / 원본 영상은 3D를 만든 뒤 삭제 / 정면 사진 1장은 본인 편집실에서 3D와 비교하도록 본인 화면에만 표시 / 재미로 보는 AI 관상을 요청하면 정면 사진 1장을 AI(SSAFY GMS)로 보내고 결과는 글로만 보관(사진은 저장하지 않음)',
   1, '2026-11-10 15:00:00');
