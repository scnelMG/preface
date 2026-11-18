'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { type CallbackOutcome, handleOAuthCallback } from './session'
import type { ProviderPath } from './types'

/**
 * 같은 code로 두 번 로그인하지 않게 모듈에 묶어 둔다.
 * 개발 모드 StrictMode는 effect를 두 번 돌리는데, state가 1회용이라 두 번째 요청은 AUTH_012가 된다.
 */
const inFlight = new Map<string, Promise<CallbackOutcome>>()

/** OAuth 콜백 화면. 쿼리를 읽어 처리하고 결과 경로로 바로 넘긴다. `<Suspense>` 안에 둔다 */
export function OAuthCallback({ provider }: { provider: ProviderPath }) {
  const params = useSearchParams()
  const router = useRouter()
  const key = params.toString()

  useEffect(() => {
    let cancelled = false
    let job = inFlight.get(key)
    if (!job) {
      job = handleOAuthCallback(provider, new URLSearchParams(key))
      inFlight.set(key, job)
    }
    void job.then((outcome) => {
      if (!cancelled) router.replace(outcome.to)
    })
    return () => {
      cancelled = true
    }
  }, [key, provider, router])

  return <CallbackStatus />
}

export function CallbackStatus() {
  return (
    <p
      role="status"
      className="py-(--space-40) text-center type-kr-body-13-regular-lh16p9 text-text-body"
    >
      로그인하는 중이에요…
    </p>
  )
}
