import {
  creaseHeights,
  FOLD_DEFAULT,
} from '../../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'

export type EyeSide = 'L' | 'R'
export type EyeSelection = EyeSide | 'both'
export type EyeStyle = 'inline' | 'inout' | 'outline'
export type EyeControl = 'height' | 'crease' | 'inner' | 'outer' | 'lower' | 'upper'
export const screenEyeLabel = (side: EyeSide): string => (side === 'R' ? '왼쪽' : '오른쪽')
export type EyeReview = Record<EyeSide, 'absent' | 'present' | 'unknown'>
export interface EyeSettings {
  enabled: boolean
  style: EyeStyle
  values: Record<EyeControl, number>
  curve: number[]
}
export type EyeState = Record<EyeSide, EyeSettings>
export const EYE_DEFAULTS = {
  height: 20,
  // 깊이 기본은 엔진과 같다(2026-11-01 55 → 65, 깊이 100 = 이전 상한 65의 단면)
  crease: FOLD_DEFAULT,
  inner: 0,
  outer: 0,
  lower: 0,
  upper: 0,
}
export const FOLD_CONTROLS = ['height', 'crease'] as const
export const TRIM_CONTROLS = ['inner', 'outer', 'lower', 'upper'] as const
export const CURVE_MIN = 0.005
export const CURVE_MAX = 0.36

/**
 * 모델별 안전 한계(엔진 단위 0~100). 쌍꺼풀 조절은 종류마다 다르므로 `${종류}:${조절}`,
 * 트임은 조절 이름이 열쇠다. 열쇠가 없으면 아직 확인 중이다.
 */
export type EyeLimits = Partial<Record<string, number>>
export const limitKey = (control: EyeControl, style: EyeStyle) =>
  (FOLD_CONTROLS as readonly string[]).includes(control) ? `${style}:${control}` : control
export function controlLimit(
  limits: EyeLimits | undefined,
  control: EyeControl,
  style: EyeStyle,
): number | undefined {
  // 한계를 계산하지 않는 환경(테스트·워커 없음)은 전체 범위를 쓴다.
  if (!limits) return 100
  return limits[limitKey(control, style)]
}
/** 구간 높이는 안전한 전체 높이에서 그 구간이 갖는 값까지만 올린다. */
export function curveLimit(limits: EyeLimits | undefined, style: EyeStyle, index: number) {
  if (!limits) return CURVE_MAX
  const height = controlLimit(limits, 'height', style)
  return height === undefined ? undefined : creaseHeights(height, style)[index]
}

export const eyesIn = (selection: EyeSelection): EyeSide[] =>
  selection === 'both' ? ['L', 'R'] : [selection]
export function newEyeState(): EyeState {
  const make = (): EyeSettings => ({
    enabled: false,
    style: 'inout',
    values: { ...EYE_DEFAULTS },
    curve: creaseHeights(20, 'inout'),
  })
  return { L: make(), R: make() }
}
export type EyeAction =
  | {
      type: 'control'
      control: EyeControl
      value: number
      /** 양쪽 값이 다를 때 기준 눈과의 차이만큼 두 눈을 함께 옮겨 좌우 차이를 보존한다. */
      relativeTo?: EyeSide
    }
  | { type: 'style'; style: EyeStyle }
  | { type: 'enabled'; enabled: boolean }
  | { type: 'curve'; index: number; value: number; relativeTo?: EyeSide }
  | { type: 'resetCurve'; index: number }
  | { type: 'reset'; scope?: 'fold' | 'trim' }

export interface EyeChangeOptions {
  /** 주면 쌍꺼풀 동작은 무쌍(absent) 판정 눈에만 적용한다. */
  review?: EyeReview
  limits?: EyeLimits
}
const FOLD_ACTIONS = new Set(['style', 'enabled', 'curve', 'resetCurve'])
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * 전체 높이를 바꿀 때 5점 설계 높이. 엔진 설계 식(`creaseHeights`)을 새 높이로 다시 계산하고,
 * 구간 높이를 따로 바꾼 만큼(이전 설계값과의 차이)은 그대로 얹는다.
 * 2026-11-01 이전에는 5점을 같은 비율로 늘려, 설계 식의 가운데 낮춤(아치)까지 커져 높이 100에서 가운데가
 * 엔진 식보다 18% 낮고 아웃라인은 가운데가 처졌다.
 */
export function curveAtHeight(curve: number[], from: number, to: number, style: EyeStyle) {
  const before = creaseHeights(from, style),
    after = creaseHeights(to, style)
  return after.map((value, index) =>
    clamp(value + (curve[index] ?? before[index]) - before[index], CURVE_MIN, CURVE_MAX),
  )
}

