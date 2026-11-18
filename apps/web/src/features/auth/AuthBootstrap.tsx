'use client'

import { useEffect } from 'react'
import { restoreSession } from './session'

/**
 * 앱이 뜰 때 refresh 쿠키로 세션을 되살린다(API-AUTH-03). 화면에는 아무것도 그리지 않는다.
 * 루트 layout에 한 번 둔다.
 *
 * OAuth 콜백 화면에서는 돌리지 않는다 — 콜백이 받은 가입 토큰을 refresh 결과가 덮어쓰지 않게.
 * 휴대폰 촬영 화면(`/m/capture`)도 돌리지 않는다 — 같은 기기에 로그인 쿠키가 있으면 refresh 응답이
 * 업로드 전용 세션 토큰(scope=capture)을 덮어쓸 수 있다(S15P31B204-457). 이 화면은 그 토큰만 쓴다.
 */
export function AuthBootstrap() {
  useEffect(() => {
    const { pathname } = window.location
    if (pathname.startsWith('/oauth/') || pathname.startsWith('/m/capture')) return
    void restoreSession()
  }, [])
  return null
}
