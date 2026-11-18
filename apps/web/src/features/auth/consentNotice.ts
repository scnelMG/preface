import type { ConsentDocument, ConsentType } from './types'

/**
 * 가입 동의 화면의 고지 요약(FN-AUTH-03 수용 2: 보관 기간·국내 저장·LLM 전송 범위 문구 표시).
 *
 * 서버 `summary`가 오면 그걸 쓴다(명세서 v3.1부터 `consent_document.summary`, 버전별).
 * 값이 없는 버전(null)이면 FE 고정 문구를 쓴다. 2026-10-v1은 FACE_DATA만 서버 값이 있다. FE 문구 근거: API 명세서 v2.9 "0. 공통 규칙"(삭제 방식·LLM 전송 범위), API-AUTH-07 비고.
 * 얼굴 사진 5방향 보관(v2.9)은 동의서 문구 개정·법적 검토가 미결이다 — 동의서 새 버전이 나오면 같이 맞춘다.
 */
const FE_NOTICE: Partial<Record<ConsentType, readonly string[]>> = {
  FACE_DATA: [
    '수집: 촬영한 얼굴 영상·3D 얼굴 모델·측정값',
    '목적: 3D 얼굴 생성과 참고용 성형 상담 시뮬레이션',
    '보관: 원본 영상은 3D를 만들면 바로(실패하면 24시간 뒤) 삭제돼요. 3D·시안은 직접 지우면 30일 뒤, 탈퇴하면 바로 영구 삭제돼요.',
    '얼굴 사진(5방향)은 서비스 개선을 위해 보관하고, 3D를 지우거나 탈퇴하면 함께 삭제돼요.',
    '저장: 국내에 있는 서버에만 저장해요.',
    'AI 상담: 얼굴 사진·영상·3D 이미지는 AI(LLM)로 보내지 않아요. 측정값과 대화 문장만 보내요.',
  ],
  // 서버는 공유 링크를 만들 때만 이 동의를 확인한다(BE `ShareConsentPolicy`). 동의서 본문의 "시안 공유 대비"와 같은 뜻이다
  FACE_PUBLIC: ['쓰임: 편집한 시안을 공유 링크로 만들 때만 쓰여요'],
}

/** 동의서 아래에 펼쳐 둘 고지 문구 줄. 없으면 빈 배열 */
export function consentNoticeLines(doc: ConsentDocument): readonly string[] {
  if (doc.summary) return doc.summary.split(/\s*\/\s*|\n/).filter(Boolean)
  return FE_NOTICE[doc.consentType] ?? []
}
