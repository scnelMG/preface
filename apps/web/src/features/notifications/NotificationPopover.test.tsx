import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { setAccessToken } from '@/shared/api/tokenStore'
import { NotificationPopover, POPOVER_SIZE } from './NotificationPopover'
import { useNotificationStore } from './store'
import { list, notification } from './testing'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}))

beforeEach(() => {
  push.mockReset()
  setAccessToken('access', 'user')
  useNotificationStore.getState().reset()
})

describe('머리줄 알림 팝업', () => {
  it('최근 알림 몇 개만 묻고, 전체 보기는 목록 화면으로 나눈다', async () => {
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([notification()], { totalElements: 12 }))],
    ])
    const onClose = vi.fn()
    render(<NotificationPopover onClose={onClose} />)
    expect(await screen.findAllByRole('listitem')).toHaveLength(1)
    expect(String(callsTo(fetch, '/notifications')[0][0])).toContain(`size=${POPOVER_SIZE}`)
    const all = screen.getByRole('link', { name: /전체 보기/ })
    expect(all).toHaveAttribute('href', '/notifications')
    await userEvent.click(all)
    expect(onClose).toHaveBeenCalled()
  })

  it('알림을 누르면 읽음 처리하고 팝업을 닫은 뒤 결과로 간다', async () => {
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([notification()]))],
      ['POST', '/notifications/read', ok({ unreadCount: 0 })],
    ])
    const onClose = vi.fn()
    render(<NotificationPopover onClose={onClose} />)
    await userEvent.click(await screen.findByRole('button', { name: /새 모델이 완성됐어요/ }))
    expect(onClose).toHaveBeenCalled()
    expect(push).toHaveBeenCalled()
    await waitFor(() => expect(callsTo(fetch, '/notifications/read')).toHaveLength(1))
    await waitFor(() => expect(useNotificationStore.getState().unreadCount).toBe(0))
  })

  it('알림이 없으면 빈 안내와 전체 보기만 둔다', async () => {
    routeFetch([['GET', '/notifications', ok(list([]))]])
    render(<NotificationPopover onClose={vi.fn()} />)
    expect(await screen.findByText('아직 받은 알림이 없어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '모두 읽음' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /전체 보기/ })).toBeInTheDocument()
  })
})
