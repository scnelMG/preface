'use client'

import { useRouter } from 'next/navigation'
import { Suspense, useEffect, useRef, type ReactNode } from 'react'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { HOME_PATH } from './session'
import { useAuthStore } from './store'
import { useAuthGuard } from './useAuthGuard'

/**
 * `(app)` 보호 라우트를 감싼다. 회원이 아니면 내용을 그리지 않는다.
 * 비로그인이면 가드가 로그인 모달을 띄우고, 로그인하지 않고 모달을 닫으면 메인으로 보낸다.
 * 회원이 스스로 로그아웃·탈퇴했으면(`leaving`) 모달 없이 바로 메인으로 보낸다.
 *
 * useAuthGuard가 usePathname()을 쓰므로 <Suspense> 안에서 부른다(apps/web/AGENTS.md).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Gate>{children}</Gate>
    </Suspense>
  )
}

/** 지금 보이는 AuthGate 수. 숨은 화면(Activity)은 효과를 거두므로 세지 않는다 */
let openGates = 0

/** 지금 회원 화면(`(app)`) 안에 있는가. 로그아웃 뒤 메인으로 나갈지 정할 때 쓴다(useLogout) */
export function hasOpenAuthGate(): boolean {
  return openGates > 0
}

function Gate({ children }: { children: ReactNode }) {
  const { status, ready } = useAuthGuard()
  const promptOpen = useLoginPrompt((s) => s.open)
  const leaving = useAuthStore((s) => s.leaving)
  const router = useRouter()
  const prompted = useRef(false)

  useEffect(() => {
    if (status !== 'anonymous') {
      prompted.current = false
      return
    }
    // 스스로 로그아웃·탈퇴했다 → 로그인 모달 없이 메인으로
    if (leaving) router.replace(HOME_PATH)
    else if (promptOpen) prompted.current = true
    else if (prompted.current) router.replace(HOME_PATH)
  }, [status, leaving, promptOpen, router])

  // 회원 화면을 떠나면(메인으로 옮긴 뒤) 표시를 거둔다. 다음에 비로그인으로 들어오면 다시 로그인 모달을 띄운다
  useEffect(() => {
    openGates += 1
    return () => {
      openGates -= 1
      if (useAuthStore.getState().leaving) useAuthStore.setState({ leaving: false })
    }
  }, [])

  return ready ? children : null
}
