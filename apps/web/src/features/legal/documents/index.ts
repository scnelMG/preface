import { LEGAL_LINK_DATE } from '../facts'
import type { LegalDocSlug, LegalDocument } from '../types'
import { FACE_DATA_2026_10_V1, FACE_DATA_2026_10_V2 } from './faceData'
import { FACE_PUBLIC_2026_10_V1 } from './facePublic'
import { FACE_DATA_2026_11_V3 } from './frontPhoto'
import {
  PERSON_REFERENCE_VERSION,
  PRIVACY_2026_12_V1,
  PRIVACY_POLICY_2026_11_V3,
  PRIVACY_POLICY_2026_11_V4,
  PRIVACY_POLICY_2026_12_V1,
  TERMS_2026_12_V1,
} from './personReference'
import { PRIVACY_2026_10_V1 } from './privacy'
import { PRIVACY_POLICY_2026_10_V1, PRIVACY_POLICY_2026_10_V2 } from './privacyPolicy'
import { TERMS_2026_10_V1 } from './terms'

/**
 * 문서 → 버전 → 본문. 새 버전은 새 파일·새 키로 더하고 기존 버전은 고치지 않는다
 * (BE consent_document 행이 버전을 가리키고, 동의 증빙이 그 버전 본문을 뜻한다).
 */
const REGISTRY: Record<LegalDocSlug, Record<string, LegalDocument>> = {
  terms: {
    [TERMS_2026_10_V1.version]: TERMS_2026_10_V1,
    [PERSON_REFERENCE_VERSION]: TERMS_2026_12_V1,
  },
  privacy: {
    [PRIVACY_2026_10_V1.version]: PRIVACY_2026_10_V1,
    [PERSON_REFERENCE_VERSION]: PRIVACY_2026_12_V1,
  },
  'face-data': {
    [FACE_DATA_2026_10_V1.version]: FACE_DATA_2026_10_V1,
    [FACE_DATA_2026_10_V2.version]: FACE_DATA_2026_10_V2,
    [FACE_DATA_2026_11_V3.version]: FACE_DATA_2026_11_V3,
  },
  'face-public': { [FACE_PUBLIC_2026_10_V1.version]: FACE_PUBLIC_2026_10_V1 },
  'privacy-policy': {
    [PRIVACY_POLICY_2026_10_V1.version]: PRIVACY_POLICY_2026_10_V1,
    [PRIVACY_POLICY_2026_10_V2.version]: PRIVACY_POLICY_2026_10_V2,
    [PRIVACY_POLICY_2026_11_V3.version]: PRIVACY_POLICY_2026_11_V3,
    [PRIVACY_POLICY_2026_11_V4.version]: PRIVACY_POLICY_2026_11_V4,
    [PERSON_REFERENCE_VERSION]: PRIVACY_POLICY_2026_12_V1,
  },
}

/** 없는 문서·버전이면 undefined(화면은 404) */
export function getLegalDocument(doc: string, version: string): LegalDocument | undefined {
  if (!Object.hasOwn(REGISTRY, doc)) return undefined
  const versions = REGISTRY[doc as LegalDocSlug]
  return Object.hasOwn(versions, version) ? versions[version] : undefined
}

/** generateStaticParams용 — 있는 문서·버전 전부 */
export function listLegalDocuments(): LegalDocument[] {
  return Object.values(REGISTRY).flatMap((versions) => Object.values(versions))
}

/** 경로. BE 시드 content_url과 같은 모양 */
export function legalPath(doc: LegalDocSlug, version: string): string {
  return `/legal/${doc}/${version}`
}

/**
 * 문서의 현재 버전 경로. 시행일(effectiveAt, KST 날짜)이 기준일 이전인 버전 중 버전 문자열(YYYY-MM-vN)을 숫자까지 고려해
 * 정렬한 마지막 값. 미리 올려 둔 새 버전(-439 v2)은 시행일 전까지 링크되지 않는다(BE `currentByType`과 같은 기준).
 * 기준일은 `LEGAL_LINK_DATE`(고정값)다 — 푸터가 미리 렌더링되는 화면에 있어 현재 시각을 읽을 수 없다(cacheComponents).
 */
export function latestLegalPath(doc: LegalDocSlug, today: string = LEGAL_LINK_DATE): string {
  const [latest] = Object.values(REGISTRY[doc])
    .filter((document) => document.effectiveAt <= today)
    .map((document) => document.version)
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
  return legalPath(doc, latest)
}

/** 공통 푸터 링크. 개인정보 처리방침은 눈에 띄게(굵게) — 법 제30조제2항·처리방침 작성지침 "공개 방법" */
export function legalFooterLinks() {
  return [
    { href: latestLegalPath('terms'), label: '이용약관' },
    { href: latestLegalPath('privacy-policy'), label: '개인정보 처리방침', strong: true },
  ]
}
