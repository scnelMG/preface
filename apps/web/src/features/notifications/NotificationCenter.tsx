'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button, cx, Icon, toast } from '@/shared/ui'
import { getNotifications, markAllNotificationsRead, markNotificationsRead } from './api'
import {
  getBrowserNotificationEnabled,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  setBrowserNotificationEnabled,
  subscribeBrowserNotificationSettings,
  type BrowserNotificationPermission,
} from './browser'
import { notificationHref } from './links'
import { useNotificationStore } from './store'
import { groupOf, relativeTime, type NotificationGroup } from './time'
import type { AppNotification } from './types'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * 알림 목록 (API-NOTI-01·02, FN-REC-03).
 *
 * Figma `Wireframe v3.2 최종`에는 알림 목록 프레임이 없다. 2026-10-31: 제목 + 안 읽은 수, 보기(전체·안 읽음) + 모두 읽음,
 * 날짜 묶음(오늘·어제·지난 7일·이전), 짧은 시간 표시(time.ts). 머리줄 팝업(NotificationPopover)은 최근 몇 개만 보여 주고 여기로 넘긴다.
 *
 * - 알림을 누르면 읽음 처리하고 결과(작업실 머리 선택) 또는 재촬영 안내(SCR-09)로 간다.
 * - "모두 읽음"은 `{ all: true }` 한 번이다.
 * - 더 보기는 다음 페이지를 붙인다. 그사이 새 알림이 생겨 페이지가 밀려도 같은 알림이 두 번 나오지 않게 ID로 거른다.
 */

export const PAGE_SIZE = 20

type LoadState = 'loading' | 'ready' | 'error'

function mergeById(current: AppNotification[], next: AppNotification[]) {
  const seen = new Set(current.map((n) => n.notificationId))
  return [...current, ...next.filter((n) => !seen.has(n.notificationId))]
}

// 서버 그림과 첫 그림을 맞추려고 서버 값은 'unsupported'로 둔다
const serverPermission = (): BrowserNotificationPermission => 'unsupported'

