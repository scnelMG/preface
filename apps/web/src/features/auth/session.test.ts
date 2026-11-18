import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRefreshState } from '@/shared/api/client'
import { ErrorCode } from '@/shared/api/errorCodes'
import { clearAccessToken, getAccessToken, getScope } from '@/shared/api/tokenStore'
import { peekReturnTo, saveOAuthStart } from './oauthSession'
import {
  handleOAuthCallback,
  LOGIN_FAILED_PATH,
  logout,
  restoreSession,
  startSocialLogin,
} from './session'
import { useAuthStore } from './store'
import { callsTo, fail, ok, routeFetch } from './testUtils'

const ORIGIN = 'http://localhost:3000'
const ME = {
  id: 'u-1',
  nickname: '민서',
  maskedEmail: 'm***@kakao.com',
  providers: ['KAKAO'],
  createdAt: '2026-10-25T00:00:00Z',
  reconsentRequired: [],
  dataSummary: { faceModelCount: 0, simulationCount: 0 },
}

function callback(query: Record<string, string>) {
  return handleOAuthCallback('kakao', new URLSearchParams(query), ORIGIN)
}

beforeEach(() => {
  clearAccessToken()
  __resetRefreshState()
  sessionStorage.clear()
  useAuthStore.setState({ status: 'loading', me: null, signupProfile: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startSocialLogin', () => {
  it('인가 URL을 받아 state를 남기고 제공자 화면으로 보낸다', async () => {
    const fetchMock = routeFetch([
      [
        'GET',
        '/auth/oauth/kakao/authorize-url',
        ok({ authorizeUrl: 'https://kauth.kakao.com/oauth/authorize?state=s-1', state: 's-1' }),
      ],
    ])
    const navigate = vi.fn()

    await startSocialLogin('kakao', { returnTo: '/studio', navigate })

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('redirectUri')).toBe(`${window.location.origin}/oauth/kakao`)
    expect(navigate).toHaveBeenCalledWith('https://kauth.kakao.com/oauth/authorize?state=s-1')
    expect(peekReturnTo()).toBe('/studio')
  })
})

describe('handleOAuthCallback', () => {
  it('error 쿼리면 서버를 부르지 않고 문구 없이 로그인 화면으로 (AUTH_014)', async () => {
    const fetchMock = routeFetch([])
    saveOAuthStart('s-1', null)

    const outcome = await callback({ error: 'access_denied', state: 's-1' })

    expect(outcome).toEqual({ kind: 'cancelled', to: '/login' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('이 탭에서 시작한 state와 다르면 로그인하지 않는다', async () => {
    const fetchMock = routeFetch([])
    saveOAuthStart('s-mine', null)

    const outcome = await callback({ code: 'c-1', state: 's-other' })

    expect(outcome.kind).toBe('cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('신규 사용자면 가입 토큰을 넣고 가입 동의로 보낸다', async () => {
    const fetchMock = routeFetch([
      [
        'POST',
        '/auth/oauth/kakao/login',
        ok({
          isNewUser: true,
          signupToken: 'signup-1',
          signupExpiresIn: 600,
          profile: { provider: 'KAKAO', nickname: '민서', maskedEmail: 'm***@kakao.com' },
        }),
      ],
    ])
    saveOAuthStart('s-1', '/studio')

    const outcome = await callback({ code: 'c-1', state: 's-1' })

    expect(outcome).toEqual({ kind: 'signup', to: '/signup' })
    expect(getAccessToken()).toBe('signup-1')
    expect(getScope()).toBe('signup')
    expect(useAuthStore.getState().status).toBe('signup')
    expect(useAuthStore.getState().signupProfile?.nickname).toBe('민서')
    // 가입을 마친 뒤 돌아갈 곳은 남겨 둔다
    expect(peekReturnTo()).toBe('/studio')

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({ code: 'c-1', state: 's-1', redirectUri: `${ORIGIN}/oauth/kakao` })
  })

  it('기존 회원이면 바로 로그인하고 시작한 화면으로 돌아간다', async () => {
    routeFetch([
      [
        'POST',
        '/auth/oauth/kakao/login',
        ok({
          isNewUser: false,
          accessToken: 'access-1',
          expiresIn: 1800,
          user: { id: 'u-1', nickname: '민서' },
        }),
      ],
      ['GET', '/users/me', ok(ME)],
    ])
    saveOAuthStart('s-1', '/studio')

    const outcome = await callback({ code: 'c-1', state: 's-1' })

    expect(outcome).toEqual({ kind: 'member', to: '/studio' })
    expect(getAccessToken()).toBe('access-1')
    expect(getScope()).toBe('user')
    expect(useAuthStore.getState().status).toBe('member')
    expect(peekReturnTo()).toBeNull()
    await vi.waitFor(() => expect(useAuthStore.getState().me?.nickname).toBe('민서'))
  })

  it('돌아갈 곳이 없으면 메인으로', async () => {
    routeFetch([
      [
        'POST',
        '/auth/oauth/kakao/login',
        ok({
          isNewUser: false,
          accessToken: 'a',
          expiresIn: 1800,
          user: { id: 'u', nickname: 'n' },
        }),
      ],
      ['GET', '/users/me', ok(ME)],
    ])
    saveOAuthStart('s-1', null)

    expect((await callback({ code: 'c', state: 's-1' })).to).toBe('/')
  })

  it('제공자 오류(AUTH_013)면 재시도 안내가 있는 로그인 화면으로', async () => {
    routeFetch([['POST', '/auth/oauth/kakao/login', fail(502, ErrorCode.PROVIDER_ERROR)]])
    saveOAuthStart('s-1', null)

    const outcome = await callback({ code: 'c', state: 's-1' })

    expect(outcome.kind).toBe('failed')
    expect(outcome.to).toBe(LOGIN_FAILED_PATH)
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })
})

describe('restoreSession', () => {
  it('refresh 쿠키가 살아 있으면 회원 상태로 되살리고 내 정보를 받는다', async () => {
    const fetchMock = routeFetch([
      ['POST', '/auth/token/refresh', ok({ accessToken: 'fresh', expiresIn: 1800 })],
      ['GET', '/users/me', ok(ME)],
    ])

    expect(await restoreSession()).toBe(true)

    expect(useAuthStore.getState().status).toBe('member')
    expect(getAccessToken()).toBe('fresh')
    expect(callsTo(fetchMock, '/auth/token/refresh')[0][1]?.credentials).toBe('include')
    await vi.waitFor(() => expect(useAuthStore.getState().me?.id).toBe('u-1'))
  })

  it('refresh가 실패하면(AUTH_003) 비로그인', async () => {
    routeFetch([['POST', '/auth/token/refresh', fail(401, ErrorCode.REFRESH_TOKEN_INVALID)]])

    expect(await restoreSession()).toBe(false)

    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('내 정보 조회가 실패해도 세션은 유지한다', async () => {
    routeFetch([
      ['POST', '/auth/token/refresh', ok({ accessToken: 'fresh', expiresIn: 1800 })],
      ['GET', '/users/me', fail(500, ErrorCode.INTERNAL_ERROR)],
    ])

    await restoreSession()
    await new Promise((r) => setTimeout(r, 0))

    expect(useAuthStore.getState().status).toBe('member')
    expect(useAuthStore.getState().me).toBeNull()
  })

  it('이미 상태가 정해졌으면(가입 동의 중 등) 복구하지 않는다', async () => {
    const fetchMock = routeFetch([])
    useAuthStore.getState().startSignup('signup-1', {
      provider: 'KAKAO',
      nickname: null,
      maskedEmail: null,
    })

    await restoreSession()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(getScope()).toBe('signup')
  })
})

describe('logout', () => {
  it('서버에 로그아웃을 알리고 토큰을 비운다', async () => {
    const fetchMock = routeFetch([['POST', '/auth/logout', ok({})]])
    useAuthStore.getState().signIn('access-1', 'user')

    await logout()

    const [, init] = callsTo(fetchMock, '/auth/logout')[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-1')
    expect(init?.credentials).toBe('include')
    expect(getAccessToken()).toBeNull()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('서버 요청이 실패해도 이 기기에서는 로그아웃된다', async () => {
    routeFetch([['POST', '/auth/logout', fail(500, ErrorCode.INTERNAL_ERROR)]])
    useAuthStore.getState().signIn('access-1', 'user')

    await logout()

    expect(getAccessToken()).toBeNull()
    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})
