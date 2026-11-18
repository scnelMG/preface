import { api } from '@/shared/api/client'
import type { FaceReading } from './types'

/** 관상 요청(202). 이미 있으면 그것을 준다. 추출 전 409 `READ_001`, 사진이 지워졌으면 409 `READ_002` */
export function requestFaceReading(jobId: string) {
  return api.post<FaceReading>(`/reconstructions/${encodeURIComponent(jobId)}/face-reading`, {})
}

/** 그 작업의 관상(다시 들어왔을 때). 요청한 적이 없으면 404 `COMMON_002` */
export function getFaceReadingByJob(jobId: string, signal?: AbortSignal) {
  return api.get<FaceReading>(`/reconstructions/${encodeURIComponent(jobId)}/face-reading`, {
    signal,
  })
}

/**
 * 관상에 쓴 정면 사진(S15P31B204-452). 관상을 요청한 본인에게만, 3D 완성 전까지만 온다.
 * 로그인 토큰이 필요해 `<img src>`로 바로 부르지 못하고 Blob으로 받는다.
 */
export function getFaceReadingPhoto(jobId: string, signal?: AbortSignal) {
  return api.getBlob(`/reconstructions/${encodeURIComponent(jobId)}/face-reading/photo`, { signal })
}

export function getFaceReading(readingId: string, signal?: AbortSignal) {
  return api.get<FaceReading>(`/face-readings/${encodeURIComponent(readingId)}`, { signal })
}
