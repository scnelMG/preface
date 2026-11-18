-- 동의서 요약(API-AUTH-07 summary). 가입 화면에 수집 항목·목적·보관 기간 같은 핵심을 전문 링크 없이 바로 보여 준다.
-- 버전 행마다 둬서 그 버전에 동의할 때 본 요약이 증빙으로 남는다. 새 컬럼만 추가(expand) — 구버전 앱은 이 컬럼을 읽지 않는다.
ALTER TABLE consent_document
  ADD COLUMN summary VARCHAR(500) NULL COMMENT '동의서 핵심 요약 (가입 화면 표시, 버전별)' AFTER content_url;

-- 2026-10-v1 FACE_DATA 요약: 이 버전 본문에 이미 있던 내용(수집·목적·원본 삭제)만 옮긴다. 다른 3종은 본문 확정 후 새 버전 행에서 채운다.
UPDATE consent_document
SET summary = '수집: 촬영한 얼굴 영상·3D 얼굴 모델·측정값 / 목적: 3D 얼굴 생성과 참고용 성형 상담 시뮬레이션 / 원본 영상은 3D를 만든 뒤 삭제'
WHERE consent_type = 'FACE_DATA' AND version = '2026-10-v1';
