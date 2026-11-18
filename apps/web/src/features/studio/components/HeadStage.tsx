'use client'

import { useEffect, useMemo, useState } from 'react'
import { viewerWeights } from '@/features/edit/editLogic'
import type { MorphState } from '@/features/edit/types'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import { type ViewPreset } from '@/features/viewer/viewPresets'
import type { ViewRequest } from '@/features/viewer/types'
import { getFaceModel } from '../api'
import type { HeadOption } from '../heads'

const NO_WEIGHTS: Readonly<Record<string, number>> = {}

/**
 * 고른 모델을 3D로 보여 준다(Figma `selected-head`, DRAG TO EXPLORE).
 * - 내 모델: API-HIS-02로 메시 presigned URL(+ 코 리그)을 받아 불러온다. 마지막 시안이 있으면 그 모습(가중치·점 조작)으로
 *   그린다(-433). 막힌 눈 값은 실험실과 같이 빼고 그린다(`viewerWeights`)
 * - 공개 샘플: 정적 자산 주소, 원본 그대로
 */
export function HeadStage({
  option,
  morphState = null,
  angle = 'front',
}: {
  option: HeadOption
  /** 고른 내 모델의 마지막 시안 상태. 없으면 원본 */
  angle?: ViewPreset
  morphState?: MorphState | null
}) {
  const meshUrl = useMeshUrl(option)
  const weights = useMemo(
    () => (morphState ? viewerWeights(morphState.weights) : NO_WEIGHTS),
    [morphState],
  )

  return (
    <div className="relative size-full">
      {meshUrl.state === 'ready' ? (
        <FaceViewer
          meshUrl={meshUrl.url}
          rigUrl={meshUrl.rigUrl}
          weights={weights}
          pointStrokes={morphState?.pointStrokes}
          layout="single"
          showing={morphState ? 'after' : 'before'}
          view={{ preset: angle, nonce: 0 } satisfies ViewRequest}
          rotationOnly
        />
      ) : meshUrl.state === 'error' ? (
        <p
          role="alert"
          className="type-kr-body-12-regular-lh15p6 absolute inset-0 flex items-center justify-center text-text-body"
        >
          3D 모델 주소를 받지 못했어요. 잠시 후 다시 열어 주세요.
        </p>
      ) : (
        // 주소를 받는 동안도 3D 자리와 같은 가는 고리 하나(회색 네모를 깜빡이지 않는다, 2026-10-30)
        <div className="flex size-full items-center justify-center" aria-busy="true">
          <span className="pf-loader" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}

type MeshUrlState =
  { state: 'loading' } | { state: 'ready'; url: string; rigUrl: string | null } | { state: 'error' }

function useMeshUrl(option: HeadOption): MeshUrlState {
  const faceModelId = option.kind === 'own' ? option.faceModelId : null
  const [own, setOwn] = useState<{ id: string; result: MeshUrlState } | null>(null)

  useEffect(() => {
    if (!faceModelId) return
    const controller = new AbortController()
    getFaceModel(faceModelId, controller.signal)
      .then((detail) =>
        setOwn({
          id: faceModelId,
          result: { state: 'ready', url: detail.meshUrl, rigUrl: detail.rigUrl ?? null },
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setOwn({ id: faceModelId, result: { state: 'error' } })
      })
    return () => controller.abort()
  }, [faceModelId])

  if (option.kind === 'sample') return { state: 'ready', url: option.sample.meshUrl, rigUrl: null }
  return own?.id === faceModelId ? own.result : { state: 'loading' }
}
