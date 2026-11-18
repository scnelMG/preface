import { describe, expect, it } from 'vitest'
import { comparisonFitDistance, comparisonSeparationDistance } from './comparisonFraming'

describe('비교 모델 화면 맞춤', () => {
  const corners = [-0.7, 0.7].flatMap((x) =>
    [-1.2, 1.2].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z] as const)),
  )
  it.each([0.2, 0.5, 1, 2])(
    '화면 비율 %s에서도 모든 꼭짓점이 양쪽 화각 안에 들어간다',
    (aspect) => {
      const distance = comparisonFitDistance(corners, aspect, 30)
      for (const [x, y, z] of corners) {
        expect(Math.abs(x) / (distance - z)).toBeLessThan(Math.tan(Math.PI / 12) * aspect)
        expect(Math.abs(y) / (distance - z)).toBeLessThan(Math.tan(Math.PI / 12))
      }
    },
  )

  it('모델이 두 배 커지면 맞춤 거리도 두 배가 된다', () => {
    const larger = corners.map(([x, y, z]) => [x * 2, y * 2, z * 2] as const)
    expect(comparisonFitDistance(larger, 0.5, 30)).toBe(comparisonFitDistance(corners, 0.5, 30) * 2)
  })
})

describe('비교 확대 제한', () => {
  it.each([0.2, 0.5, 1, 2])('비율 %s에서 수평 경계가 슬롯 안에 남는다', (aspect) => {
    const corners = [-0.7, 0.7].flatMap((x) =>
      [-1.2, 1.2].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z] as const)),
    )
    for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
      const rotated = corners.map(
        ([x, y, z]) =>
          [
            x * Math.cos(angle) + z * Math.sin(angle),
            y,
            -x * Math.sin(angle) + z * Math.cos(angle),
          ] as const,
      )
      const distance = comparisonSeparationDistance(rotated, aspect, 30)
      for (const [x, , z] of rotated)
        expect(Math.abs(x) / (distance - z)).toBeLessThan(Math.tan(Math.PI / 12) * aspect)
    }
  })
})
