'use client'

import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/features/auth/store'
import { useLoginPrompt } from '@/shared/state/loginPrompt'

/**
 * 회원 전용 화면(작업실·머리 추가 등)으로 가는 버튼용.
 *
 * - 비로그인(anonymous)이면 이동하지 않고 로그인 모달을 연다. 로그인 뒤 `href`로 돌아온다.
 * - 회원이면 바로 이동한다.
 * - 아직 상태를 모르는 중(loading)·가입 동의 중(signup)이면 그냥 이동한다. `(app)` 레이아웃의 AuthGate가 맡는다.
 */
export function useMemberNavigate() {
  const router = useRouter()
  const status = useAuthStore((s) => s.status)
  const showLogin = useLoginPrompt((s) => s.show)

  return (href: string) => {
    if (status === 'anonymous') {
      showLogin({ returnTo: href })
      return
    }
    router.push(href)
  }
}
