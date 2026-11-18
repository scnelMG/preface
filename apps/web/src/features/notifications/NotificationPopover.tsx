'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Icon, toast } from '@/shared/ui'
import { getNotifications, markAllNotificationsRead, markNotificationsRead } from './api'
import { notificationHref } from './links'
import { NotificationRow } from './NotificationCenter'
import { useNotificationStore } from './store'
import type { AppNotification } from './types'

/**
 * 머리줄 알림 팝업(2026-10-31). 종 아이콘을 누르면 최근 알림 몇 개만 보여 주고, 전체 목록은 /notifications로 나눈다.
 *
 * - 머리: 제목 + 안 읽은 수(보라) · 모두 읽음 · 닫기. 아래: 알림 전체 보기.
 * - 목록 화면(NotificationCenter)과 같은 API(API-NOTI-01·02)와 같은 한 줄(NotificationRow, 본문 한 줄)을 쓴다.
 * - 알림을 누르면 읽음 처리하고 그 결과로 가며 팝업을 닫는다. "전체 보기"도 팝업을 닫고 목록 화면으로 간다.
 * - 지우기는 서버 API가 없어 두지 않는다(알림은 90일 보관, API 명세서 NOTI).
 * - 팝업에서 본 알림은 브라우저 알림으로 다시 알리지 않는다(목록 화면과 같은 규칙).
 */

export const POPOVER_SIZE = 5

type LoadState = 'loading' | 'ready' | 'error'

export function NotificationPopover({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [markingAll, setMarkingAll] = useState(false)
  const unreadCount = useNotificationStore((s) => s.unreadCount)

  useEffect(() => {
    const controller = new AbortController()
    getNotifications({ page: 0, size: POPOVER_SIZE }, controller.signal)
      .then((list) => {
        setItems(list.items)
        setState('ready')
        const store = useNotificationStore.getState()
        store.setUnreadCount(list.unreadCount)
        if (list.items[0]) store.setLatestSeenId(list.items[0].notificationId)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState('error')
      })
    return () => controller.abort()
  }, [])

  const open = (notification: AppNotification) => {
    if (!notification.readAt) {
      markNotificationsRead([notification.notificationId])
        .then((result) => useNotificationStore.getState().setUnreadCount(result.unreadCount))
        .catch(() => {
          // 이동을 막지 않는다. 다음 조회 때 서버 값으로 다시 맞춰진다
        })
    }
    const href = notificationHref(notification)
    onClose()
    if (href) router.push(href)
  }

  const markAll = async () => {
    setMarkingAll(true)
    try {
      const result = await markAllNotificationsRead()
      const now = new Date().toISOString()
      setItems((current) => current.map((n) => (n.readAt ? n : { ...n, readAt: now })))
      useNotificationStore.getState().setUnreadCount(result.unreadCount)
    } catch {
      toast('읽음 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setMarkingAll(false)
    }
  }

  const unread = Math.max(unreadCount ?? 0, items.filter((n) => !n.readAt).length)
  const now = new Date()

  return (
    <div className="pf-notice">
      <div className="flex items-center gap-(--space-8) pb-(--space-8)">
        <h2 className="flex flex-1 items-baseline gap-(--space-6) text-[17px] font-semibold tracking-[-0.02em] text-ink">
          알림
          {unread > 0 ? (
            <span className="pf-mono text-[13px] font-semibold text-accent">
              <span className="sr-only">읽지 않은 알림 </span>
              {unread}
            </span>
          ) : null}
        </h2>
        {state === 'ready' && items.length > 0 ? (
          <button
            type="button"
            disabled={unread === 0 || markingAll}
            onClick={() => void markAll()}
            className="type-label inline-flex min-h-8 items-center gap-(--space-4) rounded-full px-(--space-8) text-ink-2 transition-colors duration-(--pf-dur-ui) hover:bg-ink/[0.05] hover:text-ink disabled:bg-transparent disabled:text-faint"
          >
            <Icon name="Check" size={14} />
            모두 읽음
          </button>
        ) : null}
        <button
          type="button"
          aria-label="알림 닫기"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-full text-muted-soft transition-colors duration-(--pf-dur-ui) hover:bg-ink/[0.05] hover:text-ink"
        >
          <Icon name="X" size={16} />
        </button>
      </div>

      <div className="pf-notice-list">
        {state === 'loading' ? (
          <div className="flex justify-center py-(--space-24)" role="status">
            <span className="pf-loader" aria-hidden="true" />
            <span className="sr-only">알림을 불러오는 중이에요</span>
          </div>
        ) : state === 'error' ? (
          <p role="alert" className="py-(--space-20) text-center text-[14px] text-ink-2">
            알림을 불러오지 못했어요.
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-(--space-6) py-(--space-24) text-center">
            <Icon name="Bell" size={22} className="text-faint" />
            <p className="text-[14px] font-medium text-ink">아직 받은 알림이 없어요</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((notification) => (
              <NotificationRow
                key={notification.notificationId}
                notification={notification}
                onOpen={open}
                now={now}
                compact
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-(--space-4) border-t border-hairline pt-(--space-8)">
        <Link
          href="/notifications"
          onClick={onClose}
          className="type-label flex min-h-11 items-center justify-center gap-(--space-4) rounded-(--pf-radius-md) font-semibold text-ink transition-colors duration-(--pf-dur-ui) hover:bg-ink/[0.035]"
        >
          알림 전체 보기
          <Icon name="CaretRight" size={14} />
        </Link>
      </div>
    </div>
  )
}
