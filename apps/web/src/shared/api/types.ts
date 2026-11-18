/**
 * 공통 응답 형식. API 명세서 v2.7 "0. 공통 규칙"과 같다.
 * BE 구현: services/backend/common/.../response/ApiResponse.java
 */

export interface FieldError {
  field: string
  reason: string
}

export interface ErrorBody {
  code: string
  message: string
  details: FieldError[]
}

export interface ApiSuccess<T> {
  success: true
  data: T
  error: null
}

export interface ApiFailure {
  success: false
  data: null
  error: ErrorBody
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

/** 페이지네이션. `?page=0&size=20` (size 최대 50) */
export interface Page<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
}

export interface PageParams {
  page?: number
  size?: number
}
