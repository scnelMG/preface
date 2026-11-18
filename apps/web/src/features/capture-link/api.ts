import { api } from '@/shared/api/client'
import type { CaptureLinkState, CreatedCaptureLink } from './types'

/**
 * API-QR-01 QR 연결 토큰 발급(PC).
 * 사용자당 유효 링크는 1개라 새로 만들면 이전 링크는 서버가 EXPIRED로 만든다.
 * 실패: CAP_001(얼굴 동의 없음), REC_002(진행 중 작업 있음)
 */
export function createCaptureLink() {
  return api.post<CreatedCaptureLink>('/capture-links')
}

/** API-QR-03 연결 상태 조회(PC 폴링) */
export function getCaptureLink(linkId: string, signal?: AbortSignal) {
  return api.get<CaptureLinkState>(`/capture-links/${encodeURIComponent(linkId)}`, { signal })
}

/** API-QR-04 연결 끊기. 휴대폰 업로드 전용 세션이 즉시 무효가 된다 */
export function deleteCaptureLink(linkId: string) {
  return api.delete<Record<string, never>>(`/capture-links/${encodeURIComponent(linkId)}`)
}
