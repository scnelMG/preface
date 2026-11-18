import { ApiError, NetworkError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'

/**
 * 휴대폰 연결이 끝난 이유. 화면 문구는 이 값으로 고른다.
 * 명세서 8절 "FE 화면 매핑" — 휴대폰 연결 종료 = AUTH_023·QR_001·QR_002.
 */
export type CaptureEndReason =
  /** 주소에 토큰이 없다. 새로고침했거나 주소를 직접 열었다 */
  | 'missing-token'
  /** QR_001 만료·없음·취소 */
  | 'expired'
  /** QR_002 이미 연결·업로드됨(같은 토큰 재교환 포함) */
  | 'already-used'
  /** AUTH_023 연결이 끊김 · 세션 30분이 지남 */
  | 'session-ended'
  /** 휴대폰에서 "내 계정이 아니에요"로 끊었다 */
  | 'disconnected'
  /** 그 밖의 서버 오류 */
  | 'unknown'

/**
 * 업로드 전용 세션이 더는 쓸 수 없다는 뜻의 에러인지.
 * AUTH_002(만료)·AUTH_001(없음·위조)도 포함한다 — capture 세션은 재발급이 없어서
 * 만료되면 끝이다(명세서 "토큰 종류 ③ refresh 없음").
 */
export function isCaptureSessionGone(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ErrorCode.CAPTURE_SCOPE_FORBIDDEN ||
      error.code === ErrorCode.ACCESS_TOKEN_EXPIRED ||
      error.code === ErrorCode.UNAUTHORIZED)
  )
}

/** 토큰 교환(API-QR-02) 실패를 끝난 이유로 바꾼다. 네트워크 오류는 null(다시 시도할 수 있다) */
export function endReasonFromError(error: unknown): CaptureEndReason | null {
  if (error instanceof NetworkError) return null
  if (!(error instanceof ApiError)) return 'unknown'
  if (error.code === ErrorCode.QR_EXPIRED) return 'expired'
  if (error.code === ErrorCode.QR_ALREADY_CONNECTED) return 'already-used'
  if (isCaptureSessionGone(error)) return 'session-ended'
  return 'unknown'
}

export const END_COPY: Record<CaptureEndReason, { title: string; body: string }> = {
  'missing-token': {
    title: 'QR을 다시 스캔해 주세요',
    body: '연결 정보가 없어요. PC 화면의 QR을 휴대폰 카메라로 다시 스캔해 주세요.',
  },
  expired: {
    title: 'QR이 만료됐어요',
    body: 'QR은 3분 동안만 쓸 수 있어요. PC에서 새 QR을 만들어 다시 스캔해 주세요.',
  },
  'already-used': {
    title: '이미 연결된 QR이에요',
    body: '한 번 연결한 QR은 다시 쓸 수 없어요. PC에서 새 QR을 만들어 다시 스캔해 주세요.',
  },
  'session-ended': {
    title: '연결이 끝났어요',
    body: 'PC에서 연결을 끊었거나 연결 시간(30분)이 지났어요. PC에서 새 QR을 만들어 다시 스캔해 주세요.',
  },
  disconnected: {
    title: '연결을 끊었어요',
    body: 'PC에서 본인 계정으로 로그인한 뒤 새 QR을 만들어 다시 스캔해 주세요.',
  },
  unknown: {
    title: '연결하지 못했어요',
    body: '잠시 후 PC에서 새 QR을 만들어 다시 스캔해 주세요.',
  },
}
