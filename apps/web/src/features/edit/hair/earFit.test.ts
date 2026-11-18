import { describe, expect, it } from 'vitest'

import { fitOffEars, keepStrand, pushRings, strandStarts } from './earFit'
import { strandLabels } from './hairFit'

/** x축을 따라가는 가닥 튜브 하나: 고리(점 4개, 반지름 0.2mm)마다 x만 늘고, 고리 사이를 삼각형 8개로 잇는다 */
function tube(xs: number[]) {
  const r = 0.0002
  const points: number[] = []
  for (const x of xs) points.push(x, r, 0, x, 0, r, x, -r, 0, x, 0, -r)
  const index: number[] = []
  for (let ring = 0; ring + 1 < xs.length; ring++)
    for (let k = 0; k < 4; k++) {
      const a = ring * 4 + k
      const b = ring * 4 + ((k + 1) % 4)
      index.push(a, b, a + 4, b, b + 4, a + 4)
    }
  const xyz = new Float32Array(points)
  const labels = strandLabels(index, xyz.length / 3)
  return { xyz, index, labels, starts: strandStarts(labels) }
}

/** x = 0.08 평면(오른쪽 귀 자리)에 놓인 귀 삼각형 하나. `depth`는 앞뒤(z) 반폭 */
function ear(depth: number) {
  return new Float32Array([0.08, -0.005, -depth, 0.08, 0.005, -depth, 0.08, 0, depth])
}

/** 선분이 x = 0.08을 지나는 곳이 귀 삼각형 안인가(가닥 가운데 선으로 본다) */
function crossesEar(xyz: Float32Array, index: ArrayLike<number>, depth: number) {
  for (let t = 0; t < index.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = index[t + e]
      const b = index[t + ((e + 1) % 3)]
      const [x0, x1] = [xyz[a * 3], xyz[b * 3]]
      if ((x0 - 0.08) * (x1 - 0.08) > 0 || x0 === x1) continue
      const w = (0.08 - x0) / (x1 - x0)
      const y = xyz[a * 3 + 1] + (xyz[b * 3 + 1] - xyz[a * 3 + 1]) * w
      const z = xyz[a * 3 + 2] + (xyz[b * 3 + 2] - xyz[a * 3 + 2]) * w
      // 삼각형: z가 -depth에서 depth로 갈수록 y 폭이 0.005에서 0으로 준다
      const half = 0.005 * (1 - (z + depth) / (2 * depth))
      if (z >= -depth && z <= depth && Math.abs(y) <= half) return true
    }
  return false
}

const options = { unit: 0.001, forward: [0, 0, 1] as const, keep: 0 }
const xs = [0.045, 0.055, 0.065, 0.075, 0.085, 0.095, 0.105, 0.115]

describe('pushRings', () => {
  it('고리의 한 점만 밀렸으면 고리 네 점을 같은 만큼 옮긴다', () => {
    const { xyz, labels, starts } = tube([0, 0.01])
    const before = xyz.slice()
    xyz[1 * 3 + 1] += 0.01 // 첫 고리의 둘째 점만 피부 밖으로 밀렸다
    expect(pushRings(before, xyz, labels, starts)).toBe(1)
    for (let i = 0; i < 4; i++) expect(xyz[i * 3 + 1] - before[i * 3 + 1]).toBeCloseTo(0.01, 6)
    // 밀리지 않은 고리는 그대로
    for (let i = 4; i < 8; i++) expect(xyz[i * 3 + 1]).toBe(before[i * 3 + 1])
  })
})

describe('fitOffEars', () => {
  it('귀를 지나는 가닥을 앞으로 옮겨 비키게 하고 뿌리는 그대로 둔다', () => {
    const { xyz, index, labels, starts } = tube(xs)
    const root = Array.from(xyz.slice(0, 12))
    expect(crossesEar(xyz, index, 0.005)).toBe(true)
    const { index: cut, stats } = fitOffEars(xyz, index, labels, starts, ear(0.005), options)
    expect(stats).toMatchObject({ crossing: 1, front: 1 })
    expect(crossesEar(xyz, cut ?? index, 0.005)).toBe(false)
    expect(Array.from(xyz.slice(0, 12))).toEqual(root)
    // 귀를 지나던 고리(고리 4, x 0.085)가 귀 앞으로 옮겨졌다
    expect(xyz[16 * 3 + 2]).toBeGreaterThan(0.005)
  })

  it('앞으로 못 비키면(귀가 넓으면) 귀를 처음 지나는 고리부터 잘라 낸다', () => {
    const { xyz, index, labels, starts } = tube(xs)
    const before = xyz.slice()
    const { index: cut, stats } = fitOffEars(xyz, index, labels, starts, ear(0.1), options)
    expect(stats).toMatchObject({ crossing: 1, front: 0, out: 0, cut: 1 })
    // 고리 4(x 0.085)부터 뒤를 뺀다: 고리 0~3 사이 마디 3개 × 삼각형 8개
    expect(cut).not.toBeNull()
    expect(cut!.length / 3).toBe(3 * 8)
    expect(Math.max(...cut!)).toBeLessThan(16)
    expect(crossesEar(xyz, cut!, 0.1)).toBe(false)
    // 자른 가닥은 옮기지 않는다
    expect(Array.from(xyz)).toEqual(Array.from(before))
  })

  it('남길 가닥(keep)은 자르지 않고 귀 밖으로 꺼낼 수 없으면 그대로 둔다', () => {
    const { xyz, index, labels, starts } = tube(xs)
    const { index: cut, stats } = fitOffEars(xyz, index, labels, starts, ear(0.1), {
      ...options,
      keep: 1,
    })
    // x축을 따라가는 가닥은 옆(x)으로 옮겨도 귀를 지나므로 남기지 못하고 자른다
    expect(stats.out).toBe(0)
    expect(stats.cut).toBe(1)
    expect(cut).not.toBeNull()
  })

  it('귀가 없으면 아무것도 하지 않는다', () => {
    const { xyz, index, labels, starts } = tube(xs)
    const before = Array.from(xyz)
    const result = fitOffEars(xyz, index, labels, starts, new Float32Array(0), options)
    expect(result.index).toBeNull()
    expect(Array.from(xyz)).toEqual(before)
  })
})

describe('keepStrand', () => {
  it('비율만큼 남기고, 같은 가닥은 늘 같은 결과다', () => {
    let kept = 0
    for (let s = 0; s < 20000; s += 4) if (keepStrand(s, 0.15)) kept++
    expect(kept / 5000).toBeGreaterThan(0.12)
    expect(kept / 5000).toBeLessThan(0.18)
    expect(keepStrand(1234, 0.15)).toBe(keepStrand(1234, 0.15))
    expect(keepStrand(1234, 0)).toBe(false)
    expect(keepStrand(1234, 1)).toBe(true)
  })
})
