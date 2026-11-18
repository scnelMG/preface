/**
 * 동의서·약관 전문(REQ-F-32 "항목별 전문 확인") 데이터 형식.
 *
 * 본문에 남은 미확정 값은 `[연락처]`(facts.ts CONTACT) 하나뿐이다. 새로 미확정 값을 둘 때는 `[확정 필요: …]`로 쓴다.
 * 화면은 둘 다 눈에 띄게 표시한다(`LegalText`). 배포 전에 모두 지워야 한다.
 */

/** URL 첫 칸. BE 시드(V2__seed_consent_documents.sql)의 content_url `/legal/{doc}/{version}`과 같다 */
export const LEGAL_DOC_SLUGS = [
  'terms',
  'privacy',
  'face-data',
  'face-public',
  'privacy-policy',
] as const
export type LegalDocSlug = (typeof LEGAL_DOC_SLUGS)[number]

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: readonly string[]; ordered?: boolean }
  | {
      kind: 'table'
      caption: string
      head: readonly string[]
      rows: readonly (readonly string[])[]
    }

export interface LegalSection {
  /** 목차 이동용 앵커(영어 소문자·하이픈) */
  id: string
  title: string
  /** 약관의 중요한 내용 — 굵게·상자로 눈에 띄게 그린다(약관규제법 제3조제1항) */
  important?: boolean
  blocks: readonly LegalBlock[]
  /**
   * 이 조항을 쓴 근거(법 조항·지침 항목·저장소 문서). 화면 맨 아래 "작성 근거" 표에 나온다.
   * 법무 검토자가 조항마다 근거를 대조할 수 있게 둔다.
   */
  basis: readonly string[]
}

export interface LegalDocument {
  slug: LegalDocSlug
  /** API-AUTH-07 consentType. 처리방침은 동의 대상이 아니라 null */
  consentType: 'TERMS' | 'PRIVACY' | 'FACE_DATA' | 'FACE_PUBLIC' | null
  version: string
  title: string
  /** 시행일(ISO 날짜). BE 시드 effective_at도 같은 날로 맞춘다 */
  effectiveAt: string
  /** 머리말 — 이 문서가 무엇인지 한두 문장 */
  intro: string
  sections: readonly LegalSection[]
}

/** 공식 출처. 작성 근거 표 아래에 목록으로 나온다 */
export interface LegalSource {
  id: string
  name: string
  org: string
  /** 버전·시행일·발간일 */
  edition: string
  url: string
}
