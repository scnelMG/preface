import { api } from '@/shared/api/client'
import { toApiInstant } from './jobFilters'
import type {
  AdminJobDetail,
  AdminJobFilters,
  AdminJobRow,
  AdminMe,
  AdminPage,
  ReconstructionQueue,
  ReconstructionSummary,
  SummaryPeriod,
} from './types'

/**
 * 관리자 API(관리자 API 계약 2026-11-07). 모두 GET이고 로그인 + 관리자 권한이 필요하다.
 * 관리자가 아니면 403(`ADM_001`), 비로그인이면 401이 온다. 실패는 공통 클라이언트가 `ApiError`로 던진다.
 */

/** 관리자 목록의 한 페이지 최대 개수(계약 "페이지 형식") */
export const ADMIN_PAGE_SIZE_MAX = 100
export const ADMIN_PAGE_SIZE = 20

/** 관리자 권한 거절 코드 */
export const ADMIN_FORBIDDEN_CODE = 'ADM_001'

/** 1. 지금 로그인한 관리자와 이 서버의 환경(운영·개발·로컬) */
export function getAdminMe(signal?: AbortSignal) {
  return api.get<AdminMe>('/admin/me', { signal })
}

/** 2. 기간별 요약(상태별 수, 실패율, 실패 코드, 걸린 시간, 멈춘 작업) */
export function getReconstructionSummary(period: SummaryPeriod, signal?: AbortSignal) {
  return api.get<ReconstructionSummary>('/admin/reconstructions/summary', {
    query: { period },
    signal,
  })
}

/**
 * 3. 작업 목록. 빈 거르기 값은 보내지 않는다.
 * 날짜만 있는 `from`·`to`(`YYYY-MM-DD`, 한국 날짜)는 그날 0시 ~ 다음 날 0시의 UTC 시각으로 바꿔 보낸다.
 */
export function listReconstructions(filters: AdminJobFilters = {}, signal?: AbortSignal) {
  const { status, failCode, stage, userId, from, to, page = 0, size = ADMIN_PAGE_SIZE } = filters
  return api.get<AdminPage<AdminJobRow>>('/admin/reconstructions', {
    query: {
      status: status || undefined,
      failCode: failCode || undefined,
      stage: stage || undefined,
      userId: userId?.trim() || undefined,
      from: toApiInstant(from, 'from'),
      to: toApiInstant(to, 'to'),
      page: Math.max(0, page),
      size: Math.min(Math.max(1, size), ADMIN_PAGE_SIZE_MAX),
    },
    signal,
  })
}

/** 4. 작업 상세(구간 시간, 실패, 이전 실패, 입력 정보) */
export function getReconstructionDetail(jobId: string, signal?: AbortSignal) {
  return api.get<AdminJobDetail>(`/admin/reconstructions/${encodeURIComponent(jobId)}`, {
    signal,
  })
}

/** 5. 지금 기다리는 작업(추출 대기·GPU 대기). 순번은 사용자 화면 queuePosition과 같은 기준 */
export function getReconstructionQueue(signal?: AbortSignal) {
  return api.get<ReconstructionQueue>('/admin/reconstructions/queue', { signal })
}
