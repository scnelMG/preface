import type { AdminJobFilters } from './types'

/**
 * 작업 목록 거르기 ↔ 주소 쿼리 문자열. 거르기를 주소에 남겨 새로 고침·링크 공유에도 같은 목록이 뜨게 한다.
 * 쿼리 이름은 API(`GET /admin/reconstructions`)와 같다. 날짜(`from`·`to`)는 주소에 `YYYY-MM-DD`로 둔다.
 */
const KEYS = ['status', 'failCode', 'stage', 'userId', 'from', 'to'] as const

type Readable = Pick<URLSearchParams, 'get'>

export function filtersFromSearch(params: Readable): AdminJobFilters {
  const filters: AdminJobFilters = {}
  for (const key of KEYS) {
    const value = params.get(key)?.trim()
    if (value) filters[key] = value
  }
  const page = Number(params.get('page'))
  if (Number.isInteger(page) && page > 0) filters.page = page
  return filters
}

/** 빈 값과 첫 페이지(0)는 빼서 주소를 짧게 둔다 */
export function searchFromFilters(filters: AdminJobFilters): string {
  const params = new URLSearchParams()
  for (const key of KEYS) {
    const value = filters[key]?.trim()
    if (value) params.set(key, value)
  }
  if (filters.page && filters.page > 0) params.set('page', String(filters.page))
  return params.toString()
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * 화면 날짜(한국 날짜) → API 시각(ISO-8601 UTC). `from`은 그날 0시, `to`는 **다음 날 0시**(그날 끝까지 포함)다.
 * 이미 시각이 들어 있으면 그대로 보낸다.
 */
export function toApiInstant(date: string | undefined, edge: 'from' | 'to'): string | undefined {
  if (!date) return undefined
  if (!DATE_ONLY.test(date)) return date
  const start = new Date(`${date}T00:00:00+09:00`)
  if (Number.isNaN(start.getTime())) return undefined
  if (edge === 'to') start.setUTCDate(start.getUTCDate() + 1)
  return start.toISOString()
}
