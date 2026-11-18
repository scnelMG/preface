import type { CaptureTrace } from '@/features/live-capture/captureTrace'
/** 영상 업로드 타입. 원본: API 명세서 v2.9 "3. 상세 — 업로드 (CAP)" */

/** API-CAP-02 GET /uploads/policy */
export interface UploadPolicy {
  video: {
    allowedContentTypes: string[]
    maxSizeBytes: number
    minDurationMs: number
    maxDurationMs: number
    recommendedDurationMs: number
  }
  uploadUrlTtlSec: number
  /** multipart 조각 크기(S15P31B204-506). 이보다 큰 영상은 조각으로 나눠 올린다. 없으면(구버전 서버) 한 번에 PUT */
  partSizeBytes?: number
}

/** 촬영 방식(S15P31B204-617·619). 웹 녹화 또는 파일 올리기 */
export type CaptureMethod = 'WEB_RECORDER' | 'FILE'

/** API-CAP-01 POST /uploads 요청 */
export interface CreateUploadRequest {
  contentType: string
  sizeBytes: number
  durationMs: number
  /** 원본 파일 SHA-256(base64) */
  checksumSha256: string
  /** 없으면 서버가 null로 둔다(예전 FE) */
  captureMethod?: CaptureMethod
  /** 기종(1~100자). 사용자가 고른 값이라 서버는 렌즈 출발값으로만 쓴다 */
  deviceModel?: string
  /**
   * 웹 녹화 촬영 기록(-641). 서버(-640)는 웹 녹화일 때만 저장해 추출 워커에 넘기고, 모양이 틀리면 업로드는 받고 기록만 버린다.
   * 모양: contracts/frame-extraction/schemas/claim-response.schema.json `capture.trace`
   */
  captureTrace?: CaptureTrace
}

/**
 * API-CAP-01 응답. **`uploadUrl`은 서명 URL이다 — 로그·화면·에러 메시지에 남기지 않는다.**
 * `headers`는 서명에 포함된 값이라 PUT에 그대로 실어야 한다.
 */
export interface CreateUploadResult {
  uploadId: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

/** multipart 조각 하나의 서명 PUT. **`url`은 서명 URL이다.** */
export interface MultipartPartUrl {
  partNumber: number
  url: string
  headers: Record<string, string>
}

/** multipart 시작 요청(가칭 API-CAP-05, S15P31B204-506). CAP-01 필드 + 조각 순서대로의 SHA-256(base64) */
export interface StartMultipartRequest extends CreateUploadRequest {
  partChecksums: string[]
}

export interface StartMultipartResult {
  uploadId: string
  partSizeBytes: number
  parts: MultipartPartUrl[]
  expiresAt: string
}

export interface PresignPartsResult {
  parts: MultipartPartUrl[]
  expiresAt: string
}
