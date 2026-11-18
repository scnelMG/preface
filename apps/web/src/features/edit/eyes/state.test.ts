import { describe, it, expect } from 'vitest'
import { creaseHeights } from '../../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import {
  newEyeState,
  changeEyes,
  restoreEyes,
  clampEyes,
  curveLimit,
  isDefaultEyes,
  EYE_DEFAULTS,
} from './state'
describe('로컬 눈 편집 상태', () => {
  it('높이·트임을 바꿔도 다른 눈과 기존 라인을 보존한다', () => {
    let state = changeEyes(newEyeState(), 'L', { type: 'enabled', enabled: true })
    state = changeEyes(state, 'L', { type: 'curve', index: 4, value: 0.22 })
    const before = structuredClone(state)
    const after = changeEyes(state, 'L', { type: 'control', control: 'inner', value: 35 })
    expect(after.L.curve).toEqual(before.L.curve)
    expect(after.L.enabled).toBe(true)
    expect(after.R).toEqual(before.R)
    expect(state).toEqual(before)
  })
  it('종류 변경은 깊이와 트임을 보존하고 양쪽 각각의 높이를 사용한다', () => {
    let state = changeEyes(newEyeState(), 'both', {
      type: 'control',
      control: 'inner',
      value: 25,
    })
    state = changeEyes(state, 'R', { type: 'control', control: 'height', value: 70 })
    const after = changeEyes(state, 'both', { type: 'style', style: 'inline' })
    expect(after.L.values).toEqual(state.L.values)
    expect(after.R.values).toEqual(state.R.values)
    expect(after.L.curve).not.toEqual(after.R.curve)
  })
  it('켜기·끄기는 구간별 높이 곡선을 지우지 않는다', () => {
    const state = changeEyes(newEyeState(), 'both', { type: 'curve', index: 2, value: 0.18 })
    const toggled = changeEyes(
      changeEyes(state, 'both', { type: 'enabled', enabled: true }),
      'both',
      { type: 'enabled', enabled: false },
    )
    expect(toggled).toEqual(state)
  })
  it('복원은 유효한 상태만 허용한다', () => {
    const state = newEyeState()
    expect(restoreEyes(state)).toEqual(state)
    expect(restoreEyes({ ...state, L: { ...state.L, curve: [NaN] } })).toBeNull()
    expect(
      restoreEyes({ ...state, R: { ...state.R, values: { ...state.R.values, inner: 500 } } }),
    ).toBeNull()
    expect(restoreEyes(null)).toBeNull()
  })
})

it('이전 시안의 뜨임·꼬리는 제거하고 쌍꺼풀·트임·구간 높이를 보존한다', () => {
  const original = changeEyes(newEyeState(), 'L', { type: 'style', style: 'inline' })
  original.L.values.inner = 24
  original.L.curve[4] = 0.2
  const legacy = structuredClone(original)
  Object.assign(legacy.L.values, { opening: 90, tail: -80 })
  Object.assign(legacy.R.values, { opening: 60, tail: 40 })
  expect(restoreEyes(legacy)).toEqual(original)
  expect(changeEyes(legacy, 'L', { type: 'curve', index: 2, value: 0.15 }).R).toEqual(original.R)
})
it('종류를 선택하면 즉시 적용하고 깊이·트임은 유지한다', () => {
  const before = changeEyes(newEyeState(), 'both', { type: 'control', control: 'inner', value: 20 })
  const after = changeEyes(before, 'both', { type: 'style', style: 'outline' })
  expect(after.L.enabled).toBe(true)
  expect(after.R.enabled).toBe(true)
  expect(after.L.values).toEqual(before.L.values)
})

it('구간 초기화는 좌우 각각의 종류·높이를 따르고 다른 구간을 보존한다', () => {
  let original = changeEyes(newEyeState(), 'L', { type: 'style', style: 'inline' })
  original = changeEyes(original, 'R', { type: 'control', control: 'height', value: 70 })
  const changed = changeEyes(original, 'both', { type: 'curve', index: 4, value: 0.3 })
  const reset = changeEyes(changed, 'both', { type: 'resetCurve', index: 4 })
  expect(reset.L.curve[4]).toEqual(original.L.curve[4])
  expect(reset.R.curve[4]).not.toEqual(reset.L.curve[4])
  expect(reset.L.curve.slice(0, 4)).toEqual(changed.L.curve.slice(0, 4))
  expect(reset.R.curve.slice(0, 4)).toEqual(changed.R.curve.slice(0, 4))
  expect(changed.L.curve[4]).toEqual(0.3)
})

