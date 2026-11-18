import { NotificationCenter } from '@/features/notifications/NotificationCenter'

export const metadata = { title: '알림' }

/** 헤더 알림 아이콘 → 알림 목록 (API-NOTI-01·02, FN-REC-03). 회원만 들어온다((app) 레이아웃의 AuthGate) */
export default function NotificationsPage() {
  return <NotificationCenter />
}
