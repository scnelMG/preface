import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from '@/features/auth/AuthGate'
import { useAuthStore } from '@/features/auth/store'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import type { ConsentRecord, Me } from '@/features/auth/types'
import { __resetRefreshState } from '@/shared/api/client'
import { getAccessToken, setAccessToken } from '@/shared/api/tokenStore'
import { AccountPage, CONSENTS_INCOMPLETE, ME_LOAD_FAILED, WITHDRAW_TO_REVOKE } from './AccountPage'

const replace = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/me',
}))

const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/Toast')>()),
  toast: toastMock,
}))

// jsdom에는 <dialog>의 showModal·close가 없다(Modal.test.tsx와 같은 흉내)
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const ME: Me = {
  id: 'u-1',
  nickname: '민서',
  maskedEmail: 'm***@kakao.com',
  providers: ['KAKAO'],
  createdAt: '2026-10-19T03:00:00Z',
  reconsentRequired: [],
  dataSummary: { faceModelCount: 2, simulationCount: 5 },
}

function record(
  consentType: ConsentRecord['consentType'],
  title: string,
  over: Partial<ConsentRecord> = {},
): ConsentRecord {
  return {
    consentType,
    title,
    version: '2026-10-v1',
    effectiveAt: '2026-10-01T00:00:00Z',
    status: 'AGREED',
    agreedAt: '2026-10-19T03:00:00Z',
    withdrawnAt: null,
    isLatestVersion: true,
    ...over,
  }
}

const AGREED = [
  record('TERMS', '서비스 이용약관'),
  record('PRIVACY', '개인정보 수집·이용'),
  record('FACE_DATA', '얼굴 데이터 수집·이용'),
  record('FACE_PUBLIC', '얼굴 공개'),
]
const WITHDRAWN_AT = '2026-10-25T01:00:00Z'
const FACE_WITHDRAWN = AGREED.map((r) =>
  r.consentType.startsWith('FACE')
    ? { ...r, status: 'WITHDRAWN' as const, withdrawnAt: WITHDRAWN_AT }
    : r,
)

// '/users/me'는 '/users/me/consents'에도 들어 있다. routeFetch는 앞에서부터 찾으므로 동의 기록을 먼저 둔다
const consentsRoute = (data: ConsentRecord[]) =>
  ['GET', '/users/me/consents', ok(data)] as [string, string, Response]
const meRoute = (): [string, string, Response] => ['GET', '/users/me', ok(ME)]

beforeEach(() => {
  __resetRefreshState()
  setAccessToken('access-1', 'user')
  useAuthStore.setState({ status: 'member', me: null, signupProfile: null, leaving: false })
  toastMock.mockReset()
  replace.mockReset()
})

async function renderReady() {
  // 실제 화면처럼 (app) 레이아웃의 AuthGate 안에 둔다. 로그아웃·탈퇴 뒤 메인으로 나가는 것은 AuthGate가 한다
  render(
    <AuthGate>
      <AccountPage />
    </AuthGate>,
  )
  await screen.findByText('m***@kakao.com')
  await screen.findByText(/가입 동의 4종/)
}

