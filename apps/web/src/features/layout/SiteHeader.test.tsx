import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '@/features/auth/AuthGate'
import { useAuthStore } from '@/features/auth/store'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { list } from '@/features/notifications/testing'
import { __resetUnreadPolling } from '@/features/notifications/unread'
import { __resetRefreshState } from '@/shared/api/client'
import { getAccessToken, setAccessToken } from '@/shared/api/tokenStore'
import { hidesHeaderOnPhone, SiteHeader } from './SiteHeader'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/studio',
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/Toast')>()),
  toast: toastMock,
}))

beforeEach(() => {
  __resetUnreadPolling()
  __resetRefreshState()
  replace.mockReset()
  toastMock.mockReset()
  setAccessToken('access-1', 'user')
  useAuthStore.setState({ status: 'member', me: null, signupProfile: null, leaving: false })
})

afterEach(() => {
  cleanup()
  __resetUnreadPolling()
  vi.unstubAllGlobals()
})

function routes() {
  return routeFetch([
    ['GET', '/notifications', ok(list([], { unreadCount: 0 }))],
    ['POST', '/auth/logout', ok({})],
  ])
}

async function logoutFromHeader() {
  await userEvent.click(await screen.findByRole('button', { name: /계정 메뉴/ }))
  await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))
  await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
}

describe('헤더 프로필 메뉴 로그아웃', () => {
  it('공개 화면에서도 세션을 비우고 메인으로 보낸다(-797). 다음 회원 화면에서 로그인 모달을 띄울 수 있게 leaving은 끈다', async () => {
    const fetch = routes()
    render(<SiteHeader />)
    await logoutFromHeader()

    expect(callsTo(fetch, '/auth/logout')).toHaveLength(1)
    expect(getAccessToken()).toBeNull()
    expect(useAuthStore.getState().leaving).toBe(false)
    expect(toastMock).toHaveBeenCalledWith('로그아웃했어요')
    expect(replace).toHaveBeenCalledWith('/')
    // 헤더는 비로그인 모양으로 바뀐다
    expect(await screen.findAllByRole('button', { name: /로그인/ })).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: /계정 메뉴/ })).not.toBeInTheDocument()
  })

  it('회원 화면(AuthGate 안)에서는 내 정보 화면과 같이 로그인 모달 없이 메인으로 나간다', async () => {
    routes()
    render(
      <>
        <SiteHeader />
        <AuthGate>
          <p>회원 화면 내용</p>
        </AuthGate>
      </>,
    )
    await logoutFromHeader()

    expect(useAuthStore.getState().leaving).toBe(true)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
    expect(screen.queryByText('회원 화면 내용')).not.toBeInTheDocument()
    expect(toastMock).toHaveBeenCalledWith('로그아웃했어요')
  })
})

describe('hidesHeaderOnPhone (-573)', () => {
  it('실험실·체험 실험실은 휴대폰에서 헤더를 숨긴다', () => {
    for (const pathname of ['/lab', '/simulations/sim-1']) {
      expect(hidesHeaderOnPhone(pathname)).toBe(true)
    }
  })

  it('메인·작업실·3D 생성 대기·소개는 헤더를 둔다', () => {
    for (const pathname of [
      '/',
      '/studio',
      '/studio/new',
      '/reconstructions/job-1',
      '/labs',
      '/services',
    ]) {
      expect(hidesHeaderOnPhone(pathname)).toBe(false)
    }
  })
})
