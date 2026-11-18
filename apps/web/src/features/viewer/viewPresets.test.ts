import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIEW_PRESET,
  isViewPreset,
  presetAzimuth,
  presetCameraPosition,
  VIEW_PRESETS,
} from './viewPresets'

describe('시점 프리셋', () => {
  it('Figma 순서(정면·45°·측면)와 기본값 45°', () => {
    expect(VIEW_PRESETS.map((preset) => preset.label)).toEqual(['정면', '45°', '측면'])
    expect(DEFAULT_VIEW_PRESET).toBe('threeQuarter')
  })

  it('방위각: 정면 0°, 45°는 45°, 측면은 90°', () => {
    expect(presetAzimuth('front')).toBe(0)
    expect(presetAzimuth('threeQuarter')).toBe(45)
    expect(presetAzimuth('side')).toBe(90)
  })

  it('isViewPreset', () => {
    expect(isViewPreset('side')).toBe(true)
    expect(isViewPreset('back')).toBe(false)
  })
})

describe('presetCameraPosition', () => {
  it('정면은 +Z 쪽에서 본다', () => {
    expect(presetCameraPosition('front', 3)).toEqual([0, 0, 3])
  })

  it('측면은 모델 왼쪽(+X)에서 본다', () => {
    expect(presetCameraPosition('side', 2)).toEqual([2, 0, 0])
  })

  it('45°는 +X·+Z 사이, 거리는 그대로', () => {
    const [x, y, z] = presetCameraPosition('threeQuarter', 2)
    expect(x).toBeCloseTo(Math.SQRT2)
    expect(z).toBeCloseTo(Math.SQRT2)
    expect(y).toBe(0)
    expect(Math.hypot(x, y, z)).toBeCloseTo(2)
  })

  it('바라보는 점과 올려다보는 각도를 반영한다', () => {
    const [x, y, z] = presetCameraPosition('front', 2, [0, 1, 0], 30)
    expect(x).toBe(0)
    expect(y).toBeCloseTo(2)
    expect(z).toBeCloseTo(Math.sqrt(3))
  })
})
