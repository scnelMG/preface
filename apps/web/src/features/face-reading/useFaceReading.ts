'use client'

import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { getFaceReading, getFaceReadingByJob, requestFaceReading } from './api'
import type { FaceReading } from './types'

/** 결과를 기다리는 간격. 대기 화면 진행 조회(3초)와 같다 */
export const POLL_MS = 3000

/** 사진이 이미 지워져 만들 수 없음(3D 완성) */
const PHOTO_GONE = 'READ_002'
/** 추출이 아직 안 끝남 */
const PHOTO_NOT_READY = 'READ_001'

export type FaceReadingView =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'done'; reading: FaceReading }
  | { kind: 'failed' }
  /** 사진이 없어(3D 완성 뒤) 더 이상 만들 수 없다 */
  | { kind: 'unavailable' }
  /** 추출이 아직 안 끝나 기다려야 한다 */
  | { kind: 'notReady' }

/**
 * 한 3D 작업의 관상 상태. 들어오면 이미 만든 관상이 있는지 보고(404면 없음), 요청하면 DONE·FAILED가 될 때까지 3초마다 묻는다.
 * 화면을 떠나면(unmount) 폴링을 멈춘다. 서버가 3D 1개당 1건만 만들어서, 다시 요청해도 GMS를 다시 부르지 않는다.
 */
export function useFaceReading(jobId: string, enabled: boolean) {
  const [view, setView] = useState<FaceReadingView>({ kind: 'loading' })
  const [readingId, setReadingId] = useState<string | null>(null)

  const apply = useCallback((reading: FaceReading) => {
    setReadingId(reading.readingId)
    if (reading.status === 'DONE' && reading.result) setView({ kind: 'done', reading })
    else if (reading.status === 'FAILED') setView({ kind: 'failed' })
    else setView({ kind: 'pending' })
  }, [])

  // 처음: 이미 요청한 관상이 있는지
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    getFaceReadingByJob(jobId, controller.signal)
      .then(apply)
      .catch(() => {
        // 404(아직 요청 안 함)든 잠깐의 오류든 버튼을 보여 준다. 다시 요청해도 서버가 있는 것을 돌려준다
        if (!controller.signal.aborted) setView({ kind: 'idle' })
      })
    return () => controller.abort()
  }, [jobId, enabled, apply])

  // PENDING이면 결과가 나올 때까지 묻는다
  useEffect(() => {
    if (view.kind !== 'pending' || !readingId) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      getFaceReading(readingId, controller.signal)
        .then(apply)
        .catch(() => {
          // 잠깐의 네트워크 오류는 다음 차례에 다시 묻는다
          if (!controller.signal.aborted) setView({ kind: 'pending' })
        })
    }, POLL_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [view, readingId, apply])

  const request = useCallback(async () => {
    setView({ kind: 'pending' })
    try {
      apply(await requestFaceReading(jobId))
    } catch (error) {
      if (error instanceof ApiError && error.code === PHOTO_GONE) setView({ kind: 'unavailable' })
      else if (error instanceof ApiError && error.code === PHOTO_NOT_READY)
        setView({ kind: 'notReady' })
      else setView({ kind: 'failed' })
    }
  }, [jobId, apply])

  return { view, request, readingId }
}

export type FaceReadingState = ReturnType<typeof useFaceReading>
