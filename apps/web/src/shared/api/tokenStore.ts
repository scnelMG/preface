/**
 * access token 보관소.
 *
 * **메모리에만 둔다.** localStorage·sessionStorage에 넣지 않는다 — XSS로 새어 나간다.
 * 새로고침하면 사라지므로, 앱이 뜰 때 refresh 쿠키로 다시 받는다(API-AUTH-03).
 * refresh token은 `HttpOnly; Secure; SameSite=Strict` 쿠키라 JS가 읽을 수 없다.
 */

/** 명세서 "0. 공통 규칙 — 토큰 종류" */
export type TokenScope = 'user' | 'signup' | 'capture'

let accessToken: string | null = null
let scope: TokenScope | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function getScope(): TokenScope | null {
  return scope
}

export function setAccessToken(token: string, tokenScope: TokenScope): void {
  accessToken = token
  scope = tokenScope
}

export function clearAccessToken(): void {
  accessToken = null
  scope = null
}
