import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRefreshState } from '@/shared/api/client'
import { ErrorCode } from '@/shared/api/errorCodes'
import { clearAccessToken, getAccessToken, getScope } from '@/shared/api/tokenStore'
import { saveOAuthStart } from './oauthSession'
import { CONSENT_CHANGED_MESSAGE, SAVE_FAILED_MESSAGE, SignupConsent } from './SignupConsent'
import { useAuthStore } from './store'
import { callsTo, fail, ok, routeFetch } from './testUtils'
import type { ConsentDocument } from './types'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}))

function doc(n: number, consentType: ConsentDocument['consentType'], title: string) {
  return {
    consentDocumentId: `d-${n}`,
    consentType,
    version: '2026-10-v1',
    title,
    contentUrl: `/legal/${n}`,
    required: true,
    summary: null,
    effectiveAt: '2026-10-01T00:00:00Z',
  } satisfies ConsentDocument
}

// 서버 순서가 섞여 와도 화면은 TERMS → PRIVACY → FACE_DATA → FACE_PUBLIC
const DOCS = [
  doc(3, 'FACE_DATA', '얼굴 데이터 수집·이용'),
  doc(1, 'TERMS', '서비스 이용약관'),
  doc(4, 'FACE_PUBLIC', '얼굴 데이터 공개 범위'),
  doc(2, 'PRIVACY', '개인정보 수집·이용'),
]
const SESSION = { accessToken: 'access-1', expiresIn: 1800, user: { id: 'u-1', nickname: '민서' } }

function startAsNewUser() {
  useAuthStore.getState().startSignup('signup-1', {
    provider: 'KAKAO',
    nickname: '민서',
    maskedEmail: 'm***@kakao.com',
  })
}

async function renderReady() {
  render(<SignupConsent />)
  await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' })
}

const submitButton = () => screen.getByRole('button', { name: /가입 완료/ })

