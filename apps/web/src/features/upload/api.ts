import { api } from '@/shared/api/client'
import type {
  CreateUploadRequest,
  CreateUploadResult,
  PresignPartsResult,
  StartMultipartRequest,
  StartMultipartResult,
  UploadPolicy,
} from './types'

/** API-CAP-02 업로드 정책. 일반 세션·업로드 전용 세션 모두 부를 수 있다 */
export function getUploadPolicy(signal?: AbortSignal) {
  return api.get<UploadPolicy>('/uploads/policy', { signal })
}

/**
 * API-CAP-01 업로드 URL 발급.
 * 검사 순서: 얼굴 동의(CAP_001) → 진행 중 작업(REC_002) → 정책(CAP_002)
 */
export function createUploadUrl(body: CreateUploadRequest, signal?: AbortSignal) {
  return api.post<CreateUploadResult>('/uploads', body, { signal })
}

/** multipart 시작(가칭 API-CAP-05, S15P31B204-506). 검사 순서는 CAP-01과 같고 조각 수가 맞지 않으면 COMMON_001 */
export function startMultipartUpload(body: StartMultipartRequest, signal?: AbortSignal) {
  return api.post<StartMultipartResult>('/uploads/multipart', body, { signal })
}

/** 만료됐거나 실패한 조각 URL 재발급(가칭 API-CAP-06) */
export function presignUploadParts(uploadId: string, partNumbers: number[], signal?: AbortSignal) {
  return api.post<PresignPartsResult>(
    `/uploads/${encodeURIComponent(uploadId)}/parts`,
    { partNumbers },
    { signal },
  )
}

/** 조각 합치기(가칭 API-CAP-07). 다시 불러도 된다(멱등) */
export function completeMultipartUpload(
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
  signal?: AbortSignal,
) {
  return api.post<void>(`/uploads/${encodeURIComponent(uploadId)}/complete`, { parts }, { signal })
}
