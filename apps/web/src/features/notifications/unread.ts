'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { getNotifications } from './api'
import { showBrowserNotification } from './browser'
import { notificationHref } from './links'
import { useNotificationStore } from './store'

/**
 * 안 읽은 알림 조회 (헤더 점).
 *
 * 언제 묻나:
 * - 헤더가 뜰 때(회원) 한 번, 탭이 다시 보일 때 한 번, 그리고 60초마다.
 * - API-NOTI-01을 `size=1`로 부른다. 필요한 건 `unreadCount`와 가장 최근 1건뿐이다.
 *
 * 왜 60초인가:
 * - 완료 직후의 즉시 안내는 하단 진행 팝업(-196)이 맡는다(REC-03 10초 폴링 + 토스트 + 브라우저 알림).
 *   헤더 점은 "놓친 알림이 있다"는 표시라 1분 늦어도 된다. 탭 1개당 분당 1회, 응답 1건이다.
 * - 숨겨진 탭도 계속 묻는다. 그래야 진행 팝업이 없는 경우(다른 기기에서 시작한 복원 등)에도
 *   탭을 떠나 있는 사용자에게 브라우저 알림을 줄 수 있다(FN-REC-03 수용 7). 브라우저도 숨겨진 탭의
 *   타이머를 1분 단위로 늦추므로 이보다 자주 물을 수 없다.
 * - 너무 잦은 재조회(탭 전환 연타, 헤더 다시 붙음)는 5초 안이면 건너뛴다.
 *
 * 헤더가 둘(Suspense 대기용·실제) 붙었다 떨어져도 조회기는 하나만 돈다(구독 수를 센다).
 */

export const UNREAD_POLL_MS = 60_000
const MIN_GAP_MS = 5_000

type Navigate = (href: string) => void

let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
let lastFetchAt = 0
let inFlight: Promise<void> | null = null
let navigate: Navigate = (href) => window.location.assign(href)

function onVisibility() {
  if (document.visibilityState === 'visible') void refreshUnread()
}

/**
 * 안 읽은 개수를 다시 묻는다. 새 알림이 생겼고 탭이 숨겨져 있고 권한이 있으면 브라우저 알림을 띄운다.
 * 진행 팝업(-196)이 완료를 알게 됐을 때 `refreshUnread({ force: true })`로 헤더 점을 바로 켤 수 있다.
 */
export function refreshUnread({ force = false }: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight
  if (!force && Date.now() - lastFetchAt < MIN_GAP_MS) return Promise.resolve()
  lastFetchAt = Date.now()
  inFlight = (async () => {
    try {
      const list = await getNotifications({ page: 0, size: 1 })
      const store = useNotificationStore.getState()
      store.setUnreadCount(list.unreadCount)

      const newest = list.items[0] ?? null
      const seen = store.latestSeenId
      store.setLatestSeenId(newest?.notificationId ?? null)
      // 첫 조회(seen === undefined)는 기준만 잡는다. 이미 있던 알림을 브라우저 알림으로 다시 띄우지 않는다
      if (seen !== undefined && newest && !newest.readAt && newest.notificationId !== seen) {
        const href = notificationHref(newest)
        showBrowserNotification(newest.title, {
          body: newest.body,
          onClick: href ? () => navigate(href) : undefined,
        })
      }
    } catch {
      // 조회 실패는 조용히 넘긴다. 마지막 값을 유지하고 다음 주기에 다시 묻는다
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** 조회기를 켠다. 돌려받은 함수로 끈다. 여러 번 켜도 하나만 돈다 */
export function startUnreadPolling(onNavigate?: Navigate): () => void {
  if (onNavigate) navigate = onNavigate
  subscribers += 1
  if (subscribers === 1) {
    void refreshUnread()
    timer = setInterval(() => void refreshUnread(), UNREAD_POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    subscribers -= 1
    if (subscribers === 0) {
      if (timer) clearInterval(timer)
      timer = null
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }
}

/**
 * 헤더용. 회원이면 조회기를 켜고 안 읽은 알림이 있는지 돌려준다.
 * 회원이 아니게 되면(로그아웃) 상태를 비운다 — 다음 회원에게 이전 점이 남지 않게.
 */
export function useUnreadNotifications(enabled: boolean): boolean {
  const router = useRouter()
  const unreadCount = useNotificationStore((s) => s.unreadCount)

  useEffect(() => {
    if (!enabled) {
      useNotificationStore.getState().reset()
      lastFetchAt = 0
      return
    }
    return startUnreadPolling((href) => router.push(href))
  }, [enabled, router])

  return enabled && (unreadCount ?? 0) > 0
}

/** 테스트용. 모듈 수준 조회기 상태를 비운다 */
export function __resetUnreadPolling() {
  if (timer) clearInterval(timer)
  timer = null
  subscribers = 0
  lastFetchAt = 0
  inFlight = null
  if (typeof document !== 'undefined')
    document.removeEventListener('visibilitychange', onVisibility)
  useNotificationStore.getState().reset()
}
