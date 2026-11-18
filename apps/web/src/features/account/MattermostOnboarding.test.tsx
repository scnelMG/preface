import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import type { Me } from '@/features/auth/types'
import {
  MM_ONBOARDING,
  MM_ONBOARDING_KEY_PREFIX,
  MattermostOnboarding,
} from './MattermostOnboarding'

const nav = vi.hoisted(() => ({ pathname: '/studio' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }))

const api = vi.hoisted(() => ({
  mattermostRequestCode: vi.fn(),
  mattermostConfirm: vi.fn(),
  mattermostUnlink: vi.fn(),
}))
vi.mock('./api', () => ({ accountApi: api }))

// jsdom에는 <dialog>의 showModal·close가 없다(shared/ui/Modal.test.tsx와 같은 흉내)
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const USER = 'u-onboarding-1'

function member(mattermostUsername: string | null | undefined) {
  const me: Me = {
    id: USER,
    nickname: '합성',
    maskedEmail: null,
    providers: [],
    createdAt: '2026-11-02T00:00:00Z',
    reconsentRequired: [],
    dataSummary: { faceModelCount: 0, simulationCount: 0 },
    ...(mattermostUsername === undefined ? {} : { mattermostUsername }),
  }
  useAuthStore.setState({ status: 'member', me })
}

describe('Mattermost 알림 신청 안내(-544)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    nav.pathname = '/studio'
  })

  it('연결하지 않은 회원에게 알림 신청을 묻고, 동의 고지와 아이디 입력칸을 함께 보여 준다', () => {
    member(null)
    render(<MattermostOnboarding />)

    expect(screen.getByRole('dialog', { name: MM_ONBOARDING.title })).toBeInTheDocument()
    expect(screen.getByText(MM_ONBOARDING.body)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('@Mattermost 아이디')).toBeInTheDocument()
  })

  it('[나중에 할게요]를 누르면 닫고 이 계정에는 다시 띄우지 않는다', async () => {
    member(null)
    const { unmount } = render(<MattermostOnboarding />)

    await userEvent.click(screen.getByRole('button', { name: MM_ONBOARDING.later }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(MM_ONBOARDING_KEY_PREFIX + USER)).toBe('later')
    unmount()
    render(<MattermostOnboarding />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('이미 연결했거나 옛 서버(필드 없음)면 띄우지 않는다', () => {
    member('hong')
    const { unmount } = render(<MattermostOnboarding />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    member(undefined)
    render(<MattermostOnboarding />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('촬영·가입·법적 문서 화면에서는 띄우지 않는다', () => {
    member(null)
    for (const path of ['/m/capture', '/signup', '/legal/terms/2026-10-v1', '/s/abc_DEF-123']) {
      nav.pathname = path
      const { unmount } = render(<MattermostOnboarding />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('비회원에게는 띄우지 않는다', () => {
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<MattermostOnboarding />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
