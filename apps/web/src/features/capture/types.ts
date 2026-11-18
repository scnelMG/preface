/** QR 휴대폰 연결 타입. 원본: API 명세서 v2.9 "3-1. 상세 — QR 휴대폰 연결 (QR)" */

/** API-QR-02 POST /capture-links/exchange 응답 */
export interface CaptureExchangeResult {
  /** 업로드 전용 세션 토큰(scope=capture). refresh 없음 */
  captureSessionToken: string
  /** 초. 명세서 기본 1800(30분) */
  expiresIn: number
  linkId: string
  /** 연결된 계정. 휴대폰에서 "내 계정이 맞는지" 확인하는 데 쓴다 */
  user: {
    nickname: string
    /** 서버가 마스킹해서 내린다 */
    maskedEmail: string | null
  }
}
