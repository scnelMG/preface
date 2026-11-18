import {
  changeEyes,
  isDefaultEyes,
  type EyeLimits,
  type EyeReview,
  type EyeState,
} from '../eyes/state'
import { WEIGHT_SHAPE_CODE } from '../weightShapeControls'
import { weightShapeControls } from '../weightShapeControls'
import { contourControls } from '../contourControls'
import { noseControlChanges, noseControls } from '../noseControls'
import type { AppliedChange, EditAction, MorphParameterCatalog } from '../types'

const STEP = { small: 0.1, medium: 0.2, large: 0.3 } as const
const EYE_TRIMS = new Set(['inner', 'outer', 'upper', 'lower'])
const STYLE = new Set(['inline', 'inout', 'outline'])
const round = (value: number) => Math.round(value * 1000) / 1000

export interface SampleState {
  weights: Record<string, number>
  eyes: EyeState
}

/** 기본 모델 체험에서는 서버 후보를 실제 GLB 지원 코드·현재 눈 한계에 다시 맞춘다. */
export function applySampleConsult(
  actions: EditAction[],
  state: SampleState,
  supportedCodes: readonly string[],
  catalog: MorphParameterCatalog,
  review: EyeReview,
  eyeLimits: EyeLimits | undefined,
  eyeReady: boolean,
): { state: SampleState; applied: AppliedChange[]; limited: boolean } | null {
  if (!actions.length || actions.length > 4) return null
  const eyeActions = actions.filter((action) => action.code.startsWith('eye.'))
  const weightAction = actions.some((action) => action.code === WEIGHT_SHAPE_CODE)
  if (weightAction && actions.length !== 1) return null
  if (!weightAction && (state.weights[WEIGHT_SHAPE_CODE] ?? 0) !== 0) return null
  if (
    weightAction &&
    (Object.entries(state.weights).some(
      ([code, value]) => code !== WEIGHT_SHAPE_CODE && value !== 0,
    ) ||
      !isDefaultEyes(state.eyes))
  )
    return null
  if (eyeActions.length && !eyeReady) return null

  const weights = { ...state.weights }
  let eyes = state.eyes
  const parameters = new Map(
    catalog.parts.flatMap((part) => part.items.map((item) => [item.code, item])),
  )
  const applied: AppliedChange[] = []
  let limited = false
  for (const action of actions) {
    const step = STEP[action.strength]
    if (!step || action.side !== 'both' || ![-1, 1].includes(action.direction)) return null
    if (
      action.target !== undefined &&
      (!Number.isFinite(action.target) || Math.abs(action.target) > 1)
    )
      return null
    if (action.code.startsWith('eye.')) {
      const control = action.code.slice(4)
      if (control === 'style_none') {
        if (action.direction !== 1) return null
        eyes = changeEyes(
          eyes,
          'both',
          { type: 'enabled', enabled: false },
          { review, limits: eyeLimits },
        )
      } else if (control.startsWith('style_')) {
        const style = control.slice(6)
        if (!STYLE.has(style) || action.direction !== 1) return null
        eyes = changeEyes(
          eyes,
          'both',
          { type: 'style', style: style as EyeState['L']['style'] },
          { review, limits: eyeLimits },
        )
        applied.push({
          code: action.code,
          from: state.eyes.L.enabled ? 1 : 0,
          to: 1,
          limited: false,
        })
      } else if (control === 'height' || EYE_TRIMS.has(control)) {
        const anchor =
          control === 'height' && !(review.L === 'absent' && eyes.L.enabled) ? 'R' : 'L'
        if (control === 'height' && !(review[anchor] === 'absent' && eyes[anchor].enabled))
          return null
        const slider = control as 'height' | 'inner' | 'outer' | 'upper' | 'lower'
        const before = eyes[anchor].values[slider]
        const key = control === 'height' ? `${eyes[anchor].style}:height` : control
        const max = eyeLimits?.[key]
        if (max === undefined || max <= 0) return null
        const target =
          action.target === undefined
            ? before + action.direction * Math.max(1, Math.round(step * max))
            : Math.min(max, Math.round(action.target * max * 2) / 2)
        eyes = changeEyes(
          eyes,
          'both',
          {
            type: 'control',
            control: control as keyof EyeState['L']['values'],
            value: target,
            relativeTo: anchor,
          },
          { review, limits: eyeLimits },
        )
        const after = eyes[anchor].values[slider]
        limited ||= after !== target
        applied.push({ code: action.code, from: before, to: after, limited: after !== target })
      } else return null
      continue
    }
    if (action.target !== undefined) {
      const control = [
        ...noseControls(catalog, weights, supportedCodes),
        ...contourControls(catalog, weights, supportedCodes),
        ...weightShapeControls(catalog, weights, supportedCodes),
      ].find((item) => item.effects[0].code === action.code && !item.unavailable)
      if (!control) return null
      for (const { code, value } of noseControlChanges(control, action.target)) {
        applied.push({ code, from: weights[code] ?? 0, to: value, limited: false })
        weights[code] = value
      }
      continue
    }
    const codes =
      action.code === 'nose.tip_height'
        ? [
            { code: 'nose.tip_height', gain: 0.6 },
            { code: 'nose.tip_rotation', gain: 0.4 },
          ]
        : [{ code: action.code, gain: 1 }]
    for (const { code, gain } of codes) {
      const bounds = parameters.get(code)
      if (!supportedCodes.includes(code) || !bounds) return null
      const before = weights[code] ?? 0
      const wanted = round(before + action.direction * step * gain)
      const after = Math.max(bounds.min, Math.min(bounds.max, wanted))
      weights[code] = after
      limited ||= after !== wanted
      applied.push({ code, from: before, to: after, limited: after !== wanted })
    }
  }
  if (
    JSON.stringify(weights) === JSON.stringify(state.weights) &&
    JSON.stringify(eyes) === JSON.stringify(state.eyes)
  )
    return null
  return { state: { weights, eyes }, applied, limited }
}
