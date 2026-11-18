import { refreshAccessToken } from '@/shared/api/client'
import { getAccessToken } from '@/shared/api/tokenStore'
import { authApi } from './api'
import {
  callbackUri,
  clearReturnTo,
  peekReturnTo,
  saveOAuthStart,
  takeOAuthState,
} from './oauthSession'
import { useAuthStore } from './store'
import type { ProviderPath } from './types'

/** 로그인 화면. 로그인 모달(P3-09)이 레이아웃에 붙기 전까지 쓰는 독립 화면이다 */
export const LOGIN_PATH = '/login'
export const SIGNUP_PATH = '/signup'
export const HOME_PATH = '/'
/** 제공자 오류 등으로 로그인하지 못했을 때. 로그인 화면이 재시도 안내를 띄운다(FN-AUTH-01 예외) */
export const LOGIN_FAILED_PATH = `${LOGIN_PATH}?reason=failed`

/**
 * 소셜 로그인 시작: API-AUTH-01로 인가 URL을 받아 제공자 화면으로 이동한다.
 * `navigate`는 테스트에서 바꿔 끼우려고 받는다.
 */
export async function startSocialLogin(
  provider: ProviderPath,
  options: { returnTo?: string | null; navigate?: (url: string) => void } = {},
): Promise<void> {
  const { authorizeUrl, state } = await authApi.authorizeUrl(provider, callbackUri(provider))
  saveOAuthStart(state, options.returnTo ?? null)
  ;(options.navigate ?? ((url) => window.location.assign(url)))(authorizeUrl)
}

/** 콜백 처리 결과. 화면은 `to`로 이동만 한다 */
export type CallbackOutcome =
  | { kind: 'member'; to: string }
  | { kind: 'signup'; to: string }
  | { kind: 'cancelled'; to: string }
  | { kind: 'failed'; to: string; error: unknown }

/**
 * OAuth 콜백(`/oauth/{provider}?code&state` 또는 `?error`).
 *
 * - `error`: 사용자가 제공자 동의를 취소했거나 제공자가 거절했다(AUTH_014 취지). 서버는 부르지 않고
 *   문구 없이 로그인 화면으로 돌아간다(명세서 v2.8).
 * - `state`가 이 탭에서 시작한 값과 다르면 로그인하지 않는다(다른 사람의 code로 로그인되는 것을 막는다).
 *   서버도 state를 1회용으로 검사한다(AUTH_012).
 * - 기존 회원: 세션(access token + refresh 쿠키) → 돌아갈 곳 또는 메인.
 * - 신규 사용자: 가입 토큰(scope=signup) → 가입 동의(SCR-02).
 */
export async function handleOAuthCallback(
  provider: ProviderPath,
  params: URLSearchParams,
  origin = window.location.origin,
): Promise<CallbackOutcome> {
  const expectedState = takeOAuthState()

  // 콜백 화면에서는 세션 복구를 돌리지 않는다(AuthBootstrap). 로그인이 안 되면 여기서 비로그인으로 정한다
  const cancel = (): CallbackOutcome => {
    useAuthStore.getState().signOut()
    return { kind: 'cancelled', to: LOGIN_PATH }
  }

  if (params.get('error')) return cancel()

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state || state !== expectedState) return cancel()

  try {
    const result = await authApi.login(provider, {
      code,
      state,
      redirectUri: callbackUri(provider, origin),
    })
    const store = useAuthStore.getState()
    if (result.isNewUser) {
      store.startSignup(result.signupToken, result.profile)
      return { kind: 'signup', to: SIGNUP_PATH }
    }
    store.signIn(result.accessToken, 'user')
    void loadMe()
    const to = peekReturnTo() ?? HOME_PATH
    clearReturnTo()
    return { kind: 'member', to }
  } catch (error) {
    useAuthStore.getState().signOut()
    return { kind: 'failed', to: LOGIN_FAILED_PATH, error }
  }
}

/**
 * 앱 시작 때 refresh 쿠키로 세션을 되살린다(API-AUTH-03).
 *
 * access token은 메모리에만 있어 새로고침하면 사라진다. 쿠키는 `Path=/api/v1/auth`라
 * FE 서버(proxy.ts)에서는 보이지 않으므로 브라우저에서 한다.
 * 그 사이 콜백·가입이 먼저 상태를 정했으면(loading이 아니면) 결과를 덮어쓰지 않는다.
 */
export async function restoreSession(): Promise<boolean> {
  // 콜백 화면은 AuthBootstrap이 이 함수를 부르지 않는다. 가입 토큰을 refresh 결과로 덮어쓰지 않게 한 번 더 막는다
  if (useAuthStore.getState().status !== 'loading')
    return useAuthStore.getState().status === 'member'

  const ok = await refreshAccessToken()
  const store = useAuthStore.getState()
  if (store.status !== 'loading') return ok
  if (!ok) {
    store.signOut()
    return false
  }
  const token = getAccessToken()
  if (token) store.signIn(token, 'user')
  void loadMe()
  return true
}

/** 헤더에 닉네임을 띄우려고 내 정보를 받는다. 실패해도 세션은 그대로 둔다 */
export async function loadMe(): Promise<void> {
  try {
    const me = await authApi.me()
    if (useAuthStore.getState().status === 'member') useAuthStore.getState().setMe(me)
  } catch {
    // 내 정보는 다음 화면에서 다시 받는다
  }
}

/**
 * 로그아웃(API-AUTH-04). 서버 요청이 실패해도 이 기기에서는 토큰을 비운다.
 * `leave`: 회원 화면(내 정보 등)에서 눌렀다 → 로그인 모달 없이 메인으로 나간다(AuthGate).
 */
export async function logout(options: { leave?: boolean } = {}): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    // 쿠키는 14일 뒤 만료된다. 화면은 로그아웃 상태로 둔다
  } finally {
    useAuthStore.getState().signOut({ leaving: options.leave })
  }
}

/**
 * 탈퇴(API-AUTH-11) 성공 뒤 이 기기의 세션을 정리한다. 서버가 refresh를 폐기하고 쿠키를 만료시켰으므로
 * 로그아웃 API는 부르지 않는다. 회원 화면이면 AuthGate가 메인으로 보낸다.
 */
export function endSessionAfterWithdrawal(): void {
  useAuthStore.getState().signOut({ leaving: true })
}
