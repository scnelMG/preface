import { api } from '@/shared/api/client'
import { ADMIN_PAGE_SIZE, ADMIN_PAGE_SIZE_MAX } from '../api'
import type { AdminPage } from '../types'
import type { AdminUserFilters, AdminUserRow } from './types'

/**
 * 회원 목록·검색(관리자 2차 계약 2절). `q`가 비면 전체, UUID면 그 회원 1건(탈퇴 포함), 그 밖은 이름 부분 일치.
 * 모두 가입 최신순. 빈 검색어는 보내지 않는다.
 */
export function listAdminUsers(filters: AdminUserFilters = {}, signal?: AbortSignal) {
  const { q, page = 0, size = ADMIN_PAGE_SIZE } = filters
  return api.get<AdminPage<AdminUserRow>>('/admin/users', {
    query: {
      q: q?.trim() || undefined,
      page: Math.max(0, page),
      size: Math.min(Math.max(1, size), ADMIN_PAGE_SIZE_MAX),
    },
    signal,
  })
}
