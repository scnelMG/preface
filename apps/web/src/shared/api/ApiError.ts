import { ErrorCode, ErrorGroup, isInGroup } from './errorCodes'
import type { ErrorBody, FieldError } from './types'

/**
 * 서버가 내려준 실패 응답. `message`는 서버 문구를 그대로 쓴다.
 * 예외: 복원 실패 `failCodes[]`는 서버가 문구를 내리지 않으므로 FE 문구 사전이 만든다
 * (명세서 API-REC-02 비고).
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: FieldError[]

  constructor(status: number, body: ErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.code = body.code
    this.status = status
    this.details = body.details ?? []
  }

  /** 필드별 검증 사유를 폼에 꽂을 수 있는 형태로 바꾼다 (COMMON_001) */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.field, d.reason]))
  }

  get isRetryable() {
    return isInGroup(this.code, ErrorGroup.RETRYABLE)
  }
  get needsReauth() {
    return isInGroup(this.code, ErrorGroup.REAUTH)
  }
  get needsSignup() {
    return isInGroup(this.code, ErrorGroup.SIGNUP)
  }
  get isCaptureEnded() {
    return isInGroup(this.code, ErrorGroup.CAPTURE_ENDED)
  }
  get needsRefetch() {
    return isInGroup(this.code, ErrorGroup.REFETCH)
  }
  /** 타인 리소스도 404로 온다 — 존재 여부를 노출하지 않으려는 의도다 (명세서 "권한") */
  get isNotFound() {
    return this.code === ErrorCode.NOT_FOUND
  }
}

/** 네트워크 자체가 실패했거나 응답이 JSON이 아닐 때 */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.')
    this.name = 'NetworkError'
    this.cause = cause
  }
}
