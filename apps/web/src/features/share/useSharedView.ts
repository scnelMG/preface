'use client'

import { useEffect, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { getSharedView } from './api'
import type { SharedView } from './types'

export type SharedViewState =
  | { state: 'loading' }
  | { state: 'ready'; view: SharedView }
  | { state: 'unavailable' }
  | { state: 'error' }

/**
 * 열어 둔 동안 공유가 끝났는지 확인하는 주기. presigned URL(10분)보다 짧게 둔다.
 * 기기 시계·`urlExpiresAt`로 계산하지 않는다 — 시계가 어긋나면 너무 자주 부르게 된다.
 */
const CHECK_MS = 9 * 60_000
/** 네트워크 오류 뒤 다시 시도 */
const RETRY_MS = 30_000

/**
 * 공유 보기(API-SHR-04)를 불러오고, 열어 둔 동안 주기적으로 공유가 살아 있는지 확인한다. 끝났으면(404) `unavailable`.
 *
 * 처음 받은 응답을 계속 쓴다. 뷰어는 주소가 바뀌면 GLB를 처음부터 다시 받아 화면이 깜빡이고 캐시가 쌓이는데,
 * 이미 받은 3D는 presigned URL이 만료돼도 그대로 보이므로 새 주소가 필요 없다. 스냅숏이라 내용도 바뀌지 않는다.
 * 네트워크 오류는 지금 화면을 유지한 채 다시 시도한다.
 */
export function useSharedView(token: string): SharedViewState {
  const [result, setResult] = useState<SharedViewState>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        const view = await getSharedView(token, controller.signal)
        if (controller.signal.aborted) return
        setResult((prev) => (prev.state === 'ready' ? prev : { state: 'ready', view }))
        timer = setTimeout(load, CHECK_MS)
      } catch (e) {
        if (controller.signal.aborted) return
        if (e instanceof ApiError && e.status === 404) {
          setResult({ state: 'unavailable' })
          return
        }
        setResult((prev) => (prev.state === 'ready' ? prev : { state: 'error' }))
        timer = setTimeout(load, RETRY_MS)
      }
    }
    void load()

    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [token])

  return result
}
