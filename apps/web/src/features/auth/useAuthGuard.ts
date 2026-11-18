'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { SIGNUP_PATH } from './session'
import { type AuthStatus, useAuthStore } from './store'

/**
 * 보호 라우트 가드. 클라이언트에서 판정한다.
 *
 * 서버 가드(Next 16 `proxy.ts`, 예전 middleware)를 쓰지 않는 이유: refresh 쿠키가 `Path=/api/v1/auth`라
 * FE 서버로 오는 페이지 요청에는 실리지 않고, access token은 브라우저 메모리에만 있다.
 * 서버는 로그인 여부를 알 수 없다.
 *
 * - loading: 세션 복구 중. 아직 아무것도 하지 않는다(화면은 `ready`가 false인 동안 내용을 숨긴다)
 * - anonymous: 로그인 모달을 띄운다(`useLoginPrompt.show`, 돌아올 곳 = 지금 경로).
 *   단 스스로 로그아웃·탈퇴한 직후(`leaving`)는 띄우지 않는다
 * - signup: 가입 동의를 마치지 않았다 → 가입 동의 화면(FN-AUTH-01 수용 3)
 * - member: 통과
 */
export function useAuthGuard(): { status: AuthStatus; ready: boolean } {
  const status = useAuthStore((s) => s.status)
  const leaving = useAuthStore((s) => s.leaving)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    // 스스로 로그아웃·탈퇴했으면 로그인 모달을 띄우지 않는다(AuthGate가 메인으로 보낸다)
    if (status === 'anonymous') {
      if (!leaving) requireLogin(pathname)
    } else if (status === 'signup') router.replace(SIGNUP_PATH)
  }, [status, leaving, pathname, router])

  return { status, ready: status === 'member' }
}

/** "로그인이 필요함"을 알린다. 로그인 모달이 이 신호를 보고 뜬다 */
export function requireLogin(returnTo?: string | null): void {
  useLoginPrompt.getState().show(returnTo ? { returnTo } : undefined)
}
