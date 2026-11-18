import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { SiteHeader } from '@/features/layout/SiteHeader'
import { setAccessToken } from '@/shared/api/tokenStore'
import { useNotificationStore } from './store'
import {
  FakeNotification,
  installFakeNotification,
  list,
  notification,
  setVisibility,
} from './testing'
import { __resetUnreadPolling, refreshUnread, UNREAD_POLL_MS } from './unread'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/',
}))

const read = notification({ notificationId: 'n-old', readAt: '2026-10-21T09:00:00Z' })
const fresh = notification({
  notificationId: 'n-new',
  type: 'RECON_FAILED',
  title: '3D를 만들지 못했어요',
  body: '이유와 고치는 방법을 확인해 주세요.',
  target: { kind: 'RECON_JOB', id: 'job-9' },
})

beforeEach(() => {
  __resetUnreadPolling()
  push.mockReset()
  setAccessToken('access', 'user')
})

afterEach(() => {
  cleanup()
  __resetUnreadPolling()
  vi.unstubAllGlobals()
  setVisibility('visible')
})

function asMember() {
  useAuthStore.setState({ status: 'member', me: null })
}

/** 회원 헤더를 그리고 첫 조회가 끝날 때까지 기다린다(진행 중인 조회를 그대로 기다린다) */
async function renderMemberHeader() {
  asMember()
  const utils = render(<SiteHeader />)
  await act(() => refreshUnread())
  return utils
}

describe('헤더 안 읽은 알림 표시', () => {
  it('비회원이면 묻지 않고 점도 없다', () => {
    const fetch = routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<SiteHeader />)
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument()
    expect(callsTo(fetch, '/notifications')).toHaveLength(0)
  })

  it('회원이면 size=1로 한 번 묻고, 안 읽은 알림이 있으면 점을 켠다', async () => {
    const fetch = routeFetch([['GET', '/notifications', ok(list([fresh], { unreadCount: 1 }))]])
    await renderMemberHeader()
    expect(await screen.findByRole('button', { name: '알림, 새 알림 있음' })).toBeInTheDocument()
    const calls = callsTo(fetch, '/notifications')
    expect(calls).toHaveLength(1)
    expect(new URL(String(calls[0][0])).searchParams.get('size')).toBe('1')
  })

  it('안 읽은 알림이 없으면 점이 없다', async () => {
    routeFetch([['GET', '/notifications', ok(list([read], { unreadCount: 0 }))]])
    await renderMemberHeader()
    await waitFor(() => expect(useNotificationStore.getState().unreadCount).toBe(0))
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument()
  })

  it('60초 간격으로 다시 묻는다', async () => {
    routeFetch([['GET', '/notifications', ok(list([]))]])
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    await renderMemberHeader()
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), UNREAD_POLL_MS)
  })

  it('로그아웃하면 점을 지운다', async () => {
    routeFetch([['GET', '/notifications', ok(list([fresh], { unreadCount: 1 }))]])
    await renderMemberHeader()
    await screen.findByRole('button', { name: '알림, 새 알림 있음' })
    act(() => useAuthStore.setState({ status: 'anonymous', me: null }))
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument()
    expect(useNotificationStore.getState().unreadCount).toBeNull()
  })

  it('조회가 실패해도 화면은 그대로다', async () => {
    routeFetch([['GET', '/notifications', fail(500, 'COMMON_500')]])
    await renderMemberHeader()
    await act(() => refreshUnread())
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument()
  })
})

describe('새 알림 → 브라우저 알림', () => {
  async function startWith(permission: NotificationPermission) {
    installFakeNotification(permission)
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([read], { unreadCount: 0 }))],
      ['GET', '/notifications', ok(list([fresh], { unreadCount: 1 }))],
    ])
    await renderMemberHeader()
    await waitFor(() => expect(useNotificationStore.getState().latestSeenId).toBe('n-old'))
    setVisibility('hidden')
    await act(() => refreshUnread({ force: true }))
    return fetch
  }

  it('탭이 숨겨져 있고 권한이 있으면 띄우고, 누르면 실패 안내로 간다', async () => {
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    await startWith('granted')
    expect(FakeNotification.instances).toHaveLength(1)
    const shown = FakeNotification.instances[0]
    expect(shown.title).toBe('3D를 만들지 못했어요')
    shown.onclick?.()
    expect(push).toHaveBeenCalledWith('/reconstructions/job-9')
    expect(screen.getByRole('button', { name: '알림, 새 알림 있음' })).toBeInTheDocument()
  })

  it('권한을 거부했으면 브라우저 알림 없이 헤더 점(인앱)만 켠다', async () => {
    await startWith('denied')
    expect(FakeNotification.instances).toHaveLength(0)
    expect(screen.getByRole('button', { name: '알림, 새 알림 있음' })).toBeInTheDocument()
  })

  it('처음 조회에 있던 알림은 다시 알리지 않는다', async () => {
    installFakeNotification('granted')
    setVisibility('hidden')
    routeFetch([['GET', '/notifications', ok(list([fresh], { unreadCount: 1 }))]])
    await renderMemberHeader()
    await screen.findByRole('button', { name: '알림, 새 알림 있음' })
    expect(FakeNotification.instances).toHaveLength(0)
  })
})
