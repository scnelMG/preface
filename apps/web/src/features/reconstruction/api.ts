import { api } from '@/shared/api/client'
import type { CreateReconstructionResult, ReconstructionJob } from './types'

/** API-REC-01 업로드 완료 통지 + 복원 작업 생성. 같은 uploadId면 멱등 */
export function createReconstruction(uploadId: string) {
  return api.post<CreateReconstructionResult>('/reconstructions', { uploadId })
}

/** API-REC-02 복원 상태 조회 */
export function getReconstruction(jobId: string, signal?: AbortSignal) {
  return api.get<ReconstructionJob>(`/reconstructions/${encodeURIComponent(jobId)}`, { signal })
}

/**
 * API-REC-03 진행 중(+최근 실패) 작업 조회.
 * 없으면 `data: null`이 온다. 최근 실패 = 마지막 작업이 FAILED이고 종료가 24시간 이내.
 */
export function getCurrentReconstruction(
  options: { includeRecentFailed?: boolean; signal?: AbortSignal } = {},
) {
  return api.get<ReconstructionJob | null>('/reconstructions/current', {
    query: { includeRecentFailed: options.includeRecentFailed ?? false },
    signal: options.signal,
  })
}
