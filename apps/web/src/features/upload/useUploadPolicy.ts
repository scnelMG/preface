'use client'

import { useEffect, useState } from 'react'
import { getUploadPolicy } from './api'
import { DEFAULT_UPLOAD_POLICY } from './policy'
import type { UploadPolicy } from './types'

/**
 * 업로드 정책(API-CAP-02). 받기 전과 실패했을 때는 FE 기본값을 쓴다(명세서 CAP-02 비고).
 * 최종 검사는 서버(CAP-01)가 하므로 정책 조회 실패로 화면을 막지 않는다.
 */
export function useUploadPolicy(enabled = true): UploadPolicy {
  const [policy, setPolicy] = useState<UploadPolicy>(DEFAULT_UPLOAD_POLICY)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    getUploadPolicy(controller.signal)
      .then((received) => {
        if (received?.video) setPolicy(received)
      })
      .catch(() => {
        // 기본값 유지
      })
    return () => controller.abort()
  }, [enabled])

  return policy
}
