'use client'

import { useEffect, useState } from 'react'
import { getMorphParameters } from './api'
import { FALLBACK_CATALOG } from './editLogic'
import type { MorphParameterCatalog } from './types'

/**
 * API-EDIT-01 슬라이더 항목. 시안의 `morphState.schemaVersion`으로 부른다.
 *
 * - `fallback`: 실패하면 명세서 예시 코 3항목을 쓴다(비로그인 체험). 회원 화면은 끄고 오류를 보인다.
 */
export function useMorphParameters(
  schemaVersion: string | null,
  {
    anonymous = false,
    fallback = false,
    fallbackCatalog = FALLBACK_CATALOG,
  }: { anonymous?: boolean; fallback?: boolean; fallbackCatalog?: MorphParameterCatalog } = {},
) {
  const [catalog, setCatalog] = useState<MorphParameterCatalog | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!schemaVersion) return
    const controller = new AbortController()
    getMorphParameters(schemaVersion, { anonymous, signal: controller.signal })
      .then((data) => {
        setCatalog(data)
        setFailed(false)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (fallback) setCatalog(fallbackCatalog)
        setFailed(true)
      })
    return () => controller.abort()
  }, [schemaVersion, anonymous, fallback, fallbackCatalog])

  return { catalog, failed }
}
