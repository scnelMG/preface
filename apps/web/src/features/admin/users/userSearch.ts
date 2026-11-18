import { ADMIN_PATHS } from '../paths'
import type { AdminUserFilters } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 서버와 같은 기준(앞뒤 공백 제거, 대소문자 무시)으로 UUID 모양인지 본다 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim())
}

/** 주소 쿼리 → 검색 조건. 잘못된 page는 0으로 본다 */
export function userFiltersFromSearch(params: URLSearchParams): AdminUserFilters {
  const q = params.get('q')?.trim() ?? ''
  const page = Number(params.get('page'))
  return {
    q: q || undefined,
    page: Number.isInteger(page) && page > 0 ? page : 0,
  }
}

/** 검색 조건 → 회원 목록 주소. 빈 검색어와 첫 페이지는 주소에 남기지 않는다 */
export function usersPath({ q, page }: AdminUserFilters = {}): string {
  const params = new URLSearchParams()
  const query = q?.trim()
  if (query) params.set('q', query)
  if (page && page > 0) params.set('page', String(page))
  const search = params.toString()
  return search ? `${ADMIN_PATHS.users}?${search}` : ADMIN_PATHS.users
}

/** 머리줄 사용자 조회 입력의 갈 곳. UUID면 그 사용자의 화면, 아니면 회원 검색. 비면 null */
export function lookupPath(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  return isUuid(value) ? ADMIN_PATHS.user(value) : usersPath({ q: value })
}
