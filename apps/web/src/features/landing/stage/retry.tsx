'use client'

import { Component, useEffect, useState, type ReactNode } from 'react'

/**
 * 랜딩·3D 생성 대기 화면의 예시 머리 파일을 못 받았을 때 다시 받는 도구(-784).
 *
 * 머리 GLB는 drei useGLTF가 탭 안에 보관하는데, 실패한 결과도 그대로 보관해 새로고침 전까지 같은 실패를 돌려준다.
 * 그래서 실패하면 보관된 실패를 지우고(onError) 잠시 뒤 다시 그린다. 다 쓰면 무대만 비우고, 다음에 화면에
 * 들어올 때 처음부터 다시 받는다.
 */

/** 다시 받기 전에 기다리는 시간(ms). 다 쓰면 포기한다 */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000]

/** 실패하면 delays만큼 기다렸다 다시 부른다. 끝내 실패하면 마지막 오류로, signal이 끊기면 그 사유로 거절한다 */
export async function withRetry<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  delays: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (signal.aborted || attempt >= delays.length) throw error
      await wait(delays[attempt], signal)
    }
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * 안쪽이 오류를 내면 onError(보관된 실패 지우기)를 부르고, delays만큼 기다렸다 안쪽을 새로 그린다.
 * 다 쓰면 아무것도 그리지 않는다. 화면을 떠나면 기다리던 다시 받기를 취소한다.
 *
 * 기다리기는 오류를 잡은 자리가 아니라 effect에서 건다. 효과가 떼였다 다시 붙어도(개발 모드 StrictMode,
 * 숨겼다 다시 보이는 화면) 타이머가 사라지지 않고 다시 걸린다.
 */
export function RetryBoundary({
  children,
  onError,
  delays = RETRY_DELAYS_MS,
}: {
  children: ReactNode
  onError?: () => void
  delays?: readonly number[]
}) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const delay = failed ? delays[attempt] : undefined

  useEffect(() => {
    if (delay === undefined) return
    const timer = setTimeout(() => {
      setFailed(false)
      setAttempt((n) => n + 1)
    }, delay)
    return () => clearTimeout(timer)
  }, [delay, attempt])

  const handleError = () => {
    onError?.()
    setFailed(true)
  }

  if (failed && attempt >= delays.length) return null
  // 시도마다 key를 바꿔 오류 상태를 버리고 안쪽을 처음부터 다시 그린다
  return (
    <Catch key={attempt} onError={handleError}>
      {children}
    </Catch>
  )
}

class Catch extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