describe('구조 한계 보완', () => {
  const absentLeft = { L: 'absent', R: 'present' } as const
  it('양쪽 선택에서도 쌍꺼풀 동작은 무쌍 판정 눈에만 기록하고 트임은 양쪽에 적용한다', () => {
    const styled = changeEyes(
      newEyeState(),
      'both',
      { type: 'style', style: 'outline' },
      {
        review: absentLeft,
      },
    )
    expect(styled.L.enabled).toBe(true)
    expect(styled.R).toEqual(newEyeState().R)
    const trimmed = changeEyes(
      styled,
      'both',
      { type: 'control', control: 'inner', value: 10 },
      {
        review: absentLeft,
      },
    )
    expect(trimmed.L.values.inner).toBe(10)
    expect(trimmed.R.values.inner).toBe(10)
  })
  it('양쪽 값이 다르면 기준 눈과의 차이만큼 함께 옮겨 좌우 차이를 보존한다', () => {
    let state = changeEyes(newEyeState(), 'L', { type: 'control', control: 'crease', value: 80 })
    state = changeEyes(state, 'both', {
      type: 'control',
      control: 'crease',
      value: 70,
      relativeTo: 'L',
    })
    expect(state.L.values.crease).toBe(70)
    expect(state.R.values.crease).toBe(EYE_DEFAULTS.crease - 10)
  })
  it('안전 한계보다 큰 값은 받지 않고 새로 확인된 한계로 낮춘다', () => {
    const limits = { 'inout:height': 40, 'inout:crease': 75, inner: 30 }
    const state = changeEyes(
      newEyeState(),
      'both',
      { type: 'control', control: 'inner', value: 90 },
      { limits },
    )
    expect(state.L.values.inner).toBe(30)
    const loose = changeEyes(newEyeState(), 'both', {
      type: 'control',
      control: 'height',
      value: 90,
    })
    const clamped = clampEyes(loose, limits)
    expect(clamped.L.values.height).toBe(40)
    expect(clamped.L.curve[4]).toBeLessThanOrEqual(curveLimit(limits, 'inout', 4)!)
    expect(clampEyes(clamped, limits)).toBe(clamped)
  })
  it('기본 상태 여부로 초기화 가능 여부를 정한다', () => {
    expect(isDefaultEyes(newEyeState())).toBe(true)
    expect(isDefaultEyes(changeEyes(newEyeState(), 'R', { type: 'style', style: 'inline' }))).toBe(
      false,
    )
  })
})

describe('전체 높이 변경', () => {
  it('엔진 설계 식으로 5점을 다시 계산하고 구간을 따로 바꾼 만큼은 유지한다', () => {
    let state = changeEyes(newEyeState(), 'both', { type: 'style', style: 'outline' })
    state = changeEyes(state, 'both', { type: 'control', control: 'height', value: 100 })
    // 비율로 늘리면 아웃라인 가운데(0.5)가 앞머리보다 낮아졌다
    creaseHeights(100, 'outline').forEach((value, index) =>
      expect(state.L.curve[index]).toBeCloseTo(value, 9),
    )
    expect(state.L.curve[2]).toBeGreaterThan(state.L.curve[0])
    const custom = changeEyes(state, 'L', {
      type: 'curve',
      index: 1,
      value: state.L.curve[1] + 0.02,
    })
    const lowered = changeEyes(custom, 'L', { type: 'control', control: 'height', value: 50 })
    expect(lowered.L.curve[1]).toBeCloseTo(creaseHeights(50, 'outline')[1] + 0.02, 6)
    expect(lowered.L.curve[3]).toBeCloseTo(creaseHeights(50, 'outline')[3], 6)
  })
})
