/** QR 휴대폰 연결 타입. 원본: API 명세서 v3.2 "3-1. 상세 — QR 휴대폰 연결 (QR)" */

/**
 * 링크 상태. WAITING → CONNECTED(휴대폰이 토큰 교환) → UPLOADED(휴대폰 업로드 끝, jobId 생김).
 * 3분 안에 교환하지 않으면 EXPIRED, 누군가 연결을 끊으면 CANCELED.
 */
export type CaptureLinkStatus = 'WAITING' | 'CONNECTED' | 'UPLOADED' | 'EXPIRED' | 'CANCELED'

/** API-QR-01 POST /capture-links 응답 */
export interface CreatedCaptureLink {
  linkId: string
  /**
   * 휴대폰이 열 주소. 토큰이 fragment(`#t=`)에 들어 있다.
   * **로그·토스트·에러 보고에 남기지 않는다**(REQ-N-21). QR 그림으로만 쓴다.
   */
  qrUrl: string
  expiresAt: string
}

/** API-QR-03 GET /capture-links/{linkId} 응답 */
export interface CaptureLinkState {
  linkId: string
  status: CaptureLinkStatus
  /**
   * WAITING이면 QR 만료, CONNECTED 이후면 업로드 세션 만료 시각.
   * 시간이 지나 서버 기록이 사라진 EXPIRED면 null이다(BE `CaptureLinkStatusResponse`)
   */
  expiresAt: string | null
  /** UPLOADED일 때만 */
  jobId: string | null
}

/** 더 기다릴 일이 없는 상태. 폴링을 멈춘다 */
export function isLinkClosed(status: CaptureLinkStatus): boolean {
  return status === 'EXPIRED' || status === 'CANCELED' || status === 'UPLOADED'
}
