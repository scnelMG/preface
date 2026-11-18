'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 전체 화면 체험을 연 기록임을 history.state에 남기는 키 */
export const TRIAL_HISTORY_KEY = 'pfTrial'

/**
 * 휴대폰 메인의 전체 화면 체험(S15P31B204-526).
 *
 * - 열 때 주소는 그대로 두고 history 항목만 하나 쌓는다. 브라우저 뒤로 가기가 체험만 닫고 메인에 남는다.
 *   App Router는 직접 쌓은 항목도 내부 상태를 복사해 두므로(pushState 패치) 메인을 다시 그리지 않는다.
 * - 주소에 흔적(#trial 등)이 없으므로 주소로 바로 체험을 여는 경우는 없다. 새로고침하면 닫힌 메인으로 시작한다.
 * - 열려 있는 동안 뒤 페이지 스크롤을 잠그고, 닫으면 연 순간의 스크롤 위치로 돌려놓는다.
 */
export function useTrialOverlay() {
  const [open, setOpen] = useState(false)
  /** 이 화면에서 쌓은 항목 위에 있는지. 아니면 닫기를 뒤로 가기 대신 그냥 닫는다 */
  const pushed = useRef(false)
  const scrollY = useRef(0)

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const trial = isTrialState(event.state)
      // 앞으로 가기로 다시 열릴 때도 지금 위치로 돌아오게 한다
      if (trial) scrollY.current = window.scrollY
      pushed.current = trial
      setOpen(trial)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previous
      window.scrollTo(0, scrollY.current)
    }
  }, [open])

  const show = useCallback(() => {
    scrollY.current = window.scrollY
    window.history.pushState({ [TRIAL_HISTORY_KEY]: true }, '')
    pushed.current = true
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    if (pushed.current && isTrialState(window.history.state)) {
      // popstate가 닫는다
      window.history.back()
      return
    }
    pushed.current = false
    setOpen(false)
  }, [])

  /** 메인을 떠날 때 쌓은 항목과 상관없이 닫힌 상태로 돌린다(S15P31B204-848) */
  const reset = useCallback(() => {
    pushed.current = false
    setOpen(false)
  }, [])

  return { open, show, close, reset }
}

function isTrialState(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[TRIAL_HISTORY_KEY] === true
  )
}
