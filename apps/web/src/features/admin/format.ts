import type { AdminJobDetail, JobSegment, SegmentKey } from './types'

/** 기록이 없는 값(구간 시각·시간이 null이거나 구간이 빠짐) */
export const NO_RECORD = '기록 없음'

/** 상태 이름. 모르는 값은 받은 그대로 보인다(계약: counts 키는 BE status 값 그대로) */
export const STATUS_LABELS: Record<string, string> = {
  QUEUED: '대기',
  EXTRACTING: '추출 중',
  RUNNING: '만드는 중',
  SUCCEEDED: '성공',
  FAILED: '실패',
  CANCELED: '취소',
}

/** 작업 목록 거르기에 쓰는 상태(BE ReconstructionStatus) */
export const STATUS_OPTIONS = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const

/** 화면 4단계(BE ReconstructionStage) */
export const STAGE_LABELS: Record<string, string> = {
  FRAME_SELECT: '프레임 고르기',
  QUALITY_CHECK: '품질 확인',
  RECONSTRUCT: '3D 만들기',
  FINALIZE: '마무리',
}

export const STAGE_OPTIONS = ['FRAME_SELECT', 'QUALITY_CHECK', 'RECONSTRUCT', 'FINALIZE'] as const

/** 구간 순서와 이름(계약 4절 segments 순서) */
export const SEGMENT_ORDER: readonly SegmentKey[] = [
  'EXTRACT_WAIT',
  'EXTRACT',
  'GPU_WAIT',
  'FRAME_SELECT',
  'QUALITY_CHECK',
  'RECONSTRUCT',
  'FINALIZE',
]

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  EXTRACT_WAIT: '추출 대기',
  EXTRACT: '프레임 추출',
  GPU_WAIT: 'GPU 대기',
  FRAME_SELECT: '프레임 고르기',
  QUALITY_CHECK: '품질 확인',
  RECONSTRUCT: '3D 만들기',
  FINALIZE: '마무리',
}

export function labelOf(labels: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '-'
  return labels[key] ?? key
}

/** UUID 앞 8자리. 전체 값은 링크 title로 두고, 상세 화면에서 전체를 보인다 */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** 밀리초 → `4분 2초`, `1.2초`, `350ms`. null이면 "기록 없음" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return NO_RECORD
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)}초`
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}시간 ${minutes}분`
  if (minutes) return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`
  return `${seconds}초`
}

const dateTimeFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** UTC 문자열 → 한국 시각 `2026. 11. 07. 12:12:45`. 없거나 잘못된 값이면 "기록 없음" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return NO_RECORD
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return NO_RECORD
  return dateTimeFormat.format(date)
}

/** 0.111 → `11.1%`. null이면 `-`(끝난 작업이 없다) */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '-'
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`
}

export interface SegmentRow {
  /** 줄 식별자. 같은 구간을 다시 시도하면 key가 겹치므로 순번을 붙인다 */
  id: string
  key: string
  label: string
  startedAt: string
  finishedAt: string
  duration: string
  /** 시간 기록이 하나도 없다 */
  missing: boolean
  /** 가장 오래 걸린 구간 */
  slowest: boolean
  attempt: number | null
  status: string | null
}

/**
 * 처리 순서에는 있지만 기록이 없으면 줄을 만들지 않는 구간. `FRAME_SELECT`는 추출 워커가 하는 일이라 GPU 워커가
 * 보고하지 않아(contracts/reconstruction "값 규칙") 늘 비어 있다. 언젠가 기록이 오면 그때만 보인다
 */
const OPTIONAL_SEGMENTS: ReadonlySet<string> = new Set(['FRAME_SELECT'])

