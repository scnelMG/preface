'use client'
import { useGLTF } from '@react-three/drei'
import { useEffect } from 'react'
import type { Object3D } from 'three'
import {
  HAIR_ASSETS,
  HAIR_PREFETCH_HEAVY,
  HAIR_PREFETCH_ORDER,
  type HairAsset,
} from '@/features/edit/hair/catalog'
import { cancelHairPrefits, fitHairFor, loadTemplateSkin } from './hairFitClient'

/**
 * 헤어 미리 받기·맞추기(S15P31B204-861). 편집(SimulationLab·게스트 /lab)과 홈 체험에서 헤어를 처음 고를 때 레이어드컷은
 * 받기 수 초에 맞춤 2~4초가 더 걸렸다. 머리 모델이 뜬 뒤 브라우저가 한가할 때(requestIdleCallback, 없으면 잠깐 뒤) 가벼운
 * 헤어부터 받고(drei useGLTF 캐시: HairLayer가 같은 것을 쓴다) 그 머리에 맞춰 둔다(Worker, hairFitClient 남긴 사본).
 *
 * - 머리 모델과 첫 화면을 늦추지 않는다: 이 훅은 머리가 뜬 뒤에 돌고, 단계마다 한가할 때를 기다린다.
 * - 레이어드컷(55MB)은 데이터 절약·2g/3g·작은 터치 화면(모바일)에서는 미리 받지 않는다(헤어 탭에서 고를 때 받는다).
 * - 뷰어가 닫히면 기다리던 단계와 아직 시작하지 않은 미리 맞추기를 그만둔다. 받는 중인 파일은 캐시에 남는다.
 */
export function useHairPrefetch(head: Object3D, hairline: unknown, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const owner = {}
    let cancelled = false
    let cancelIdle: (() => void) | null = null
    const idle = () =>
      new Promise<void>((resolve) => {
        cancelIdle = whenIdle(resolve)
      })
    const run = async () => {
      await idle()
      if (cancelled) return
      const templateSkin = await loadTemplateSkin()
      for (const asset of hairPrefetchList(heavyHairPrefetchAllowed())) {
        await idle()
        if (cancelled) return
        let scene: Object3D
        try {
          scene = (await loadHairGltf(asset.url)).scene
        } catch {
          continue // 못 받은 헤어는 고를 때 다시 받는다
        }
        if (cancelled) return
        try {
          await fitHairFor({ head, hairline, url: asset.url, scene, templateSkin, owner })
        } catch {
          // 그만뒀거나 실패했으면 고를 때 다시 맞춘다
        }
      }
    }
    void run()
    return () => {
      cancelled = true
      cancelIdle?.()
      cancelHairPrefits(owner)
    }
  }, [head, hairline, enabled])
}

/** 미리 받을 헤어(가벼운 것부터). `heavy`가 false면 무거운 헤어를 뺀다 */
export function hairPrefetchList(heavy: boolean): HairAsset[] {
  return HAIR_PREFETCH_ORDER.filter((id) => heavy || !HAIR_PREFETCH_HEAVY.has(id))
    .map((id) => HAIR_ASSETS.find((asset) => asset.id === id))
    .filter((asset): asset is HairAsset => Boolean(asset))
}

interface NetworkInformationLike {
  saveData?: boolean
  effectiveType?: string
}

/** 무거운 헤어(레이어드컷)를 미리 받아도 되는지. 데이터 절약, 2g·3g, 작은 터치 화면(모바일)이면 아니다 */
export function heavyHairPrefetchAllowed(
  nav: { connection?: NetworkInformationLike } | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as { connection?: NetworkInformationLike }),
  matches: (query: string) => boolean = (query) =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
): boolean {
  const connection = nav?.connection
  if (connection?.saveData) return false
  if (/(^|-)(2g|3g)$/.test(connection?.effectiveType ?? '')) return false
  if (matches('(pointer: coarse)') && matches('(max-width: 767px)')) return false
  return true
}

/** 브라우저가 한가할 때 부른다(최대 2초 기다림). requestIdleCallback이 없으면 0.3초 뒤. 그만두는 함수를 돌려준다 */
function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(() => callback(), { timeout: 2000 })
    return () => window.cancelIdleCallback(handle)
  }
  const handle = setTimeout(callback, 300)
  return () => clearTimeout(handle)
}

// drei useGLTF는 suspend-react 캐시를 읽기만 하고 React 훅을 부르지 않는다. 받는 중이면 Promise를 던지니 기다렸다 다시 읽는다
const readGltf = useGLTF

/** HairLayer(useGLTF(url, false, true))와 같은 캐시로 헤어 GLB를 받아 푼다 */
export async function loadHairGltf(url: string): Promise<{ scene: Object3D }> {
  useGLTF.preload(url, false, true)
  for (;;) {
    try {
      return readGltf(url, false, true) as { scene: Object3D }
    } catch (thrown) {
      if (!(thrown instanceof Promise)) throw thrown
      await thrown.then(
        () => undefined,
        () => undefined,
      )
    }
  }
}
