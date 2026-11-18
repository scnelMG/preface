import { describe, expect, it } from 'vitest'
import { Box3, Mesh, Vector3 } from 'three'
import { applyMorphWeights } from './morphTargets'
import { createSyntheticHead, SYNTHETIC_MORPH_CODES } from './syntheticHead'

function headMesh() {
  const group = createSyntheticHead()
  const head = group.getObjectByName('synthetic_head')
  if (!(head instanceof Mesh)) throw new Error('머리 메시 없음')
  return { group, head }
}

/** 원본 + Σ influence × 상대 변위로 정점 하나의 위치를 계산한다(셰이더와 같은 식) */
function morphedVertex(head: Mesh, index: number): Vector3 {
  const geometry = head.geometry
  const base = geometry.getAttribute('position')
  const result = new Vector3(base.getX(index), base.getY(index), base.getZ(index))
  geometry.morphAttributes.position?.forEach((target, t) => {
    const influence = head.morphTargetInfluences?.[t] ?? 0
    result.x += target.getX(index) * influence
    result.y += target.getY(index) * influence
    result.z += target.getZ(index) * influence
  })
  return result
}

/** 얼굴 정면에서 가장 앞으로 나온 정점(코) */
function noseIndex(head: Mesh): number {
  const position = head.geometry.getAttribute('position')
  let best = 0
  for (let i = 1; i < position.count; i += 1) {
    if (position.getZ(i) > position.getZ(best)) best = i
  }
  return best
}

describe('합성 머리', () => {
  it('저장 코드 이름으로 morph target 3개(위치·법선)를 가진다', () => {
    const { head } = headMesh()
    expect(Object.keys(head.morphTargetDictionary ?? {})).toEqual([...SYNTHETIC_MORPH_CODES])
    expect(head.geometry.morphAttributes.position).toHaveLength(3)
    expect(head.geometry.morphAttributes.normal).toHaveLength(3)
    expect(head.geometry.morphTargetsRelative).toBe(true)
  })

  it('머리 높이가 약 2 + 목', () => {
    const { group } = headMesh()
    const size = new Box3().setFromObject(group).getSize(new Vector3())
    expect(size.y).toBeGreaterThan(2.5)
    expect(size.y).toBeLessThan(3.5)
  })

  it('콧대 높이 +는 코를 앞으로(+Z), 코끝 높이 +는 위로(+Y) 옮긴다', () => {
    const { head } = headMesh()
    const nose = noseIndex(head)
    const before = morphedVertex(head, nose)

    applyMorphWeights([head], { 'nose.bridge_height': 1 })
    expect(morphedVertex(head, nose).z).toBeGreaterThan(before.z)

    applyMorphWeights([head], { 'nose.tip_height': 1 }, SYNTHETIC_MORPH_CODES)
    const tip = morphedVertex(head, nose)
    expect(tip.y).toBeGreaterThan(before.y)
    expect(tip.z).toBeCloseTo(before.z)
  })

  // S15P31B204-390: 체험 3D 칸(데스크톱 약 740×213px)에서 머리가 100px 남짓이라, 예전 변위(최대 0.05~0.08)는
  // 슬라이더 끝값에서도 코가 2~7px만 움직여 "안 바뀐다"로 보였다. 체험 슬라이더 끝값 중 가장 작은 0.5에서
  // 머리 높이(약 2)의 3.5% 이상 움직여야 한다
  it.each(SYNTHETIC_MORPH_CODES)('%s는 체험 슬라이더 끝값(0.5)에서 눈에 띄게 움직인다', (code) => {
    const { head } = headMesh()
    const index = head.morphTargetDictionary?.[code]
    const target = head.geometry.morphAttributes.position?.[index ?? -1]
    if (!target) throw new Error(`${code} target 없음`)
    let largest = 0
    for (let i = 0; i < target.count; i += 1) {
      largest = Math.max(largest, Math.hypot(target.getX(i), target.getY(i), target.getZ(i)) * 0.5)
    }
    expect(largest).toBeGreaterThanOrEqual(0.07)
  })

  // 체험 슬라이더·API-EDIT-01 예시 범위의 양 끝
  const TRIAL_RANGE: Record<(typeof SYNTHETIC_MORPH_CODES)[number], [number, number]> = {
    'nose.bridge_height': [-0.5, 0.8],
    'nose.tip_height': [-0.5, 0.5],
    'nose.alar_width': [-0.5, 0.5],
  }

  it.each(SYNTHETIC_MORPH_CODES)('%s 체험 범위 양 끝에서 얼굴 앞면이 뒤집히지 않는다', (code) => {
    const { head } = headMesh()
    const geometry = head.geometry
    const index = geometry.getIndex()
    if (!index) throw new Error('인덱스 없음')
    for (const weight of TRIAL_RANGE[code]) {
      applyMorphWeights([head], { [code]: weight }, SYNTHETIC_MORPH_CODES)
      // 정면(xy 평면)에 비친 삼각형 넓이 부호. 뒤집히면 부호가 바뀐다
      const area = (a: Vector3, b: Vector3, c: Vector3) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      const base = geometry.getAttribute('position')
      const original = (i: number) => new Vector3(base.getX(i), base.getY(i), base.getZ(i))
      let flipped = 0
      for (let t = 0; t < index.count; t += 3) {
        const [i, j, k] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
        const [a, b, c] = [original(i), original(j), original(k)]
        if (Math.min(a.z, b.z, c.z) < 0.5) continue
        const before = area(a, b, c)
        if (Math.abs(before) < 1e-6) continue
        const after = area(morphedVertex(head, i), morphedVertex(head, j), morphedVertex(head, k))
        if (Math.sign(after) !== Math.sign(before)) flipped += 1
      }
      expect({ weight, flipped }).toEqual({ weight, flipped: 0 })
    }
  })

  it('뒤통수는 어떤 효과에도 움직이지 않는다', () => {
    const { head } = headMesh()
    const base = head.geometry.getAttribute('position')
    let largest = 0
    for (const target of head.geometry.morphAttributes.position ?? []) {
      for (let i = 0; i < base.count; i += 1) {
        if (base.getZ(i) < 0) {
          largest = Math.max(
            largest,
            Math.abs(target.getX(i)),
            Math.abs(target.getY(i)),
            Math.abs(target.getZ(i)),
          )
        }
      }
    }
    expect(largest).toBe(0)
  })
})
