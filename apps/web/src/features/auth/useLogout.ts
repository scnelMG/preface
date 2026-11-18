'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from '@/shared/ui'
import { hasOpenAuthGate } from './AuthGate'
import { HOME_PATH, logout } from './session'

export const LOGGED_OUT_MESSAGE = '로그아웃했어요'

/**
 * 로그아웃 버튼용(API-AUTH-04). 내 정보 화면(SCR-12)과 헤더 프로필 메뉴가 같이 쓴다.
 *
 * 서버 요청이 실패해도 이 기기에서는 로그아웃한다(features/auth/session).
 * 회원 화면(`(app)`, AuthGate 안)에서 눌렀으면 `leaving`으로 나가서 AuthGate가 로그인 모달 없이 메인으로 보낸다.
 * 공개 화면(작업실 등)에서 눌렀어도 메인으로 보낸다(2026-11-13, -797). 회원 모습이던 화면이 그 자리에서
 * 비회원 모습으로 바뀌면 고장 난 것처럼 보인다. 이때 `leaving`은 켜지 않는다 — 거둘 AuthGate가 없어서,
 * 켜 두면 나중에 비로그인으로 회원 화면에 들어갈 때 로그인 모달 대신 메인으로 튕긴다.
 */
export function useLogout() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function run() {
    if (pending) return
    setPending(true)
    try {
      const leave = hasOpenAuthGate()
      await logout({ leave })
      if (!leave) router.replace(HOME_PATH)
      toast(LOGGED_OUT_MESSAGE)
    } finally {
      // 헤더는 화면을 옮겨도 남는다. 다음에 다시 로그인했을 때 버튼이 잠겨 있지 않게 푼다
      setPending(false)
    }
  }

  return { logout: run, pending }
}
