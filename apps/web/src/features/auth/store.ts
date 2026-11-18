import { create } from 'zustand'
import { clearAccessToken, setAccessToken, type TokenScope } from '@/shared/api/tokenStore'
import type { Me, SignupProfile } from './types'

/**
 * 인증 상태.
 *
 * access token 자체는 여기 두지 않는다 — `shared/api/tokenStore`(메모리)가 갖는다.
 * 이 스토어는 "화면이 알아야 하는 상태"만 둔다.
 *
 * 상태 흐름 (명세서 "0. 공통 규칙 — 토큰 종류"):
 *   loading   → 앱이 떴고 refresh 쿠키로 복구를 시도하는 중
 *   anonymous → 비로그인. 체험 실험실은 쓸 수 있다
 *   signup    → 소셜 인증은 됐지만 동의 4종 전. 가입 동의 화면으로 보낸다
 *   member    → 가입 완료. 전체 기능
 *
 * `status`·`me`는 헤더(S15P31B204-273)가 읽는다. 이름과 의미를 바꾸지 않는다.
 */
export type AuthStatus = 'loading' | 'anonymous' | 'signup' | 'member'

interface AuthState {
  status: AuthStatus
  me: Me | null
  /** 가입 동의 화면에 보여 줄 제공자 계정 정보. 가입 토큰과 함께 메모리에만 있다 */
  signupProfile: SignupProfile | null
  /**
   * 회원이 스스로 세션을 끝냈다(로그아웃·탈퇴). 회원 화면(`(app)`)의 가드가 로그인 모달 대신 메인으로 보낸다.
   * AuthGate가 내려갈 때(메인으로 옮긴 뒤) 다시 false가 된다.
   */
  leaving: boolean

  /** 로그인·가입 성공. 토큰을 보관소에 넣고 상태를 올린다 */
  signIn: (accessToken: string, scope: Extract<TokenScope, 'user' | 'signup'>) => void
  /** 신규 사용자(API-AUTH-02 isNewUser). 가입 토큰을 넣고 가입 동의 단계로 */
  startSignup: (signupToken: string, profile: SignupProfile) => void
  /** 휴대폰 업로드 전용 세션(QR 교환). 회원 상태로 올리지 않는다 */
  startCaptureSession: (accessToken: string) => void
  setMe: (me: Me) => void
  /** 복구 실패·로그아웃·탈퇴·가입 포기. `leaving`이면 로그인 모달 없이 메인으로 나간다 */
  signOut: (options?: { leaving?: boolean }) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  me: null,
  signupProfile: null,
  leaving: false,

  signIn: (accessToken, scope) => {
    setAccessToken(accessToken, scope)
    set(
      scope === 'signup'
        ? { status: 'signup', leaving: false }
        : { status: 'member', signupProfile: null, leaving: false },
    )
  },

  startSignup: (signupToken, profile) => {
    setAccessToken(signupToken, 'signup')
    set({ status: 'signup', me: null, signupProfile: profile })
  },

  startCaptureSession: (accessToken) => {
    setAccessToken(accessToken, 'capture')
    set({ status: 'anonymous', me: null })
  },

  setMe: (me) => set({ me }),

  signOut: (options) => {
    clearAccessToken()
    set({ status: 'anonymous', me: null, signupProfile: null, leaving: options?.leaving ?? false })
  },
}))
