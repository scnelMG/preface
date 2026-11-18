'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { getReconstruction } from './api'
import { isTerminal, type ReconstructionJob } from './types'

/**
 * 3D 복원 진행 상태를 받아 온다.
 *
 * **전송 방식(폴링)을 이 훅 안에 가둔다.** 호출부는 결과만 쓴다.
 * 팀이 SSE(`GET /reconstructions/{jobId}/events`)로 결정하면 이 파일만 고치면 된다
 * — 명세서 4절 "진행 상태 전달: 폴링(이 문서 기본) 또는 SSE — 구현 시 결정".
 *
 * 폴링을 고른 이유는 apps/web/AGENTS.md에 적혀 있다.
 */
export interface ReconstructionProgress {
  job: ReconstructionJob | null
  error: Error | null
  /** 지금 보고 있는 작업의 첫 응답을 아직 못 받았다 */
  isLoading: boolean
}

const DEFAULT_INTERVAL_MS = 3000

/**
 * 결과를 jobId와 함께 들고 있는다.
 * jobId가 바뀌었을 때 effect에서 초기화하지 않고, 읽을 때 "낡은 결과"로 걸러낸다.
 */
interface Tracked {
  jobId: string | null
  job: ReconstructionJob | null
  error: Error | null
}

const EMPTY: Tracked = { jobId: null, job: null, error: null }

export function useReconstructionProgress(
  jobId: string | null,
  options: { intervalMs?: number } = {},
): ReconstructionProgress {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const [tracked, setTracked] = useState<Tracked>(EMPTY)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!jobId) return

    const controller = new AbortController()
    let stopped = false

    const tick = async () => {
      try {
        const next = await getReconstruction(jobId, controller.signal)
        if (stopped) return
        setTracked({ jobId, job: next, error: null })
        // 끝난 작업은 더 묻지 않는다
        if (!isTerminal(next.status)) {
          timerRef.current = setTimeout(tick, intervalMs)
        }
      } catch (cause) {
        if (stopped || controller.signal.aborted) return
        const error = cause instanceof Error ? cause : new Error(String(cause))
        // 일시 실패에도 마지막으로 받은 상태는 그대로 둔다(화면이 깜빡이지 않게)
        setTracked((prev) => ({ jobId, job: prev.jobId === jobId ? prev.job : null, error }))
        // 없음(타인 작업 포함 404)은 다시 물어도 같다. 그 밖에는 한 주기 쉬고 다시 묻는다
        if (cause instanceof ApiError && cause.isNotFound) return
        timerRef.current = setTimeout(tick, intervalMs)
      }
    }

    void tick()

    return () => {
      stopped = true
      controller.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [jobId, intervalMs])

  // 다른 작업의 결과는 버린다
  const isCurrent = tracked.jobId === jobId
  const job = isCurrent ? tracked.job : null
  const error = isCurrent ? tracked.error : null

  return { job, error, isLoading: jobId !== null && job === null && error === null }
}
