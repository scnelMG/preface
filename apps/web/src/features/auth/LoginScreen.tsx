'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { LOGIN_TITLE, LoginOptions } from './LoginPanel'
import { safeReturnTo } from './oauthSession'
import { HOME_PATH } from './session'
import { useAuthStore } from './store'
import './auth.css'

export const LOGIN_FAILED_MESSAGE = '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.'

/**
 * /login 화면(2026-10-31). 카드 없이 바탕 가운데에 메인과 같은 큰 제목(두 줄이 차례로 올라온다) → 설명 → 버튼.
 * 메인 3D 뒤와 같은 은은한 빛이 제목 뒤로 번진다. 설명·버튼은 0.08초 간격으로 떠오른다(움직임 줄이기면 없음).
 * 모양은 auth.css의 `.pf-login*`, 큰 제목 연출은 service.css의 `.pf-reveal-line`.
 *
 * `?returnTo=/경로`면 로그인 뒤 그리로, `?reason=failed`면 재시도 안내를 띄운다.
 * 제공자 동의 취소(AUTH_014 취지)는 문구 없이 이 화면으로 온다.
 */
export function LoginScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const status = useAuthStore((s) => s.status)
  const returnTo = safeReturnTo(params.get('returnTo'))
  const failed = params.get('reason') === 'failed'

  useEffect(() => {
    if (status === 'member') router.replace(returnTo ?? HOME_PATH)
  }, [status, returnTo, router])

  return (
    <div className="pf-login">
      <span className="pf-login-glow" aria-hidden="true" />
      <section className="pf-login-body" aria-labelledby="login-title">
        {/* 모달 제목(LOGIN_TITLE)과 같은 말을 두 줄로 */}
        <h1 id="login-title" className="type-display pf-login-title" aria-label={LOGIN_TITLE}>
          <span className="pf-reveal-line" aria-hidden="true">
            <span>로그인하고</span>
          </span>
          <span className="pf-reveal-line" aria-hidden="true">
            <span>시작해요.</span>
          </span>
        </h1>
        {failed ? (
          <p role="alert" className="pf-login-alert">
            {LOGIN_FAILED_MESSAGE}
          </p>
        ) : null}
        <LoginOptions
          className="pf-login-options"
          returnTo={returnTo}
          onBrowse={() => router.push(HOME_PATH)}
        />
      </section>
    </div>
  )
}
