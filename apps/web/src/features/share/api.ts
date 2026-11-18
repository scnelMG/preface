import { api } from '@/shared/api/client'
import type { ShareCreated, SharedView, ShareSummary } from './types'

/** 시안 공유 API(API-SHR-01~04, S15P31B204-574·575). */

/** API-SHR-01에 함께 보낼 선택 값 */
export interface ShareCreateOptions {
  /** 편집실에서 씌워 둔 웹 헤어(S15P31B204-842). 편집실 헤어는 서버에 저장하지 않아 만들 때 같이 보낸다 */
  hairAssetId?: string | null
  /** 공유한 사람이 직접 적은 이름만 넘긴다(S15P31B204-843) */
  senderName?: string | null
}

/** 값이 하나라도 있을 때만 본문을 보낸다. 둘 다 없으면 본문 없이 부른다 */
export function createShare(
  simulationId: string,
  { hairAssetId, senderName }: ShareCreateOptions = {},
) {
  const path = `/simulations/${encodeURIComponent(simulationId)}/shares`
  const body = {
    ...(hairAssetId ? { hairAssetId } : {}),
    ...(senderName ? { senderName } : {}),
  }
  return Object.keys(body).length > 0
    ? api.post<ShareCreated>(path, body)
    : api.post<ShareCreated>(path)
}

export function listShares(simulationId: string, signal?: AbortSignal) {
  return api.get<ShareSummary[]>(`/simulations/${encodeURIComponent(simulationId)}/shares`, {
    signal,
  })
}

export function revokeShare(shareId: string) {
  return api.delete<void>(`/shares/${encodeURIComponent(shareId)}`)
}

/** 받은 사람 화면. 로그인 토큰을 붙이지 않는다 */
export function getSharedView(token: string, signal?: AbortSignal) {
  return api.get<SharedView>(`/shares/${encodeURIComponent(token)}`, { anonymous: true, signal })
}

export function isOpenShare(share: ShareSummary, now: Date) {
  return share.revokedAt === null && now.getTime() < new Date(share.expiresAt).getTime()
}