describe('SCR-12 내 정보', () => {
  it('계정 정보·알림 자리·동의 요약·내 데이터 수를 보여 준다', async () => {
    routeFetch([consentsRoute(AGREED), meRoute()])
    await renderReady()

    expect(screen.getByText('카카오 · 민서')).toBeInTheDocument()
    expect(screen.getByText('2026.10.19', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('동의함 · 2026.10.19 · 버전 2026-10-v1 · 최신')).toBeInTheDocument()
    const data = screen.getByRole('region', { name: '내 데이터' })
    expect(within(data).getByText('2개')).toBeInTheDocument()
    expect(within(data).getByText('5개')).toBeInTheDocument()
    // 알림 설정 API가 없어 바꾸지 못한다
    expect(screen.getByRole('switch', { name: '알림 설정' })).toBeDisabled()
    expect(screen.getByRole('link', { name: /동의 내용·기록 보기/ })).toHaveAttribute(
      'href',
      '/me/consents',
    )
    // 헤더 닉네임도 맞춘다
    expect(useAuthStore.getState().me?.nickname).toBe('민서')
  })

  it('내 정보를 못 불러오면 안내하고 다시 불러온다', async () => {
    const fetch = routeFetch([
      consentsRoute(AGREED),
      ['GET', '/users/me', fail(500, 'COMMON_999')],
      meRoute(),
    ])
    render(<AccountPage />)
    expect(await screen.findByText(ME_LOAD_FAILED)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회원 탈퇴' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByText('m***@kakao.com')).toBeInTheDocument()
    expect(callsTo(fetch, '/users/me').length).toBe(3)
  })

  it('동의 기록이 빠져 있으면 정상 상태로 보지 않는다', async () => {
    routeFetch([consentsRoute(AGREED.slice(0, 3)), meRoute()])
    render(<AccountPage />)
    expect(await screen.findByText(CONSENTS_INCOMPLETE)).toBeInTheDocument()
  })

  it('로그아웃하면 서버에 알리고 이 기기의 세션을 비운 뒤 나간다', async () => {
    const fetch = routeFetch([consentsRoute(AGREED), meRoute(), ['POST', '/auth/logout', ok({})]])
    await renderReady()
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().leaving).toBe(true)
    expect(getAccessToken()).toBeNull()
    expect(callsTo(fetch, '/auth/logout')).toHaveLength(1)
    expect(toastMock).toHaveBeenCalledWith('로그아웃했어요')
    expect(replace).toHaveBeenCalledWith('/')
  })
})

describe('동의 철회 없음(가입 후 개별 철회 없음, 2026-10-26 결정)', () => {
  it('철회 버튼 대신 탈퇴로 거두라는 안내를 둔다', async () => {
    const fetch = routeFetch([consentsRoute(AGREED), meRoute()])
    await renderReady()

    const consent = screen.getByRole('region', { name: '동의' })
    expect(within(consent).getByText(WITHDRAW_TO_REVOKE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /철회/ })).not.toBeInTheDocument()
    // 남은 버튼은 로그아웃·탈퇴뿐이고, 동의 영역에는 기록 보기 링크만 있다
    expect(within(consent).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '회원 탈퇴' })).toBeEnabled()
    expect(callsTo(fetch, '/consents/face')).toHaveLength(0)
  })

  it('이전에 철회한 기록이 있으면 요약에 그대로 보여 준다', async () => {
    routeFetch([consentsRoute(FACE_WITHDRAWN), meRoute()])
    await renderReady()
    expect(screen.getByText(/얼굴 동의 철회함 · 2026.10.25/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /철회/ })).not.toBeInTheDocument()
  })
})

describe('SCR-14 회원 탈퇴', () => {
  it('확인 체크 전에는 탈퇴하기가 꺼져 있고, 탈퇴하면 세션을 정리한다', async () => {
    const fetch = routeFetch([
      consentsRoute(AGREED),
      meRoute(),
      ['DELETE', '/users/me', ok({ deletionStatus: 'PENDING' }, 202)],
    ])
    await renderReady()
    await userEvent.click(screen.getByRole('button', { name: '회원 탈퇴' }))

    const dialog = screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
    const list = within(dialog).getByRole('list', { name: '삭제되는 데이터' })
    expect(within(list).getByText('2개')).toBeInTheDocument()
    expect(within(list).getByText('5개')).toBeInTheDocument()

    const submit = within(dialog).getByRole('button', { name: '탈퇴하기' })
    expect(submit).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: '위 내용을 확인했어요' }))
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().leaving).toBe(true)
    expect(getAccessToken()).toBeNull()
    expect(callsTo(fetch, '/auth/logout')).toHaveLength(0)
    expect(toastMock).toHaveBeenCalledWith('탈퇴했어요. 그동안 이용해 주셔서 고마워요.')
  })

  it('실패하면 회원 상태를 그대로 두고 다시 시도할 수 있다', async () => {
    routeFetch([
      consentsRoute(AGREED),
      meRoute(),
      ['DELETE', '/users/me', fail(500, 'COMMON_999')],
      ['DELETE', '/users/me', ok({ deletionStatus: 'PENDING' }, 202)],
    ])
    await renderReady()
    await userEvent.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    const dialog = screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: '위 내용을 확인했어요' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '탈퇴하기' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.',
    )
    expect(useAuthStore.getState().status).toBe('member')
    expect(getAccessToken()).toBe('access-1')

    await userEvent.click(within(dialog).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
  })

  it('닫았다 다시 열면 확인 체크가 풀려 있다', async () => {
    routeFetch([consentsRoute(AGREED), meRoute()])
    await renderReady()
    await userEvent.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    const dialog = screen.getByRole('dialog', { name: '회원 탈퇴할까요?' })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: '위 내용을 확인했어요' }))
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    await userEvent.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    expect(within(dialog).getByRole('button', { name: '탈퇴하기' })).toBeDisabled()
  })
})
