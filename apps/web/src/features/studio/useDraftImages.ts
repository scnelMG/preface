'use client'

import { useEffect, useState, type RefObject } from 'react'
import { viewerWeights } from '@/features/edit/editLogic'
import { getFaceModel, getSimulationState } from './api'

/**
 * 시안 칸이 화면에 들어오면 그 시안의 모습과 원본을 브라우저에서 그려 받는다(draftRender).
 * 그리는 동안 칸은 비워 두고(썸네일과 그림의 구도가 달라 바뀔 때 머리가 튀어 보인다), 준비되면 그 자리에서 나타난다.
 * WebGL이 없거나(테스트·오래된 기기) 받기에 실패했을 때만 원래 모델 썸네일을 쓴다(`failed`).
 *
 * - 메시·코 리그 주소(API-HIS-02)는 머리마다 한 번만 받는다. 시안 값(API-EDIT-03)은 시안마다 한 번.
 * - 그리는 일(three.js)은 처음 필요할 때 따로 불러온다(작업실 첫 화면을 무겁게 하지 않는다).
 */
export interface DraftImages {
  original: string | null
  draft: string | null
  /** 그릴 수 없다(WebGL 없음·받기 실패). 이때만 칸에 원래 모델 썸네일을 쓴다 */
  failed: boolean
}

/** 그림 한 장(원본 칸) */
export interface RenderedImage {
  url: string | null
  failed: boolean
}

/** 메시·코 리그 주소. 리그는 코를 편집한 시안에만 쓴다(-813) */
interface HeadAssets {
  meshUrl: string
  rigUrl: string | null
}

const assets = new Map<string, Promise<HeadAssets>>()
function assetsOf(faceModelId: string) {
  let found = assets.get(faceModelId)
  if (!found) {
    found = getFaceModel(faceModelId).then((detail) => ({
      meshUrl: detail.meshUrl,
      rigUrl: detail.rigUrl ?? null,
    }))
    found.catch(() => assets.delete(faceModelId))
    assets.set(faceModelId, found)
  }
  return found
}

const loadRenderer = () => import('./draftRender')

/** 원본 한 장(모델 줄 맨 앞 칸) */
export function useOriginalImage(
  faceModelId: string,
  ref: RefObject<HTMLElement | null>,
): RenderedImage {
  const visible = useSeen(ref)
  const [result, setResult] = useState<{ id: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!visible || !canRender()) return
    let alive = true
    Promise.all([assetsOf(faceModelId), loadRenderer()])
      .then(([{ meshUrl }, { renderHead }]) => renderHead(faceModelId, meshUrl, {}))
      .then((rendered) => alive && setResult({ id: faceModelId, url: rendered }))
      .catch(() => alive && setResult({ id: faceModelId, url: null }))
    return () => {
      alive = false
    }
  }, [faceModelId, visible])
  const mine = result?.id === faceModelId ? result : null
  return { url: mine?.url ?? null, failed: !canRender() || (mine !== null && mine.url === null) }
}

/** 시안 한 칸: 원본과 시안 모습 두 장(같은 구도) */
export function useDraftImages(
  simulationId: string,
  faceModelId: string,
  /** 바뀌면 다시 그린다(이름만 바꿔도 바뀌지만 같은 가중치면 그린 그림을 다시 쓴다) */
  updatedAt: string,
  ref: RefObject<HTMLElement | null>,
): DraftImages {
  const visible = useSeen(ref)
  const key = `${simulationId}|${updatedAt}`
  const [images, setImages] = useState<{ key: string } & DraftImages>({
    key: '',
    original: null,
    draft: null,
    failed: false,
  })

  useEffect(() => {
    if (!visible || !canRender()) return
    let alive = true
    Promise.all([assetsOf(faceModelId), getSimulationState(simulationId), loadRenderer()])
      .then(async ([{ meshUrl, rigUrl }, { morphState }, { renderHead }]) => {
        const original = await renderHead(faceModelId, meshUrl, {})
        // 슬라이더 값만이 아니라 코 리그·점 조작·눈 편집까지 편집 화면과 같게 그린다(-813)
        const draft = await renderHead(faceModelId, meshUrl, viewerWeights(morphState.weights), {
          rigUrl,
          pointStrokes: morphState.pointStrokes,
          eyeEdit: morphState.eyeEdit,
        })
        if (alive) setImages({ key, original, draft, failed: false })
      })
      .catch(() => alive && setImages({ key, original: null, draft: null, failed: true }))
    return () => {
      alive = false
    }
  }, [faceModelId, key, simulationId, visible])

  if (!canRender()) return { original: null, draft: null, failed: true }
  return images.key === key ? images : { original: null, draft: null, failed: false }
}

/** 한 번 화면에 들어왔는지(들어온 뒤로는 계속 true) */
function useSeen(ref: RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (seen || !element || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setSeen(true)
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, seen])
  return seen
}

let webgl: boolean | null = null
function canRender() {
  if (webgl !== null) return webgl
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    webgl = !!context
    context?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}
