import { API_BASE_URL } from '@/shared/config/env'
import { ApiError, NetworkError } from './ApiError'
import { ErrorCode } from './errorCodes'
import { clearAccessToken, getAccessToken, getScope, setAccessToken } from './tokenStore'
import type { ApiResponse, PageParams } from './types'

/**
 * API 클라이언트. 원본 계약은 API 명세서 v2.7이다.
 *
 * - Base `/api/v1`
 * - `Authorization: Bearer <accessToken>`
 * - refresh token은 쿠키라 모든 요청에 `credentials: 'include'`가 필요하다
 * - `AUTH_002`(access token 만료)를 받으면 재발급 후 **한 번만** 재시도한다
 */

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  /** 쿼리 문자열. null·undefined 값은 빠진다 */
  query?: Query
  body?: unknown
  /** 인증 헤더를 붙이지 않는다. 명세서상 AUTH-01·02·07, EDIT-01만 해당 */
  anonymous?: boolean
  /** 만료 재시도를 하지 않는다 (재발급 요청 자신이 쓴다) */
  noRetry?: boolean
  signal?: AbortSignal
  headers?: Record<string, string>
}

/** Base가 상대 경로(`/api/v1`, 배포 빌드)여도 된다. `new URL()`은 절대 주소만 받으므로 쓰지 않는다 */
function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  return `${API_BASE_URL}${path}${search ? `?${search}` : ''}`
}

/**
 * 재발급은 한 번에 하나만 돈다.
 * 401이 동시에 여러 개 터져도 refresh 요청은 1회로 묶이고, 나머지는 그 결과를 기다린다.
 */
let refreshInFlight: Promise<boolean> | null = null

/**
 * refresh 쿠키로 access token을 다시 받는다(API-AUTH-03). 성공하면 true.
 * 앱 시작 때 세션 복구(features/auth/session)도 이 함수를 쓴다 — 동시에 불려도 요청은 한 번이다.
 */
export async function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      // API-AUTH-03. refresh token은 본문이 아니라 쿠키로 간다
      const data = await request<{ accessToken: string; expiresIn: number }>(
        'POST',
        '/auth/token/refresh',
        { anonymous: true, noRetry: true },
      )
      setAccessToken(data.accessToken, 'user')
      return true
    } catch {
      // AUTH_003(refresh 무효) 포함. 다시 로그인해야 한다
      clearAccessToken()
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  if (!options.anonymous) {
    const token = getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  try {
    return await fetch(buildUrl(path, options.query), {
      method,
      headers,
      // refresh token 쿠키를 주고받으려면 반드시 있어야 한다
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new NetworkError(cause)
  }
}

async function parse<T>(response: Response): Promise<ApiResponse<T>> {
  // 204 No Content
  if (response.status === 204) return { success: true, data: undefined as T, error: null }
  try {
    return (await response.json()) as ApiResponse<T>
  } catch (cause) {
    throw new NetworkError(cause)
  }
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(method, path, options)
  let payload = await parse<T>(response)

  // access token 만료 → 재발급 후 한 번만 재시도 (명세서 AUTH_002).
  // 일반 세션(user)만 refresh가 있다. 가입 토큰·업로드 전용 세션은 재발급하지 않는다
  // (가입 토큰이 만료됐는데 다른 계정의 refresh 쿠키로 회원 세션이 열리면 안 된다).
  if (
    !payload.success &&
    payload.error.code === ErrorCode.ACCESS_TOKEN_EXPIRED &&
    !options.noRetry &&
    !options.anonymous &&
    getScope() === 'user'
  ) {
    const renewed = await refreshAccessToken()
    if (renewed) {
      response = await send(method, path, { ...options, noRetry: true })
      payload = await parse<T>(response)
    }
  }

  if (!payload.success) throw new ApiError(response.status, payload.error)
  return payload.data
}

/**
 * 이미지 같은 바이너리 GET. 성공하면 본문을 그대로(Blob) 주고, 실패 응답은 공통 에러(JSON)라 `request`와 같이 던진다.
 * 만료 재시도도 같다.
 */
async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const blobOptions = {
    ...options,
    headers: { Accept: 'image/*, application/json', ...options.headers },
  }
  let response = await send('GET', path, blobOptions)
  if (response.ok) return response.blob()
  let payload = await parse<never>(response)

  if (
    !payload.success &&
    payload.error.code === ErrorCode.ACCESS_TOKEN_EXPIRED &&
    !options.noRetry &&
    !options.anonymous &&
    getScope() === 'user'
  ) {
    if (await refreshAccessToken()) {
      response = await send('GET', path, { ...blobOptions, noRetry: true })
      if (response.ok) return response.blob()
      payload = await parse<never>(response)
    }
  }

  if (payload.success) throw new NetworkError(new Error(`unexpected status ${response.status}`))
  throw new ApiError(response.status, payload.error)
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('DELETE', path, options),
  getBlob: (path: string, options?: Omit<RequestOptions, 'body'>) => requestBlob(path, options),
}

/** 페이지 파라미터를 쿼리로 바꾼다. size 최대 50 (명세서 "페이지네이션") */
export function pageQuery({ page = 0, size = 20 }: PageParams = {}): Query {
  return { page, size: Math.min(size, 50) }
}

/** 테스트용. 모듈 수준 재발급 상태를 비운다 */
export function __resetRefreshState() {
  refreshInFlight = null
}
