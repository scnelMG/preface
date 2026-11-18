import { describe, expect, it } from 'vitest'
import { lightingPosition } from './lighting'

describe('화면 기준 조명 위치', () => {
  it('좌우 방향은 대칭이고 항상 얼굴 앞쪽에서 비춘다', () => {
    const left = lightingPosition(-60, 30)
    const right = lightingPosition(60, 30)
    expect(left[0]).toBeCloseTo(-right[0])
    expect(left[1]).toBeCloseTo(right[1])
    expect(left[2]).toBeGreaterThan(0)
    expect(left[2]).toBeCloseTo(right[2])
  })
  it.each([
    [-90, 0],
    [0, 80],
    [45, 35],
  ])('방향 %s·높이 %s에서도 광원 거리는 일정하다', (azimuth, elevation) => {
    expect(Math.hypot(...lightingPosition(azimuth, elevation))).toBeCloseTo(5)
  })
})