beforeEach(() => {
  clearAccessToken()
  __resetRefreshState()
  sessionStorage.clear()
  replace.mockReset()
  useAuthStore.setState({ status: 'loading', me: null, signupProfile: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SignupConsent (SCR-02)', () => {
  it('동의서 4종을 정해진 순서로 보여 주고 계정·고지 문구를 띄운다', async () => {
    startAsNewUser()
    const fetchMock = routeFetch([['GET', '/consent-documents', ok(DOCS)]])

    await renderReady()

    // 읽는 이름은 "[필수] 제목"(보이는 모양은 제목 뒤 작은 "필수" 표시)
    const labels = screen
      .getAllByRole('checkbox')
      .slice(1)
      .map((box) => box.getAttribute('aria-label'))
    expect(labels).toEqual([
      '[필수] 서비스 이용약관',
      '[필수] 개인정보 수집·이용',
      '[필수] 얼굴 데이터 수집·이용',
      '[필수] 얼굴 데이터 공개 범위',
    ])
    expect(screen.getByText('카카오 계정 · 민서 · m***@kakao.com')).toBeInTheDocument()
    // 인물·사진 참조 안내는 가입 화면에 두지 않는다(약관 전문과 AI 실장님 답변에서 알린다)
    expect(screen.queryByRole('note', { name: '현재 AI 상담 처리 안내' })).not.toBeInTheDocument()
    expect(screen.queryByText(/인물·사진 참조 요청/)).not.toBeInTheDocument()
    // 얼굴 데이터 공개 범위: 공유 링크를 만들 때만 쓰인다는 한 줄(머리말은 진하게)
    expect(screen.getByText('쓰임')).toBeInTheDocument()
    expect(screen.getByText('편집한 시안을 공유 링크로 만들 때만 쓰여요')).toBeInTheDocument()
    // FN-AUTH-03 수용 2: 보관 기간·국내 저장·LLM 전송 범위 (summary가 null이라 FE 고정 문구)
    expect(screen.getByText(/30일 뒤/)).toBeInTheDocument()
    expect(screen.getByText(/국내/)).toBeInTheDocument()
    expect(screen.getByText(/AI\(LLM\)로 보내지 않아요/)).toBeInTheDocument()
    // 전문 보기는 새 창 링크
    const link = screen.getByRole('link', { name: '서비스 이용약관 전문 보기 (새 창)' })
    expect(link).toHaveAttribute('href', '/legal/1')
    expect(link).toHaveAttribute('target', '_blank')
    // 가입 토큰을 같이 보낸다
    const [, init] = callsTo(fetchMock, '/consent-documents')[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer signup-1')
  })

  it('네 개 모두 동의해야 가입 완료를 누를 수 있다', async () => {
    startAsNewUser()
    routeFetch([['GET', '/consent-documents', ok(DOCS)]])
    await renderReady()
    const user = userEvent.setup()

    expect(submitButton()).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '[필수] 서비스 이용약관' }))
    await user.click(screen.getByRole('checkbox', { name: '[필수] 개인정보 수집·이용' }))
    await user.click(screen.getByRole('checkbox', { name: '[필수] 얼굴 데이터 수집·이용' }))
    expect(submitButton()).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '전체 동의' })).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: '[필수] 얼굴 데이터 공개 범위' }))
    expect(submitButton()).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: '전체 동의' })).toBeChecked()
  })

  it('새 버전의 인물·사진 참조 안내를 필수 동의서 아래 보여 주고 동의 전 가입을 막는다', async () => {
    startAsNewUser()
    routeFetch([
      [
        'GET',
        '/consent-documents',
        ok(
          DOCS.map((d) =>
            d.consentType === 'TERMS'
              ? {
                  ...d,
                  version: '2026-12-v1',
                  contentUrl: '/legal/terms/2026-12-v1',
                  summary:
                    'AI 상담: 인물·사진 참조 요청은 편집·GMS 전송 없이 거절 / 대화에는 [인물·사진 참조 요청]만 저장',
                }
              : d,
          ),
        ),
      ],
    ])
    await renderReady()

    expect(screen.getByText('대화에는 [인물·사진 참조 요청]만 저장')).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: '현재 AI 상담 처리 안내' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '서비스 이용약관 전문 보기 (새 창)' })).toHaveAttribute(
      'href',
      '/legal/terms/2026-12-v1',
    )
    expect(submitButton()).toBeDisabled()
  })

  it('전체 동의는 모두 켜고 다시 누르면 모두 끈다', async () => {
    startAsNewUser()
    routeFetch([['GET', '/consent-documents', ok(DOCS)]])
    await renderReady()
    const user = userEvent.setup()
    const all = screen.getByRole('checkbox', { name: '전체 동의' })

    await user.click(all)
    expect(screen.getAllByRole('checkbox').every((b) => (b as HTMLInputElement).checked)).toBe(true)
    expect(submitButton()).toBeEnabled()

    await user.click(all)
    expect(screen.getAllByRole('checkbox').some((b) => (b as HTMLInputElement).checked)).toBe(false)
    expect(submitButton()).toBeDisabled()
  })

  it('가입에 성공하면 회원 세션으로 바꾸고 시작한 화면으로 간다', async () => {
    startAsNewUser()
    saveOAuthStart('s', '/studio')
    const fetchMock = routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      ['POST', '/auth/signup', ok(SESSION, 201)],
      ['GET', '/users/me', fail(500, ErrorCode.INTERNAL_ERROR)],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/studio'))
    // 회원이 된 뒤 "이미 회원" 이동이 다시 돌아 메인으로 덮어쓰면 안 된다: 마지막 이동이 시작한 화면이어야 한다
    await waitFor(() => expect(useAuthStore.getState().status).toBe('member'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(replace).toHaveBeenLastCalledWith('/studio')
    expect(replace.mock.calls.every(([to]) => to === '/studio')).toBe(true)
    expect(getAccessToken()).toBe('access-1')
    expect(getScope()).toBe('user')
    expect(useAuthStore.getState().status).toBe('member')

    const [, init] = callsTo(fetchMock, '/auth/signup')[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer signup-1')
    expect(JSON.parse(String(init?.body))).toEqual({
      consents: ['d-1', 'd-2', 'd-3', 'd-4'].map((id) => ({ consentDocumentId: id, agreed: true })),
    })
  })

  it('AUTH_030이면 동의서를 다시 받고 체크를 모두 풀고 안내한다', async () => {
    startAsNewUser()
    const fetchMock = routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      ['POST', '/auth/signup', fail(400, ErrorCode.CONSENT_OUTDATED)],
      ['GET', '/consent-documents', ok(DOCS.map((d) => ({ ...d, version: '2026-10-v2' })))],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    expect(await screen.findByText(CONSENT_CHANGED_MESSAGE)).toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetchMock, '/consent-documents')).toHaveLength(2))
    await waitFor(() =>
      expect(screen.getAllByRole('checkbox').some((b) => (b as HTMLInputElement).checked)).toBe(
        false,
      ),
    )
    expect(submitButton()).toBeDisabled()
    expect(replace).not.toHaveBeenCalled()
  })

  it('AUTH_031이면 서버 문구를 띄운다', async () => {
    startAsNewUser()
    routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      [
        'POST',
        '/auth/signup',
        fail(400, ErrorCode.CONSENT_INCOMPLETE, '필수 항목에 모두 동의해 주세요.'),
      ],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    expect(await screen.findByText('필수 항목에 모두 동의해 주세요.')).toBeInTheDocument()
    expect(useAuthStore.getState().status).toBe('signup')
  })

  it('AUTH_032(가입 시간 지남)면 토큰을 버리고 다시 로그인 안내', async () => {
    startAsNewUser()
    routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      ['POST', '/auth/signup', fail(401, ErrorCode.SIGNUP_TOKEN_INVALID)],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    expect(
      await screen.findByText('가입 시간이 지났어요. 다시 로그인해 주세요.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /다시 로그인/ })).toHaveAttribute('href', '/login')
    expect(getAccessToken()).toBeNull()
  })

  it('만료된 가입 토큰(AUTH_002)은 refresh하지 않고 다시 로그인 안내', async () => {
    startAsNewUser()
    const fetchMock = routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      ['POST', '/auth/signup', fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED)],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    expect(
      await screen.findByText('가입 시간이 지났어요. 다시 로그인해 주세요.'),
    ).toBeInTheDocument()
    expect(callsTo(fetchMock, '/auth/token/refresh')).toHaveLength(0)
  })

  it('COMMON_999면 재시도 안내만 하고 메인으로 가지 않는다', async () => {
    startAsNewUser()
    routeFetch([
      ['GET', '/consent-documents', ok(DOCS)],
      ['POST', '/auth/signup', fail(500, ErrorCode.INTERNAL_ERROR)],
      ['POST', '/auth/signup', ok(SESSION, 201)],
      ['GET', '/users/me', fail(500, ErrorCode.INTERNAL_ERROR)],
    ])
    await renderReady()
    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
    await user.click(submitButton())

    expect(await screen.findByText(SAVE_FAILED_MESSAGE)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: '전체 동의' })).toBeChecked()

    // 다시 누르면 재시도된다
    await user.click(submitButton())
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('동의하지 않고 나가면 API 없이 가입 토큰을 버리고 로그인 화면으로', async () => {
    startAsNewUser()
    const fetchMock = routeFetch([['GET', '/consent-documents', ok(DOCS)]])
    await renderReady()

    await userEvent.click(screen.getByRole('button', { name: '동의하지 않고 나가기' }))

    expect(replace).toHaveBeenCalledWith('/login')
    expect(callsTo(fetchMock, '/auth/signup')).toHaveLength(0)
    expect(getAccessToken()).toBeNull()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('가입 토큰 없이 들어오면(새로고침 등) 다시 로그인 안내', () => {
    useAuthStore.setState({ status: 'anonymous' })
    routeFetch([])

    render(<SignupConsent />)

    expect(screen.getByText('가입 시간이 지났어요. 다시 로그인해 주세요.')).toBeInTheDocument()
  })

  it('이미 회원이면 메인으로 보낸다', () => {
    useAuthStore.setState({ status: 'member' })
    routeFetch([])

    render(<SignupConsent />)

    expect(replace).toHaveBeenCalledWith('/')
  })

  it('동의서를 못 받으면 다시 불러오기를 보여 준다', async () => {
    startAsNewUser()
    routeFetch([
      ['GET', '/consent-documents', fail(500, ErrorCode.INTERNAL_ERROR)],
      ['GET', '/consent-documents', ok(DOCS)],
    ])
    render(<SignupConsent />)

    await userEvent.click(await screen.findByRole('button', { name: /다시 불러오기/ }))

    expect(
      await screen.findByRole('checkbox', { name: '[필수] 서비스 이용약관' }),
    ).toBeInTheDocument()
  })
})
