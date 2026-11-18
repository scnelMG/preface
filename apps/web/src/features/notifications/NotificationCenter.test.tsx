import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { setAccessToken } from '@/shared/api/tokenStore'
import { NotificationCenter } from './NotificationCenter'
import { useNotificationStore } from './store'
import { FakeNotification, installFakeNotification, list, notification } from './testing'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))

const success = notification()
const failure = notification({
  notificationId: 'n-2',
  type: 'RECON_FAILED',
  title: '3D를 만들지 못했어요',
  body: '이유와 고치는 방법을 확인해 주세요.',
  target: { kind: 'RECON_JOB', id: 'job-1' },
  readAt: '2026-10-21T09:00:00Z',
  createdAt: '2026-10-21T08:50:00Z',
})

beforeEach(() => {
  push.mockReset()
  setAccessToken('access', 'user')
  useNotificationStore.getState().reset()
  // 기본은 지원하지 않는 브라우저(권한 영역 없음)
  vi.stubGlobal('Notification', undefined)
})

afterEach(() => vi.unstubAllGlobals())

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as unknown
}

describe('알림 목록', () => {
  it('목록을 최신순 그대로 보여 주고 안 읽은 알림을 표시한다', async () => {
    routeFetch([['GET', '/notifications', ok(list([success, failure]))]])
    render(<NotificationCenter />)
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByRole('button')).toHaveAccessibleName(
      /안 읽음,\s*새 모델이 완성됐어요/,
    )
    expect(within(items[1]).getByRole('button')).not.toHaveAccessibleName(/안 읽음/)
    // 시간은 짧게(time.ts), 정확한 시각은 dateTime에만(마우스 설명은 두지 않는다)
    expect(items[1].querySelector('time')).toHaveAttribute('datetime', '2026-10-21T08:50:00Z')
    expect(useNotificationStore.getState().unreadCount).toBe(1)
  })

  it('알림이 없으면 빈 상태를 보여 주고 모두 읽음 버튼이 없다', async () => {
    routeFetch([['GET', '/notifications', ok(list([]))]])
    render(<NotificationCenter />)
    expect(await screen.findByText('아직 받은 알림이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모두 읽음' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })

  it('불러오지 못하면 다시 시도할 수 있다', async () => {
    routeFetch([
      ['GET', '/notifications', fail(500, 'COMMON_500')],
      ['GET', '/notifications', ok(list([success]))],
    ])
    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
  })

  it('안 읽은 알림을 누르면 읽음 처리하고 작업실 머리 선택으로 간다', async () => {
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([success, failure]))],
      ['POST', '/notifications/read', ok({ unreadCount: 0 })],
    ])
    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: /새 모델이 완성됐어요/ }))
    expect(push).toHaveBeenCalledWith('/studio?faceModelId=fm-1')
    expect(bodyOf(callsTo(fetch, '/notifications/read')[0])).toEqual({ notificationIds: ['n-1'] })
    await waitFor(() => expect(useNotificationStore.getState().unreadCount).toBe(0))
    expect(screen.getByRole('button', { name: /새 모델이 완성됐어요/ })).not.toHaveAccessibleName(
      /안 읽음/,
    )
  })

  it('이미 읽은 실패 알림은 읽음 요청 없이 재촬영 안내로 간다', async () => {
    const fetch = routeFetch([['GET', '/notifications', ok(list([failure]))]])
    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: /3D를 만들지 못했어요/ }))
    expect(push).toHaveBeenCalledWith('/reconstructions/job-1')
    expect(callsTo(fetch, '/notifications/read')).toHaveLength(0)
  })

  it('모두 읽음은 all=true로 보내고 헤더 개수도 0으로 맞춘다', async () => {
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([success, failure]))],
      ['POST', '/notifications/read', ok({ unreadCount: 0 })],
    ])
    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: '모두 읽음' }))
    expect(bodyOf(callsTo(fetch, '/notifications/read')[0])).toEqual({ all: true })
    await waitFor(() => expect(screen.getByRole('button', { name: '모두 읽음' })).toBeDisabled())
    expect(useNotificationStore.getState().unreadCount).toBe(0)
    // 줄마다 붙던 '안 읽음,' 표시가 사라진다(위 보기 탭의 '안 읽음' 글자는 그대로)
    expect(screen.queryByText(/안 읽음,/)).not.toBeInTheDocument()
  })

  it('더 보기는 다음 페이지를 붙이고, 겹친 알림은 한 번만 보여 준다', async () => {
    const third = notification({ notificationId: 'n-3', readAt: '2026-10-20T00:00:00Z' })
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([success, failure], { totalElements: 3 }))],
      [
        'GET',
        '/notifications',
        ok(list([failure, third], { page: 1, totalElements: 3, unreadCount: 1 })),
      ],
    ])
    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    expect(new URL(String(callsTo(fetch, '/notifications')[1][0])).searchParams.get('page')).toBe(
      '1',
    )
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })
})

describe('브라우저 알림 켜기/끄기 (2026-10-30)', () => {
  beforeEach(() => window.localStorage.removeItem('preface.browserNotifications'))

  it('아직 묻지 않았으면 꺼진 스위치이고, 켤 때만 권한을 묻는다', async () => {
    installFakeNotification('default')
    routeFetch([['GET', '/notifications', ok(list([]))]])
    render(<NotificationCenter />)
    const toggle = await screen.findByRole('switch', { name: '브라우저 알림' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    // 서비스 워커 없이 new Notification만 쓴다. 사이트가 열려 있을 때만 온다고 말한다(S15P31B204-747)
    expect(toggle).toHaveAccessibleDescription(
      '이 사이트가 열려 있으면 다른 탭을 보고 있어도 3D 완성·실패를 컴퓨터 알림으로 알려 드려요.',
    )
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    await userEvent.click(toggle)
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('허용돼 있으면 켜진 스위치이고, 끄면 이 기기에서 받지 않는다', async () => {
    installFakeNotification('granted')
    routeFetch([['GET', '/notifications', ok(list([]))]])
    render(<NotificationCenter />)
    const toggle = await screen.findByRole('switch', { name: '브라우저 알림' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(window.localStorage.getItem('preface.browserNotifications')).toBe('off')
  })

  it('브라우저에서 막았으면 켤 수 없고 설정 안내를 보인다', async () => {
    installFakeNotification('denied')
    routeFetch([['GET', '/notifications', ok(list([]))]])
    render(<NotificationCenter />)
    expect(await screen.findByRole('switch', { name: '브라우저 알림' })).toBeDisabled()
    expect(screen.getByText(/사이트 설정에서 알림을 허용하면/)).toBeInTheDocument()
  })
})
