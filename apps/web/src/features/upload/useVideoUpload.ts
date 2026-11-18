'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UploadPolicy } from './types'
import {
  UploadFailure,
  uploadVideo,
  type ResumePoint,
  type UploadInput,
  type UploadPhase,
  type UploadResult,
} from './uploadVideo'

export type UploadState =
  | { status: 'idle' }
  | { status: UploadPhase; progress: number }
  | { status: 'done'; result: UploadResult }
  | { status: 'failed'; failure: UploadFailure }

/**
 * 업로드 상태를 화면에 붙인다. 흐름은 uploadVideo에 있다.
 *
 * - start: 처음 올린다
 * - retry: 실패 지점에 맞춰 다시 올린다(해시 재사용, 완료 통지만 다시 등)
 * - cancel: 진행 중인 요청을 끊고 처음 상태로
 */
export function useVideoUpload(policy: UploadPolicy) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)
  const lastInputRef = useRef<UploadInput | null>(null)
  const resumeRef = useRef<ResumePoint | undefined>(undefined)

  const run = useCallback(
    async (input: UploadInput, resume?: ResumePoint) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      lastInputRef.current = input

      try {
        const result = await uploadVideo(input, {
          policy,
          resume,
          signal: controller.signal,
          onPhase: (phase) => setState({ status: phase, progress: 0 }),
          onProgress: (ratio) => setState({ status: 'uploading', progress: ratio }),
        })
        if (controller.signal.aborted) return
        resumeRef.current = undefined
        setState({ status: 'done', result })
        return result
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof UploadFailure) {
          resumeRef.current = error.resume
          setState({ status: 'failed', failure: error })
          return
        }
        throw error
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    },
    [policy],
  )

  const start = useCallback(
    (input: UploadInput) => {
      resumeRef.current = undefined
      return run(input)
    },
    [run],
  )

  const retry = useCallback(() => {
    const input = lastInputRef.current
    if (!input) return Promise.resolve(undefined)
    return run(input, resumeRef.current)
  }, [run])

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState({ status: 'idle' })
  }, [])

  // 화면을 떠나면 진행 중인 업로드를 끊는다
  useEffect(() => () => controllerRef.current?.abort(), [])

  return { state, start, retry, cancel }
}

export function isUploading(state: UploadState) {
  return (
    state.status === 'hashing' ||
    state.status === 'requesting' ||
    state.status === 'uploading' ||
    state.status === 'finalizing'
  )
}
