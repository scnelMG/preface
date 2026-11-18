import type { Page } from '@/shared/api/types'

/**
 * 알림 (API 명세서 v3.1 "4-1. 상세 — 알림 (NOTI)").
 * BE 구현: services/backend/api/.../notification/dto/NotificationResponse.java
 */

/** 1차는 복원 성공·실패 두 가지다. 서버가 새 종류를 보내도 화면이 깨지지 않게 string도 받는다 */
export type NotificationType = 'RECON_SUCCEEDED' | 'RECON_FAILED' | (string & {})

/** 알림을 누르면 갈 대상. FACE_MODEL = 내 모델(성공), RECON_JOB = 복원 작업(실패) */
export type NotificationTargetKind = 'FACE_MODEL' | 'RECON_JOB' | (string & {})

export interface NotificationTarget {
  kind: NotificationTargetKind
  id: string
}

export interface AppNotification {
  notificationId: string
  type: NotificationType
  /** 서버 고정 문구. 그대로 보여 준다 */
  title: string
  body: string
  target: NotificationTarget | null
  /** 안 읽었으면 null */
  readAt: string | null
  createdAt: string
}

/** API-NOTI-01 응답. 공통 페이지 형식 + 안 읽은 개수(헤더 점 표시) */
export interface NotificationList extends Page<AppNotification> {
  unreadCount: number
}

/** API-NOTI-02 응답 */
export interface ReadNotificationsResult {
  unreadCount: number
}
