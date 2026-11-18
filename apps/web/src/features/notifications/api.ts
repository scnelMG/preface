import { api } from '@/shared/api/client'
import type { NotificationList, ReadNotificationsResult } from './types'

/** API-NOTI-01 `size`는 1~50 (명세서 v2.8) */
export const NOTIFICATION_PAGE_SIZE_MAX = 50
/** API-NOTI-02 `notificationIds`는 한 번에 100개까지 [가정] (명세서 v2.8) */
export const READ_IDS_MAX = 100

function clampSize(size: number) {
  return Math.min(Math.max(Math.trunc(size), 1), NOTIFICATION_PAGE_SIZE_MAX)
}

/** API-NOTI-01 내 알림 목록·안 읽은 개수. 최신순. 목록을 읽어도 읽음 처리되지 않는다 */
export function getNotifications(
  { page = 0, size = 20 }: { page?: number; size?: number } = {},
  signal?: AbortSignal,
) {
  return api.get<NotificationList>('/notifications', {
    query: { page: Math.max(Math.trunc(page), 0), size: clampSize(size) },
    signal,
  })
}

/**
 * API-NOTI-02 알림 읽음 처리. 100개가 넘으면 나눠 보내고 마지막 응답의 안 읽은 개수를 돌려준다.
 * 타인·없는 ID는 서버가 무시한다.
 */
export async function markNotificationsRead(ids: string[]): Promise<ReadNotificationsResult> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new Error('읽음 처리할 알림이 없다')
  let result: ReadNotificationsResult = { unreadCount: 0 }
  for (let start = 0; start < unique.length; start += READ_IDS_MAX) {
    result = await api.post<ReadNotificationsResult>('/notifications/read', {
      notificationIds: unique.slice(start, start + READ_IDS_MAX),
    })
  }
  return result
}

/** API-NOTI-02 `{ all: true }` 모두 읽음 */
export function markAllNotificationsRead() {
  return api.post<ReadNotificationsResult>('/notifications/read', { all: true })
}
