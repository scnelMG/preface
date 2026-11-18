import { api } from '@/shared/api/client'
import type { CaptureExchangeResult } from './types'

/**
 * API-QR-02 토큰 교환. 인증 없이 부른다.
 * 토큰은 1회용이다. 같은 토큰을 다시 보내면 `QR_002`가 온다(v2.8).
 * 요청 본문의 토큰을 로그에 남기지 않는다.
 */
export function exchangeCaptureToken(token: string) {
  return api.post<CaptureExchangeResult>('/capture-links/exchange', { token }, { anonymous: true })
}

/**
 * API-QR-04 연결 끊기. 업로드 전용 세션 토큰으로 자기 연결을 끊는다.
 * 끊으면 세션이 즉시 무효가 되고 이후 요청은 `AUTH_023`이다.
 */
export function disconnectCaptureLink(linkId: string) {
  return api.delete<Record<string, never>>(`/capture-links/${encodeURIComponent(linkId)}`)
}
