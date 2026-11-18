'use client'

import { useEffect, useRef, useState } from 'react'
import { sha256Base64 } from '@/features/upload/fileUtils'
import { putObject } from '@/features/upload/putObject'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import type { ViewerStatus, ViewRequest } from '@/features/viewer/types'
import { getFaceModel, requestThumbnailUpload, saveThumbnail } from '../api'
import { canvasToThumbnail } from '../thumbnailImage'

const FRONT: ViewRequest = { preset: 'front', nonce: 0 }
const NO_WEIGHTS: Readonly<Record<string, number>> = {}

/**
 * 썸네일이 없는 내 모델 하나를 보이지 않는 곳에서 원본(가중치 0) 정면으로 그려 캡처하고 올린다(S15P31B204-436).
 * GPU 워커가 썸네일을 만들지 않아서다. 기본 모델 그림(-437)과 같은 뷰어·카메라·자르기라 칸 모양이 맞다.
 *
 * - 화면 밖 480px 칸에 그린다(display:none이면 WebGL이 그리지 않는다). 메시는 큰 3D와 같은 주소라 캐시를 다시 쓴다.
 * - 한 번만 시도한다. 실패하면 조용히 넘어가고 칸은 아이콘 그대로다(다음 방문 때 다시 시도).
 * - 끝나면(성공·실패) `onDone`. 성공이면 저장된 썸네일 주소를 준다.
 */
export function ThumbnailCapture({
  faceModelId,
  onDone,
}: {
  faceModelId: string
  onDone: (thumbnailUrl: string | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const [meshUrl, setMeshUrl] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getFaceModel(faceModelId, controller.signal)
      .then((detail) => setMeshUrl(detail.meshUrl))
      .catch(() => {
        if (!controller.signal.aborted) onDone(null)
      })
    return () => controller.abort()
  }, [faceModelId, onDone])

  function onStatus(status: ViewerStatus) {
    if (status === 'error') onDone(null)
    if (status !== 'ready' || started.current) return
    started.current = true
    // ready 직후 첫 프레임이 아직 안 그려졌을 수 있어 두 프레임 기다린다
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void capture()
      }),
    )
  }

  async function capture() {
    try {
      const canvas = box.current?.querySelector('canvas')
      const image = canvas ? await canvasToThumbnail(canvas) : null
      if (!image) throw new Error('썸네일을 그리지 못했다')
      const checksumSha256 = await sha256Base64(image)
      const target = await requestThumbnailUpload(faceModelId, {
        sizeBytes: image.size,
        checksumSha256,
      })
      await putObject({ url: target.uploadUrl, headers: target.headers, body: image })
      const saved = await saveThumbnail(faceModelId, {
        objectKey: target.objectKey,
        sizeBytes: image.size,
        checksumSha256,
      })
      onDone(saved.thumbnailUrl)
    } catch (error) {
      console.warn('내 모델 썸네일을 만들지 못했다', error)
      onDone(null)
    }
  }

  return (
    <div
      ref={box}
      aria-hidden="true"
      className="pointer-events-none fixed top-0 -left-[10000px] size-[480px] opacity-0"
    >
      {meshUrl ? (
        <FaceViewer
          meshUrl={meshUrl}
          weights={NO_WEIGHTS}
          layout="single"
          showing="before"
          view={FRONT}
          capturable
          onStatusChange={onStatus}
        />
      ) : null}
    </div>
  )
}