export function NotificationCenter() {
  const router = useRouter()
  const [items, setItems] = useState<AppNotification[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const unreadCount = useNotificationStore((s) => s.unreadCount)

  useEffect(() => {
    const controller = new AbortController()
    getNotifications({ page: 0, size: PAGE_SIZE }, controller.signal)
      .then((list) => {
        setItems(list.items)
        setTotal(list.totalElements)
        setPage(0)
        setState('ready')
        const store = useNotificationStore.getState()
        store.setUnreadCount(list.unreadCount)
        // 이 화면에서 본 알림은 브라우저 알림으로 다시 알리지 않는다
        if (list.items[0]) store.setLatestSeenId(list.items[0].notificationId)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setState('error')
      })
    return () => controller.abort()
  }, [attempt])

  const retry = () => {
    setState('loading')
    setAttempt((n) => n + 1)
  }

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const list = await getNotifications({ page: page + 1, size: PAGE_SIZE })
      setItems((current) => mergeById(current, list.items))
      setTotal(list.totalElements)
      setPage(list.page)
      useNotificationStore.getState().setUnreadCount(list.unreadCount)
    } catch {
      toast('알림을 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoadingMore(false)
    }
  }

  const markRead = useCallback(async (ids: string[]) => {
    const now = new Date().toISOString()
    setItems((current) =>
      current.map((n) => (ids.includes(n.notificationId) && !n.readAt ? { ...n, readAt: now } : n)),
    )
    try {
      const result = await markNotificationsRead(ids)
      useNotificationStore.getState().setUnreadCount(result.unreadCount)
    } catch {
      // 이동을 막지 않는다. 다음 조회 때 서버 값으로 다시 맞춰진다
    }
  }, [])

  const open = (notification: AppNotification) => {
    if (!notification.readAt) void markRead([notification.notificationId])
    const href = notificationHref(notification)
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

  const unread = items.filter((n) => !n.readAt).length
  const hasUnread = (unreadCount ?? 0) > 0 || unread > 0
  const hasMore = items.length < total
  const shown = filter === 'unread' ? items.filter((n) => !n.readAt) : items
  const now = new Date()
  const groups: { label: NotificationGroup; items: AppNotification[] }[] = []
  for (const notification of shown) {
    const label = groupOf(notification.createdAt, now)
    const last = groups.at(-1)
    if (last?.label === label) last.items.push(notification)
    else groups.push({ label, items: [notification] })
  }

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col px-[5%] pt-(--space-24) pb-(--space-40) md:px-0 md:pt-[56px]">
      {/* 제목 줄: 알림 + 안 읽은 수. 브라우저 알림 스위치는 목록 아래 '알림 설정'에 둔다 */}
      <header>
        <div className="flex flex-col gap-(--space-6)">
          <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.03em] text-ink md:text-[32px]">
            알림
          </h1>
          <p className="type-caption min-h-[1.4em] text-muted-soft">
            {state !== 'ready' ? null : unread > 0 ? (
              <>
                읽지 않은 알림 <span className="pf-mono font-semibold text-accent">{unread}</span>개
              </>
            ) : (
              '모두 확인했어요'
            )}
          </p>
        </div>
      </header>

      <section aria-labelledby="notification-list-title" className="mt-(--space-28)">
        <h2 id="notification-list-title" className="sr-only">
          받은 알림
        </h2>
        {/* 보기 고르기(전체·안 읽음)와 모두 읽음. 지우기는 서버 API가 없어 두지 않는다(알림은 90일 보관) */}
        <div className="flex items-center justify-between gap-(--space-12) border-b border-hairline">
          <div className="pf-tabs" role="group" aria-label="알림 보기">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              전체
            </button>
            <button
              type="button"
              aria-pressed={filter === 'unread'}
              onClick={() => setFilter('unread')}
            >
              안 읽음
              {unread > 0 ? (
                <span className="pf-mono ml-(--space-4) text-accent">{unread}</span>
              ) : null}
            </button>
          </div>
          {state === 'ready' && items.length > 0 ? (
            <button
              type="button"
              disabled={!hasUnread || markingAll}
              onClick={() => void markAll()}
              className="type-label inline-flex min-h-10 items-center gap-(--space-4) rounded-full px-(--space-8) text-ink-2 transition-colors duration-(--pf-dur-ui) hover:text-ink disabled:text-faint"
            >
              <Icon name="Check" size={15} />
              모두 읽음
            </button>
          ) : null}
        </div>

        {state === 'loading' ? (
          <div className="flex justify-center py-(--space-40)" role="status">
            <span className="pf-loader" aria-hidden="true" />
            <span className="sr-only">알림을 불러오는 중이에요</span>
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-center gap-(--space-12) py-(--space-32) text-center">
            <p role="alert" className="type-lead text-ink-2">
              알림을 불러오지 못했어요.
            </p>
            <Button variant="secondary" trailingIcon={null} onClick={retry}>
              다시 시도
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-(--space-8) py-12 text-center">
            <Icon name="CheckCircle" size={24} className="text-faint" />
            <p className="text-[15px] font-medium text-ink">읽지 않은 알림이 없어요</p>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mt-(--space-20)">
              <h3 className="type-label mb-(--space-4) text-muted-soft">{group.label}</h3>
              <ul className="flex flex-col">
                {group.items.map((notification) => (
                  <NotificationRow
                    key={notification.notificationId}
                    notification={notification}
                    onOpen={open}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          ))
        )}

        {state === 'ready' && hasMore ? (
          <Button
            variant="secondary"
            trailingIcon={null}
            className="mt-(--space-20) w-full"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </Button>
        ) : null}
      </section>

      <BrowserNotificationSwitch />
    </div>
  )
}

/**
 * 알림 한 줄(2026-10-31). 왼쪽 동그라미 안 종류 아이콘(실패만 위험 색), 제목(안 읽음은 굵게)과 짧은 시간, 아래 본문.
 * 안 읽은 알림은 시간 옆 보라 점.
 * 머리줄 팝업도 같은 줄을 쓴다(compact: 본문 한 줄).
 */
