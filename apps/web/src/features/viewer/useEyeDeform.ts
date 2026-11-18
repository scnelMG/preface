'use client'
import { useLayoutEffect, useRef } from 'react'
import type { EyeReview, EyeState } from '../edit/eyes/state'
import type { EyeDeformResult } from './eyeDeform'
import type { EyeDeformRequest, EyeDeformResponse } from './eyeDeform.worker'
import { applyEyeState, writeEyeResult, type EyeGeometryStatus, type EyeRig } from './eyeRig'

interface Job {
  state: EyeState
  review: EyeReview
}

/**
 * 한 번에 하나만 계산하고, 계산 중에 들어온 값은 마지막 것만 남긴다.
 * 끄는 동안 지나간 값을 모두 차례로 계산하면 놓은 뒤에도 한참 따라오고, 화면도 그만큼 늦었다(-526).
 */
export function createLatestQueue<T>(run: (job: T) => void) {
  let busy = false
  let waiting: { job: T } | null = null
  return {
    push(job: T) {
      if (busy) {
        waiting = { job }
        return
      }
      busy = true
      run(job)
    },
    /** 계산 하나가 끝났을 때. 남은 값이 있으면 바로 보낸다 */
    done() {
      const next = waiting
      waiting = null
      if (!next) {
        busy = false
        return
      }
      run(next.job)
    },
    get busy() {
      return busy
    },
  }
}

/**
 * 눈 상태를 메시에 반영한다. 계산은 워커에서 하고 결과만 화면 스레드에서 그린다.
 * 워커가 없는 환경(테스트)이나 워커가 실패하면 화면 스레드에서 바로 계산한다.
 */
export function useEyeDeform(
  rig: EyeRig | null,
  state: EyeState | undefined,
  review: EyeReview | undefined,
  rigError: string,
  onStatus: ((status: EyeGeometryStatus) => void) | undefined,
  invalidate: () => void,
  onApplied?: (rig: EyeRig, state: EyeState, review: EyeReview) => void,
) {
  const notify = useRef({ onStatus, invalidate, onApplied })
  useLayoutEffect(() => {
    notify.current = { onStatus, invalidate, onApplied }
  }, [onStatus, invalidate, onApplied])
  const queue = useRef<ReturnType<typeof createLatestQueue<Job>> | null>(null)
  const fallback = useRef(false)
  const requested = useRef<Job | null>(null)
  const requestTrial = useRef<
    ((state: EyeState, review: EyeReview) => Promise<EyeDeformResult | null>) | null
  >(null)

  // 아래 요청 effect보다 먼저 선언한 layout effect라 같은 렌더에서 워커가 먼저 준비된다
  useLayoutEffect(() => {
    if (!rig || typeof Worker === 'undefined') return
    fallback.current = false
    const worker = new Worker(new URL('./eyeDeform.worker.ts', import.meta.url), {
      type: 'module',
    })
    let id = 0
    const trials = new Map<number, (result: EyeDeformResult | null) => void>()
    requestTrial.current = (state, review) =>
      new Promise((resolve) => {
        const trialId = ++id
        const timeout = setTimeout(() => {
          trials.delete(trialId)
          resolve(null)
        }, 5000)
        trials.set(trialId, (result) => {
          clearTimeout(timeout)
          resolve(result)
        })
        try {
          worker.postMessage({
            type: 'apply',
            id: trialId,
            state,
            review,
          } satisfies EyeDeformRequest)
        } catch {
          trials.delete(trialId)
          clearTimeout(timeout)
          resolve(null)
        }
      })
    const clearTrials = () => {
      requestTrial.current = null
      for (const finish of trials.values()) finish(null)
      trials.clear()
    }
    let last: Job | null = null
    let lastAppliedId = 0
    const latest = createLatestQueue<Job>((job) => {
      last = job
      worker.postMessage({
        type: 'apply',
        id: (lastAppliedId = ++id),
        state: job.state,
        review: job.review,
      } satisfies EyeDeformRequest)
    })
    worker.onmessage = (event: MessageEvent<EyeDeformResponse>) => {
      const message = event.data
      const finishTrial = trials.get(message.id)
      if (finishTrial) {
        trials.delete(message.id)
        finishTrial(message.type === 'result' ? message : null)
        return
      }
      if (message.id !== lastAppliedId) return
      if (message.type === 'result') {
        notify.current.onStatus?.(writeEyeResult(rig, message))
        if (last) notify.current.onApplied?.(rig, last.state, last.review)
        notify.current.invalidate()
        latest.done()
      } else fallBackToMainThread()
    }
    worker.onerror = (event) => {
      event.preventDefault()
      fallBackToMainThread()
    }
    // 워커가 실패하면 이후는 화면 스레드에서 계산한다(느리지만 기능은 유지)
    function fallBackToMainThread() {
      clearTrials()
      fallback.current = true
      queue.current = null
      worker.terminate()
      const job = requested.current
      if (job) {
        notify.current.onStatus?.(applyEyeState(rig!, job.state, job.review))
        notify.current.onApplied?.(rig!, job.state, job.review)
        notify.current.invalidate()
      }
    }
    worker.postMessage({
      type: 'rig',
      landmarks: rig.landmarks,
      balls: rig.balls,
      skins: rig.skins.map((skin) => ({
        base: skin.base.slice(),
        normals: skin.normals.slice(),
        indices: skin.indices.slice(),
        lid: skin.lid,
      })),
    } satisfies EyeDeformRequest)
    queue.current = latest
    return () => {
      clearTrials()
      if (queue.current === latest) queue.current = null
      worker.terminate()
    }
  }, [rig])

  useLayoutEffect(() => {
    requested.current = state && review ? { state, review } : null
    if (!requested.current || !state || !review) return
    if (!rig) {
      onStatus?.({ ready: false, changed: 0, message: rigError })
      invalidate()
      return
    }
    if (queue.current && !fallback.current) {
      queue.current.push(requested.current)
      return
    }
    onStatus?.(applyEyeState(rig, state, review))
    notify.current.onApplied?.(rig, state, review)
    invalidate()
  }, [state, review, onStatus, rig, rigError, invalidate])
  return requestTrial
}