export function changeEyes(
  state: EyeState,
  selection: EyeSelection,
  action: EyeAction,
  { review, limits }: EyeChangeOptions = {},
): EyeState {
  const next = restoreEyes(state) ?? newEyeState()
  const isFold =
    FOLD_ACTIONS.has(action.type) ||
    (action.type === 'control' && (FOLD_CONTROLS as readonly string[]).includes(action.control))
  for (const side of eyesIn(selection)) {
    if (isFold && review && review[side] !== 'absent') continue
    const eye = next[side]
    // 아직 확인 중인 한계는 조작을 막지 않는다(슬라이더는 화면에서 잠기고, 확인되면 clampEyes가 낮춘다).
    const max = (control: EyeControl) => controlLimit(limits, control, eye.style) ?? 100
    if (action.type === 'enabled') eye.enabled = action.enabled
    if (action.type === 'style') {
      eye.enabled = true
      eye.style = action.style
      eye.values.height = Math.min(eye.values.height, max('height'))
      eye.values.crease = Math.min(eye.values.crease, max('crease'))
      eye.curve = creaseHeights(eye.values.height, action.style)
    }
    if (action.type === 'control' && Number.isFinite(action.value)) {
      const anchor = action.relativeTo ? state[action.relativeTo].values[action.control] : undefined
      const requested =
        anchor === undefined ? action.value : eye.values[action.control] + action.value - anchor
      const value = clamp(requested, 0, Math.min(100, max(action.control)))
      if (action.control === 'height')
        eye.curve = curveAtHeight(eye.curve, eye.values.height, value, eye.style)
      eye.values[action.control] = value
    }
    if (
      action.type === 'curve' &&
      Number.isFinite(action.value) &&
      action.index >= 0 &&
      action.index < 5
    ) {
      const anchor = action.relativeTo ? state[action.relativeTo].curve[action.index] : undefined
      const requested =
        anchor === undefined ? action.value : eye.curve[action.index] + action.value - anchor
      eye.curve[action.index] = clamp(
        requested,
        CURVE_MIN,
        curveLimit(limits, eye.style, action.index) ?? CURVE_MAX,
      )
    }
    if (
      action.type === 'resetCurve' &&
      Number.isInteger(action.index) &&
      action.index >= 0 &&
      action.index < 5
    )
      eye.curve[action.index] = creaseHeights(eye.values.height, eye.style)[action.index]
    if (action.type === 'reset') {
      const defaults = newEyeState()[side]
      if (action.scope === 'fold') {
        eye.enabled = defaults.enabled
        eye.style = defaults.style
        eye.curve = defaults.curve
        eye.values.height = defaults.values.height
        eye.values.crease = defaults.values.crease
      } else if (action.scope === 'trim') {
        for (const control of TRIM_CONTROLS) eye.values[control] = 0
      } else next[side] = defaults
    }
  }
  return next
}

/** 새로 확인된 한계보다 큰 값을 한계로 낮춘다. 바뀐 것이 없으면 같은 객체를 돌려준다. */
export function clampEyes(state: EyeState, limits: EyeLimits): EyeState {
  let changed = false
  const next = structuredClone(state)
  for (const side of ['L', 'R'] as const) {
    const eye = next[side]
    for (const control of [...FOLD_CONTROLS, ...TRIM_CONTROLS]) {
      const limit = limits[limitKey(control, eye.style)]
      if (limit !== undefined && eye.values[control] > limit) {
        if (control === 'height')
          eye.curve = curveAtHeight(eye.curve, eye.values.height, limit, eye.style)
        eye.values[control] = limit
        changed = true
      }
    }
    eye.curve = eye.curve.map((value, index) => {
      const limit = curveLimit(limits, eye.style, index)
      if (limit === undefined || value <= limit) return value
      changed = true
      return limit
    })
  }
  return changed ? next : state
}

export function isDefaultEyes(state: EyeState) {
  return JSON.stringify(state) === JSON.stringify(newEyeState())
}

/** 브라우저 저장값도 입력이다. 모델 해시별 키와 함께 구조·범위를 확인한다. */
export function restoreEyes(value: unknown): EyeState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as EyeState
  for (const side of ['L', 'R'] as const) {
    const eye = state[side]
    if (
      !eye ||
      typeof eye.enabled !== 'boolean' ||
      !['inline', 'inout', 'outline'].includes(eye.style) ||
      !eye.values ||
      !Array.isArray(eye.curve) ||
      eye.curve.length !== 5
    )
      return null
    for (const key of Object.keys(EYE_DEFAULTS) as EyeControl[]) {
      const number = eye.values[key]
      if (!Number.isFinite(number) || number < 0 || number > 100) return null
    }
    if (!eye.curve.every((v) => Number.isFinite(v) && v >= CURVE_MIN && v <= CURVE_MAX)) return null
  }
  // v1에 남아 있는 뜨임·꼬리 값은 복원하지 않는다. 라인과 트임은 보존한다.
  const restored = newEyeState()
  for (const side of ['L', 'R'] as const) {
    restored[side] = {
      enabled: state[side].enabled,
      style: state[side].style,
      values: Object.fromEntries(
        Object.keys(EYE_DEFAULTS).map((key) => [key, state[side].values[key as EyeControl]]),
      ) as Record<EyeControl, number>,
      curve: [...state[side].curve],
    }
  }
  return restored
}
