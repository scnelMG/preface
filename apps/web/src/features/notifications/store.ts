import { create } from 'zustand'

/**
 * 안 읽은 알림 상태. 헤더 점(SiteHeader)과 알림 목록 화면이 함께 본다.
 * 목록 화면에서 읽음 처리하면 API-NOTI-02 응답의 `unreadCount`를 바로 넣어 헤더 점이 같이 꺼진다.
 */
interface NotificationState {
  /** 아직 한 번도 못 받았으면 null */
  unreadCount: number | null
  /**
   * 가장 최근에 본 알림 ID. 새 알림이 왔는지(브라우저 알림을 띄울지) 가린다.
   * undefined = 아직 기준을 못 잡음(첫 조회 전). 첫 조회는 기준만 잡고 알리지 않는다.
   */
  latestSeenId: string | null | undefined
  setUnreadCount: (unreadCount: number) => void
  setLatestSeenId: (id: string | null) => void
  reset: () => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: null,
  latestSeenId: undefined,
  setUnreadCount: (unreadCount) => set({ unreadCount }),
  setLatestSeenId: (latestSeenId) => set({ latestSeenId }),
  reset: () => set({ unreadCount: null, latestSeenId: undefined }),
}))