export function NotificationRow({
  notification,
  onOpen,
  now,
  compact = false,
}: {
  notification: AppNotification
  onOpen: (notification: AppNotification) => void
  now?: Date
  compact?: boolean
}) {
  const unread = !notification.readAt
  const failed = notification.type === 'RECON_FAILED'
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="group -mx-(--space-12) flex w-[calc(100%+24px)] cursor-pointer items-start gap-(--space-12) rounded-(--pf-radius-md) px-(--space-12) py-(--space-12) text-left transition-colors duration-150 hover:bg-ink/[0.035] active:bg-ink/[0.06]"
      >
        <span
          aria-hidden
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-full',
            failed ? 'bg-(--pf-danger)/10 text-(--pf-danger)' : 'bg-ink/[0.05] text-ink-2',
          )}
        >
          <Icon
            name={
              notification.type === 'RECON_SUCCEEDED' ? 'CheckCircle' : failed ? 'Info' : 'Bell'
            }
            size={18}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-(--space-2) pt-px">
          <span className="flex items-baseline justify-between gap-(--space-12)">
            <span
              className={cx(
                'min-w-0 truncate text-[15px] leading-snug tracking-[-0.01em]',
                unread ? 'font-semibold text-ink' : 'font-medium text-ink-2',
              )}
            >
              {unread ? <span className="sr-only">안 읽음, </span> : null}
              {notification.title}
            </span>
            <span className="flex shrink-0 items-center gap-(--space-6)">
              <time
                dateTime={notification.createdAt}
                className="type-caption text-muted-soft tabular-nums"
              >
                {relativeTime(notification.createdAt, now)}
              </time>
              <span
                aria-hidden
                className={cx('size-1.5 rounded-full', unread ? 'bg-accent' : 'bg-transparent')}
              />
            </span>
          </span>
          {notification.body ? (
            <span
              {...PRIVATE_TEXT}
              className={cx(
                'text-[14px] leading-relaxed text-muted-soft',
                compact && 'line-clamp-1',
              )}
            >
              {notification.body}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-(--space-8) py-12 text-center">
      <Icon name="Bell" size={24} className="text-faint" />
      <p className="text-[15px] font-medium text-ink">아직 받은 알림이 없어요</p>
      <p className="type-caption text-muted-soft">
        3D 얼굴이 완성되거나 만들지 못하면 여기에서 알려 드려요.
      </p>
    </div>
  )
}

/**
 * 브라우저 알림 켜기/끄기(2026-10-30, 10-31 목록 아래 '알림 설정' 줄로 옮김). 왼쪽 이름·설명 + 오른쪽 작은 스위치(상자 없음).
 * - 켤 때 아직 묻지 않았으면(default) 그 클릭 안에서 권한을 묻는다(브라우저는 클릭 안에서만 허용한다).
 * - 브라우저에서 막았으면(denied) 켤 수 없고, 아래에 사이트 설정 안내를 작게 둔다.
 * - 지원하지 않는 브라우저면 그리지 않는다(인앱 알림만).
 */
function BrowserNotificationSwitch() {
  const permission = useSyncExternalStore(
    subscribeBrowserNotificationSettings,
    getBrowserNotificationPermission,
    serverPermission,
  )
  const enabled = useSyncExternalStore(
    subscribeBrowserNotificationSettings,
    getBrowserNotificationEnabled,
    () => false,
  )
  const [asking, setAsking] = useState(false)

  if (permission === 'unsupported') return null
  const on = permission === 'granted' && enabled
  const blocked = permission === 'denied'

  const toggle = async () => {
    if (on) {
      setBrowserNotificationEnabled(false)
      toast('브라우저 알림을 껐어요')
      return
    }
    setAsking(true)
    const result = await requestBrowserNotificationPermission()
    setAsking(false)
    setBrowserNotificationEnabled(result === 'granted')
    if (result === 'granted') toast('브라우저 알림을 켰어요')
  }

  return (
    <section
      aria-label="알림 설정"
      className="mt-(--space-40) border-t border-hairline pt-(--space-20)"
    >
      <div className="flex items-center justify-between gap-(--space-16)">
        <div className="flex min-w-0 flex-col gap-(--space-2)">
          <span id="browser-notification-title" className="text-[15px] font-medium text-ink">
            브라우저 알림
          </span>
          <p
            id="browser-notification-note"
            className={cx('type-caption', blocked ? 'text-faint' : 'text-muted-soft')}
          >
            {blocked
              ? '브라우저에서 막혀 있어요. 사이트 설정에서 알림을 허용하면 켤 수 있어요.'
              : '이 사이트가 열려 있으면 다른 탭을 보고 있어도 3D 완성·실패를 컴퓨터 알림으로 알려 드려요.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="browser-notification-title"
          aria-describedby="browser-notification-note"
          disabled={asking || blocked}
          onClick={() => void toggle()}
          className={cx(
            'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-(--pf-dur-ui) ease-(--pf-ease-out) disabled:opacity-40',
            on ? 'bg-accent' : 'bg-ink/15',
          )}
        >
          <span
            aria-hidden
            className={cx(
              'size-5 rounded-full bg-surface shadow-[0_1px_3px_oklch(0.2_0.01_286/0.25)] transition-transform duration-(--pf-dur-ui) ease-(--pf-ease-out)',
              on ? 'translate-x-[18px]' : 'translate-x-[2px]',
            )}
          />
        </button>
      </div>
    </section>
  )
}
