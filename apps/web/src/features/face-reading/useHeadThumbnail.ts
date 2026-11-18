'use client'

import { useEffect, useState } from 'react'
import { listFaceModels } from '@/features/studio/api'

/** 내 모델 목록 한 쪽 크기. 방금 만든 3D는 최신순 맨 앞에 있다 */
const PAGE_SIZE = 20

/**
 * 3D가 완성돼 관상 사진이 지워진 뒤, 사진 자리에 대신 쓸 내 모델 썸네일(-436, presigned GET 10분).
 *
 * - 썸네일은 작업실에 들어갈 때 브라우저가 만든다. 완성 직후 작업실에 아직 안 갔으면 없어서 null — 카드는 글만 보인다.
 * - 썸네일 주소는 목록 API(API-HIS-01)에만 있어, 최신순 첫 쪽에서 그 3D를 찾는다.
 */
export function useHeadThumbnail(faceModelId: string | null, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !faceModelId) return
    const controller = new AbortController()
    listFaceModels({ page: 0, size: PAGE_SIZE }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setUrl(page.items.find((m) => m.faceModelId === faceModelId)?.thumbnailUrl ?? null)
      })
      .catch(() => {
        // 그림은 덤이다. 못 받으면 글만 보인다
      })
    return () => {
      controller.abort()
      setUrl(null)
    }
  }, [faceModelId, enabled])

  return url
}