/**
 * 구간 표의 줄. 계약의 구간을 처리 순서대로 보이고, 응답에 없는 구간은 "기록 없음"으로 채운다.
 * 같은 구간을 다시 시도했으면(추출 재시도, GPU 재대기열) **시도마다 한 줄**씩 받은 순서대로 보인다.
 * 계약에 없는 새 구간 키가 오면 뒤에 붙인다.
 *
 * 가장 오래 걸린 구간은 BE가 준 `slowestSegment`(키)를 먼저 쓰고, 없으면 `durationMs`가 가장 큰 구간으로 정한다.
 * 그 키의 시도가 여럿이면 가장 오래 걸린 시도 한 줄만 강조한다.
 */
export function segmentRows(
  detail: Pick<AdminJobDetail, 'segments' | 'slowestSegment'>,
): SegmentRow[] {
  const segments = detail.segments ?? []
  const byKey = new Map<string, JobSegment[]>()
  for (const segment of segments) {
    const list = byKey.get(segment.key)
    if (list) list.push(segment)
    else byKey.set(segment.key, [segment])
  }

  const keys: string[] = [...SEGMENT_ORDER]
  for (const key of byKey.keys()) if (!keys.includes(key)) keys.push(key)

  const slowestKey = detail.slowestSegment ?? slowestByDuration(segments)?.key ?? null
  const slowest = slowestByDuration(
    segments.filter((segment) => segment.key === slowestKey && hasTime(segment)),
  )
  // 시간 기록이 없는 시도만 있으면 그 키의 첫 시도를 강조 후보로 둔다(아래 missing 검사로 걸러진다)
  const slowestSegment = slowest ?? byKey.get(slowestKey ?? '')?.[0] ?? null

  const rows: SegmentRow[] = []
  for (const key of keys) {
    const list = byKey.get(key)
    if (!list) {
      if (!OPTIONAL_SEGMENTS.has(key)) rows.push(segmentRow(key, null, `${key}-0`, false))
      continue
    }
    list.forEach((segment, index) =>
      rows.push(segmentRow(key, segment, `${key}-${index}`, segment === slowestSegment)),
    )
  }
  return rows
}

function hasTime(segment: JobSegment): boolean {
  return !(segment.startedAt == null && segment.finishedAt == null && segment.durationMs == null)
}

function segmentRow(
  key: string,
  segment: JobSegment | null,
  id: string,
  slowest: boolean,
): SegmentRow {
  const missing = !segment || !hasTime(segment)
  return {
    id,
    key,
    label: labelOf(SEGMENT_LABELS, key),
    startedAt: formatDateTime(segment?.startedAt),
    finishedAt: formatDateTime(segment?.finishedAt),
    duration: formatDuration(segment?.durationMs),
    missing,
    slowest: !missing && slowest,
    attempt: segment?.attempt ?? null,
    status: segment?.status ?? null,
  }
}

function slowestByDuration(segments: readonly JobSegment[]): JobSegment | null {
  let best: JobSegment | null = null
  for (const segment of segments) {
    if (segment.durationMs == null) continue
    if (!best || segment.durationMs > (best.durationMs ?? -1)) best = segment
  }
  return best
}

/** 초 → 밀리초. 숫자가 아니면 null(qualityReport 값은 워커 버전마다 빠질 수 있다) */
export function secToMs(sec: unknown): number | null {
  return typeof sec === 'number' && Number.isFinite(sec) ? Math.round(sec * 1000) : null
}

/** 측정값 없음(이 작업에 그 값이 안 남음). 배포 전 작업은 NO_REPORT */
export const NOT_MEASURED = '미측정'
/** qualityReport 자체가 없는 작업(워커가 보고하기 전 배포의 작업, 또는 3D 단계 전에 끝난 작업) */
export const NO_REPORT = '기록 없음(배포 전 작업)'

/** 숫자를 소수 n자리까지(끝 0은 지운다). 숫자가 아니면 "미측정" */
export function formatNumber(value: unknown, digits = 1, unit = ''): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NOT_MEASURED
  return `${Number(value.toFixed(digits))}${unit}`
}
