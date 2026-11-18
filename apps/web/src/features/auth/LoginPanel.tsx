'use client'

import { useEffect, useState } from 'react'
import { ApiError, NetworkError } from '@/shared/api/ApiError'
import { cx } from '@/shared/ui'
import { SocialLoginButton } from './SocialLoginButton'
import { startSocialLogin } from './session'
import type { ProviderPath } from './types'

/** 메인 문구처럼 짧고 담백하게(2026-10-31) */
export const LOGIN_TITLE = '로그인하고 시작해요'

interface LoginOptionsProps {
  /** 로그인을 마친 뒤 돌아갈 경로 */
  returnTo?: string | null
  /** "먼저 둘러볼게요." 넘기지 않으면 숨긴다 */
  onBrowse?: () => void
  /** 테스트용. 기본은 브라우저 이동 */
  navigate?: (url: string) => void
}

/**
 * P3-09 로그인 내용(설명·소셜 버튼·오류·"로그인 없이 둘러보기"). 모달(LoginModal)과 /login(LoginScreen)이 같이 쓴다.
 * 제목은 부르는 쪽이 그린다(모달 머리말·화면 h1).
 */
export function LoginOptions({
  returnTo,
  onBrowse,
  navigate,
  className,
}: LoginOptionsProps & { className?: string }) {
  const [pending, setPending] = useState<ProviderPath | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 제공자 화면으로 넘어간 뒤 뒤로 오면 잠가 둔 버튼을 푼다.
    // - 다시 보일 때: cacheComponents(Activity)가 상태를 남겨 둔 채 이 효과를 다시 돌린다
    // - bfcache 복원(pageshow persisted): 효과는 다시 돌지 않고 화면만 그대로 돌아온다
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null)
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setPending(null)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  async function start(provider: ProviderPath) {
    setPending(provider)
    setError(null)
    try {
      await startSocialLogin(provider, { returnTo, navigate })
      // 제공자 화면으로 넘어가는 동안 버튼은 계속 잠가 둔다
    } catch (e) {
      setPending(null)
      setError(
        e instanceof ApiError || e instanceof NetworkError
          ? e.message
          : '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.',
      )
    }
  }

  return (
    <div className={cx('flex w-full flex-col items-center', className)}>
      <p className="pf-login-lead w-full text-[14.5px] leading-[1.55] break-keep text-text-paragraph">
        만든 3D 얼굴과 시안을 내 작업실에 모아 둬요.
      </p>

      <div className="mt-(--space-28) flex w-full flex-col gap-(--space-10)">
        <SocialLoginButton
          provider="kakao"
          disabled={pending !== null}
          aria-busy={pending === 'kakao'}
          onClick={() => void start('kakao')}
        />
        <SocialLoginButton
          provider="google"
          disabled={pending !== null}
          aria-busy={pending === 'google'}
          onClick={() => void start('google')}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-(--space-12) w-full type-kr-body-12-regular-lh15p6 text-status-danger"
        >
          {error}
        </p>
      ) : null}

      {onBrowse ? (
        <button
          type="button"
          onClick={onBrowse}
          className="mt-(--space-14) min-h-[44px] cursor-pointer px-(--space-8) text-[13.5px] font-medium text-text-body transition-colors duration-150 hover:text-text-ink"
        >
          로그인 없이 둘러보기
        </button>
      ) : null}
    </div>
  )
}
