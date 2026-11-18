'use client'
import { useEffect, useRef } from 'react'
import {
  EYE_SAFE_RULE,
  FOLD_DEPTH_MAX,
  FOLD_LIMIT_CONTROLS,
  TRIM_LIMIT_CONTROLS,
} from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import type { EyeControl, EyeLimits, EyeReview, EyeState, EyeStyle } from '../edit/eyes/state'
import { comboStateAt, increasedControl, type ComboCheck } from './eyeCombo'
import type { EyeRig } from './eyeRig'
import type { EyeLimitJob, EyeLimitResult } from './eyeLimits.worker'

const STYLES: EyeStyle[] = ['inout', 'inline', 'outline']
/** 안전 한계 판정 기준. 기준이 바뀌면 이전 계산(브라우저 캐시·미리 잰 값)을 쓰지 않는다. */
export const EYE_LIMIT_RULE = `${EYE_SAFE_RULE.sharpPerRegion}:${EYE_SAFE_RULE.limitedPerRegion}:${EYE_SAFE_RULE.step}:${FOLD_DEPTH_MAX}`
const CACHE_PREFIX = `preface.eye-limits.v15:${EYE_LIMIT_RULE}:`

/** 조합 검사 결과. 낮췄으면 낮춘 상태, 그대로면 null */
export interface EyeComboResult {
  state: EyeState | null
  control: EyeControl
}
export interface EyeLimitHandlers {
  onLimits?: (limits: EyeLimits) => void
  /** 조합 검사를 시작·끝낼 때 */
  onChecking?: (checking: boolean) => void
  onCombo?: (result: EyeComboResult) => void
}

// 무쌍 눈이 없으면 쌍꺼풀 한계를 계산하지 않는다(0으로 기록하면 상태값까지 0으로 깎인다).
// 깊이는 화면에서 조절하지 않으므로(기본값 고정) 한계를 계산하지 않는다. 확인 중 시간이 그만큼 준다.
function jobsFor(style: EyeStyle, fold: boolean): EyeLimitJob[] {
  return [
    ...(fold ? FOLD_LIMIT_CONTROLS.filter((control) => control !== 'crease') : []).map(
      (control) => ({
        key: `${style}:${control}`,
        control,
        style,
      }),
    ),
    ...TRIM_LIMIT_CONTROLS.map((control) => ({ key: control, control, style })),
  ]
}
function eyeVertices(rig: EyeRig, base: Float32Array) {
  let count = 0
  for (let i = 0; i < base.length; i += 3)
    if (
      rig.eyes.some((eye) => {
        const [u, v, z] = eye.local([base[i], base[i + 1], base[i + 2]])
        return u > -0.45 && u < 1.45 && v > -0.65 && v < 0.85 && Math.abs(z) < 0.55
      })
    )
      count++
  return count
}
function readCache(key: string): EyeLimits {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? '{}')
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, limit]) => typeof limit === 'number' && limit >= 0 && limit <= 100,
      ),
    ) as EyeLimits
  } catch {
    return {}
  }
}
function writeCache(key: string, limits: EyeLimits) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(limits))
  } catch {
    /* 저장하지 못하면 다음에 다시 계산한다. */
  }
}

/**
 * 모델별 안전 한계를 워커에서 계산해 알린다. 같은 파일 해시·판정은 브라우저에 남겨 다시 계산하지 않는다.
 * 지금 고른 쌍꺼풀 종류를 먼저 계산한다. 확정 상태가 커질 때마다 지금 상태 전체를 검사해,
 * 조합이 깨지면 방금 키운 조절을 깨지지 않는 값까지 낮춘다.
 */
export function useEyeLimits(
  rig: EyeRig | null,
  review: EyeReview | undefined,
  cacheKey: string | undefined,
  style: EyeStyle,
  committed: EyeState | undefined,
  handlers: EyeLimitHandlers,
  /** 같은 엔진으로 미리 잰 한계(기본 모델). 있는 열쇠는 다시 계산하지 않는다 */
  known?: EyeLimits,
) {
  const worker = useRef<Worker | null>(null)
  const limits = useRef<EyeLimits>({})
  const notify = useRef(handlers)
  const lastCommitted = useRef<EyeState | null>(null)
  const pending = useRef<ComboCheck | null>(null)
  const sequence = useRef(0)
  useEffect(() => {
    notify.current = handlers
  })
  const reviewKey = review ? `${review.L}${review.R}` : ''
  const fullKey = cacheKey ? `${cacheKey}:${reviewKey}` : undefined

  useEffect(() => {
    if (!rig || !review || !fullKey || typeof Worker === 'undefined') return
    const cached = { ...readCache(fullKey), ...known }
    // 무쌍 눈이 없을 때 남은 쌍꺼풀 한계는 쓰지 않는다.
    limits.current = reviewKey.includes('absent')
      ? cached
      : Object.fromEntries(Object.entries(cached).filter(([key]) => !key.includes(':')))
    notify.current.onLimits?.({ ...limits.current })
    // 피부가 여러 메시로 나뉜 모델(skin + skin_photo)은 눈 주변 정점이 가장 많은 피부로 판정한다.
    const skin = rig.skins.reduce((best, item) =>
      eyeVertices(rig, item.base) > eyeVertices(rig, best.base) ? item : best,
    )
    const instance = new Worker(new URL('./eyeLimits.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<EyeLimitResult>) => {
      const result = event.data
      if (result.type === 'limit') {
        limits.current = { ...limits.current, [result.key]: result.limit }
        writeCache(fullKey, limits.current)
        notify.current.onLimits?.({ ...limits.current })
        return
      }
      const job = pending.current
      // 더 새 검사가 나갔으면 이 결과는 버린다.
      if (!job || job.id !== result.id) return
      pending.current = null
      notify.current.onChecking?.(false)
      const state = result.delta < result.full ? comboStateAt(job, result.delta) : null
      if (state) lastCommitted.current = state
      notify.current.onCombo?.({ state, control: job.control })
    }
    instance.postMessage({
      type: 'rig',
      landmarks: rig.landmarks,
      balls: rig.balls,
      base: skin.base.slice(),
      normals: skin.normals.slice(),
      indices: skin.indices.slice(),
      lid: skin.lid,
      eligible: { L: review.L === 'absent', R: review.R === 'absent' },
    })
    return () => {
      instance.terminate()
      worker.current = null
      if (pending.current) notify.current.onChecking?.(false)
      pending.current = null
    }
    // review는 reviewKey로 비교한다. known은 같은 모델 파일(cacheKey)에 묶인 값이라 열쇠와 함께 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, fullKey])

  useEffect(() => {
    const instance = worker.current
    if (!instance) return
    const order = [style, ...STYLES.filter((item) => item !== style)]
    const fold = reviewKey.includes('absent')
    const jobs = order
      .flatMap((item) => jobsFor(item, fold))
      .filter((job, index, list) => {
        const first = list.findIndex((item) => item.key === job.key) === index
        return first && limits.current[job.key] === undefined
      })
    if (jobs.length) instance.postMessage({ type: 'jobs', jobs })
  }, [style, rig, fullKey, reviewKey])

  useEffect(() => {
    if (!committed) return
    const previous = lastCommitted.current
    lastCommitted.current = committed
    const instance = worker.current
    if (!previous || !instance || !review) return
    const change = increasedControl(previous, committed)
    if (!change) return
    const job: ComboCheck = { id: ++sequence.current, next: committed, review, ...change }
    pending.current = job
    notify.current.onChecking?.(true)
    instance.postMessage({ type: 'check', ...job })
    // review는 reviewKey로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, reviewKey])
}
