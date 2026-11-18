'use client'

import { useRef, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { Button } from '@/shared/ui'
import { adminModelsApi, assetsFresh } from './api'
import { adminErrorMessage } from './errors'
import { fetchGlb, glbFileName, saveBlob } from './glbDownload'
import type { AdminFaceModelAssets } from './types'

export const TEXTURED_LABEL = '텍스처 GLB 다운로드'
export const GRAY_LABEL = '회색 형상 GLB 다운로드'
export const PREPARING = '준비 중…'
export const TEXTURED_FAILED = '텍스처 GLB를 받지 못했어요. 잠시 뒤 다시 시도해 주세요'
export const GRAY_FAILED = '회색 형상 GLB를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요'

type Kind = 'textured' | 'gray'

/**
 * 모델 GLB 내려받기(S15P31B204-720). 텍스처 GLB는 받은 그대로, 회색 형상 GLB는 브라우저에서 재질을 회색으로 바꿔 만든다.
 * 서명 URL이 만료(30초 여유)됐으면 자산을 다시 받아 쓴다. 새로 받은 자산은 `onRefreshed`로 부모 캐시에 넘긴다.
 */
export function ModelDownloads({
  assets,
  onRefreshed,
}: {
  assets: AdminFaceModelAssets
  onRefreshed?: (assets: AdminFaceModelAssets) => void
}) {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 내려받기 중에 다시 받은 자산. 같은 모델일 때만 쓴다 */
  const refreshed = useRef<AdminFaceModelAssets | null>(null)

  async function meshUrl() {
    let current = refreshed.current?.faceModelId === assets.faceModelId ? refreshed.current : assets
    if (!assetsFresh(current)) {
      current = await adminModelsApi.assets(assets.faceModelId)
      refreshed.current = current
      onRefreshed?.(current)
    }
    if (!current.texturedMeshUrl) throw new Error('텍스처 메시 없음')
    return current.texturedMeshUrl
  }

  async function download(kind: Kind) {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      const blob = await fetchGlb(await meshUrl())
      if (kind === 'textured') {
        saveBlob(blob, glbFileName(assets.faceModelId))
      } else {
        const { grayGlb } = await import('./grayGlb')
        const out = await grayGlb(blob)
        saveBlob(
          new Blob([out], { type: 'model/gltf-binary' }),
          glbFileName(assets.faceModelId, true),
        )
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? adminErrorMessage(cause, '모델 파일을')
          : kind === 'textured'
            ? TEXTURED_FAILED
            : GRAY_FAILED,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-(--space-8)" aria-label="GLB 다운로드" role="group">
      <div className="flex flex-wrap items-center gap-(--space-8)">
        <Button
          variant="text"
          layout="inline"
          trailingIcon={null}
          disabled={busy !== null}
          aria-busy={busy === 'textured'}
          onClick={() => void download('textured')}
        >
          {busy === 'textured' ? PREPARING : TEXTURED_LABEL}
        </Button>
        <Button
          variant="text"
          layout="inline"
          trailingIcon={null}
          disabled={busy !== null}
          aria-busy={busy === 'gray'}
          onClick={() => void download('gray')}
        >
          {busy === 'gray' ? PREPARING : GRAY_LABEL}
        </Button>
      </div>
      {error ? (
        <p className="type-kr-body-13-regular-lh16p9 text-status-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
