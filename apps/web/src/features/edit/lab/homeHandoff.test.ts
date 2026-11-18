import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHomeHandoff,
  HOME_HANDOFF_STORAGE_KEY,
  parseHomeHandoff,
  readHomeHandoff,
  writeHomeHandoff,
} from './homeHandoff'

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('메인 → 체험 실험실 값 넘기기 (S15P31B204-746)', () => {
  it('쓴 기본 모델과 조절값을 그대로 읽고, 손대지 않은 상태(null)는 지운다', () => {
    writeHomeHandoff({
      sample: 'base-female',
      weights: { 'nose.bridge_height': 0.4, 'contour.weight_shape': -0.5 },
    })
    expect(readHomeHandoff()).toEqual({
      sample: 'base-female',
      weights: { 'nose.bridge_height': 0.4, 'contour.weight_shape': -0.5 },
    })
    writeHomeHandoff(null)
    expect(sessionStorage.getItem(HOME_HANDOFF_STORAGE_KEY)).toBeNull()
    expect(readHomeHandoff()).toBeNull()
  })

  it('모르는 모델·깨진 JSON·모양이 다른 값은 없는 것으로 본다', () => {
    expect(parseHomeHandoff('{')).toBeNull()
    expect(parseHomeHandoff('[]')).toBeNull()
    expect(parseHomeHandoff('null')).toBeNull()
    expect(parseHomeHandoff(JSON.stringify({ sample: 'base-alien', weights: {} }))).toBeNull()
    expect(parseHomeHandoff(JSON.stringify({ weights: { 'nose.bridge_height': 0.2 } }))).toBeNull()
  })

  it('모르는 항목 코드·범위 밖·숫자가 아닌 값은 버리고 나머지만 남긴다', () => {
    const parsed = parseHomeHandoff(
      JSON.stringify({
        sample: 'base-male',
        weights: {
          'nose.bridge_height': 0.3,
          'nose.alar_width': 5,
          'contour.jaw_angle': -1,
          'eye.fold': 0.5,
          'nose.tip_height': '0.2',
          'nose.tip_rotation': null,
        },
      }),
    )
    expect(parsed).toEqual({
      sample: 'base-male',
      weights: { 'nose.bridge_height': 0.3, 'contour.jaw_angle': -1 },
    })
    expect(parseHomeHandoff(JSON.stringify({ sample: 'base-male', weights: [1, 2] }))).toEqual({
      sample: 'base-male',
      weights: {},
    })
  })

  it('저장소가 막혀 있어도 던지지 않고 없는 것으로 본다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() =>
      writeHomeHandoff({ sample: 'base-male', weights: { 'nose.bridge_height': 0.2 } }),
    ).not.toThrow()
    expect(readHomeHandoff()).toBeNull()
    expect(() => clearHomeHandoff()).not.toThrow()
  })
})
