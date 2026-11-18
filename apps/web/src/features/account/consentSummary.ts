import { CONSENT_TYPES, type ConsentRecord, type Provider } from '@/features/auth/types'

/** 화면 날짜 `2026.10.19`. 서버 시각은 UTC라 한국 시간으로 바꿔 날짜만 쓴다 */
export function formatDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}.${get('month')}.${get('day')}`
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  KAKAO: '카카오',
  GOOGLE: 'Google',
}

/** 서버 순서와 상관없이 TERMS → PRIVACY → FACE_DATA → FACE_PUBLIC */
export function sortRecords(records: ConsentRecord[]): ConsentRecord[] {
  return [...records].sort(
    (a, b) => CONSENT_TYPES.indexOf(a.consentType) - CONSENT_TYPES.indexOf(b.consentType),
  )
}

export interface ConsentSummary {
  /** 동의 4종 기록이 모두 있다. 누락은 정상 가입 상태가 아니다(API-AUTH-09 — FE 오류 표시) */
  complete: boolean
  /** 요약 한 줄. 예: `동의함 · 2026.10.19 · 버전 2026-10-v1 · 최신` */
  line: string
}

/** SCR-12 동의 요약 카드 */
export function summarizeConsents(records: ConsentRecord[]): ConsentSummary {
  const byType = new Map(records.map((r) => [r.consentType, r]))
  const complete = CONSENT_TYPES.every((t) => byType.has(t))
  const withdrawn = records.filter((r) => r.status === 'WITHDRAWN')

  const versions = [...new Set(records.map((r) => r.version))]
  const version = versions.length === 1 ? `버전 ${versions[0]}` : '버전 여러 개'
  const latest = records.every((r) => r.isLatestVersion) ? '최신' : '새 버전 있음'

  const lastAgreed = latestOf(records.map((r) => r.agreedAt))
  // 화면에서 새로 철회할 수는 없지만, 이전에 철회한 기록이 있으면 그대로 보여 준다
  const lastWithdrawn = latestOf(withdrawn.map((r) => r.withdrawnAt))
  const head =
    withdrawn.length > 0
      ? ['얼굴 동의 철회함', lastWithdrawn && formatDate(lastWithdrawn)]
      : ['동의함', lastAgreed && formatDate(lastAgreed)]

  return {
    complete,
    line: [...head, version, latest].filter(Boolean).join(' · '),
  }
}

function latestOf(values: (string | null)[]): string | null {
  const times = values.filter((v): v is string => !!v).sort()
  return times.at(-1) ?? null
}

/** SCR-03 한 줄 기록. 예: `동의함 · 2026.10.19 · 버전 2026-10-v1 · 시행 2026.10.01` */
export function recordLine(record: ConsentRecord): string {
  const head =
    record.status === 'WITHDRAWN'
      ? ['철회함', record.withdrawnAt && formatDate(record.withdrawnAt)]
      : ['동의함', record.agreedAt && formatDate(record.agreedAt)]
  return [
    ...head,
    `버전 ${record.version}`,
    `시행 ${formatDate(record.effectiveAt)}`,
    record.isLatestVersion ? null : '새 버전 있음',
  ]
    .filter(Boolean)
    .join(' · ')
}
