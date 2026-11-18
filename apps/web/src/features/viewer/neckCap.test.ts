import {
  BufferAttribute,
  type BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  attachNeckCap,
  buildNeckCapGeometry,
  findLongestBoundaryLoop,
  NECK_CAP_NAME,
} from './neckCap'

const SEGMENTS = 16

/** 아래(목)가 열린 합성 머리. SphereGeometry는 UV 이음매에서 정점이 나뉘어 있다 */
function openHead() {
  const geometry = new SphereGeometry(1, SEGMENTS, 8, 0, Math.PI * 2, 0, Math.PI * 0.75)
  const position = geometry.getAttribute('position')
  // 상대 morph 두 개: 전체를 아래로 0.1, 그리고 y에 비례해 옆으로 벌어지기(정점마다 다른 값)
  const down = new Float32Array(position.count * 3)
  const widen = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    down[i * 3 + 1] = -0.1
    widen[i * 3] = position.getX(i) * (0.2 - position.getY(i) * 0.1)
  }
  geometry.morphAttributes.position = [
    Object.assign(new BufferAttribute(down, 3), { name: 'contour.weight_shape_pos' }),
    Object.assign(new BufferAttribute(widen, 3), { name: 'contour.jaw_width_pos' }),
  ]
  geometry.morphTargetsRelative = true
  const skin = new Mesh(geometry, new MeshStandardMaterial({ name: 'skin' }))
  skin.name = 'skin'
  return skin
}

function indexArray(geometry: SphereGeometry) {
  return Array.from(geometry.index!.array)
}

describe('findLongestBoundaryLoop', () => {
  it('UV 이음매로 나뉜 정점을 합쳐 목 테두리 고리 하나를 순서대로 찾는다', () => {
    const { geometry } = openHead()
    const position = geometry.getAttribute('position')
    const loop = findLongestBoundaryLoop(position.array, indexArray(geometry))!
    expect(loop).toHaveLength(SEGMENTS)
    const rimY = Math.cos(Math.PI * 0.75)
    for (const v of loop) expect(position.getY(v)).toBeCloseTo(rimY, 5)
    // 이웃한 점끼리 테두리 한 칸 거리다(순서가 고리를 따른다)
    const step = 2 * Math.sin(Math.PI * 0.75) * Math.sin(Math.PI / SEGMENTS)
    for (let k = 0; k < loop.length; k++) {
      const a = new Vector3().fromBufferAttribute(position, loop[k])
      const b = new Vector3().fromBufferAttribute(position, loop[(k + 1) % loop.length])
      expect(a.distanceTo(b)).toBeCloseTo(step, 5)
    }
  })

  it('닫힌 메시에는 고리가 없다', () => {
    const closed = new SphereGeometry(1, SEGMENTS, 8)
    expect(
      findLongestBoundaryLoop(closed.getAttribute('position').array, indexArray(closed)),
    ).toBeNull()
  })
})

describe('buildNeckCapGeometry', () => {
  it('테두리 + 가운데 점으로 부채꼴을 만들고 법선이 아래(머리 바깥)를 본다', () => {
    const cap = buildNeckCapGeometry(openHead().geometry)!
    expect(cap.getAttribute('position').count).toBe(SEGMENTS + 1)
    expect(cap.index!.count).toBe(SEGMENTS * 3)
    const center = new Vector3().fromBufferAttribute(cap.getAttribute('position'), SEGMENTS)
    expect(center.x).toBeCloseTo(0, 6)
    expect(center.z).toBeCloseTo(0, 6)
    expect(new Vector3().fromBufferAttribute(cap.getAttribute('normal'), SEGMENTS).y).toBeLessThan(
      -0.99,
    )
  })

  it('morph target을 테두리에 그대로, 가운데에는 평균으로 옮긴다', () => {
    const skin = openHead().geometry
    const cap = buildNeckCapGeometry(skin)!
    const targets = cap.morphAttributes.position!
    expect(targets.map((t) => t.name)).toEqual([
      'contour.weight_shape_pos',
      'contour.jaw_width_pos',
    ])
    expect(cap.morphTargetsRelative).toBe(true)
    for (let k = 0; k <= SEGMENTS; k++) expect(targets[0].getY(k)).toBeCloseTo(-0.1, 6)
    let mean = 0
    for (let k = 0; k < SEGMENTS; k++) mean += targets[1].getX(k) / SEGMENTS
    expect(targets[1].getX(SEGMENTS)).toBeCloseTo(mean, 6)
  })

  it('morph를 켜도 마개 테두리가 피부 테두리와 같은 자리에 있다(틈이 없다)', () => {
    const skin = openHead().geometry
    const cap = buildNeckCapGeometry(skin)!
    const weights = [0.7, -0.4]
    const morphed = (geometry: BufferGeometry, i: number) => {
      const p = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), i)
      geometry.morphAttributes.position!.forEach((target, t) =>
        p.addScaledVector(new Vector3().fromBufferAttribute(target, i), weights[t]),
      )
      return p
    }
    const skinPosition = skin.getAttribute('position')
    for (let k = 0; k < SEGMENTS; k++) {
      const rim = morphed(cap, k)
      // 같은 위치의 피부 정점(원래 위치로 찾는다)을 morph한 값과 같아야 한다
      let match = -1
      const original = new Vector3().fromBufferAttribute(cap.getAttribute('position'), k)
      for (let i = 0; i < skinPosition.count; i++)
        if (new Vector3().fromBufferAttribute(skinPosition, i).distanceTo(original) < 1e-6)
          match = i
      expect(match).toBeGreaterThanOrEqual(0)
      expect(rim.distanceTo(morphed(skin, match))).toBeLessThan(1e-6)
    }
  })
})

describe('attachNeckCap', () => {
  it('피부 옆에 마개를 붙이고 morph 이름표와 재질을 피부와 맞춘다', () => {
    const root = new Group()
    const skin = openHead()
    skin.updateMorphTargets()
    root.add(skin)
    const cap = attachNeckCap(root)!
    expect(cap.name).toBe(NECK_CAP_NAME)
    expect(cap.parent).toBe(root)
    expect(cap.material).toBe(skin.material)
    expect(cap.morphTargetDictionary).toEqual(skin.morphTargetDictionary)
    expect(cap.morphTargetInfluences).toEqual([0, 0])
  })

  it('기본 모델에 있던 neck-cap은 새 마개로 바꾼다', () => {
    const root = new Group()
    const old = new Mesh(new SphereGeometry(0.1), new MeshStandardMaterial())
    old.name = NECK_CAP_NAME
    root.add(openHead(), old)
    const cap = attachNeckCap(root)
    expect(old.parent).toBeNull()
    expect(root.children.filter((child) => child.name === NECK_CAP_NAME)).toEqual([cap])
  })

  it('피부가 없거나 구멍이 없으면 아무것도 바꾸지 않는다', () => {
    const root = new Group()
    const closed = new Mesh(new SphereGeometry(1, SEGMENTS, 8), new MeshStandardMaterial())
    closed.name = 'skin'
    const old = new Mesh(new SphereGeometry(0.1), new MeshStandardMaterial())
    old.name = NECK_CAP_NAME
    root.add(closed, old)
    expect(attachNeckCap(root)).toBeNull()
    expect(old.parent).toBe(root)
    expect(attachNeckCap(new Group())).toBeNull()
  })
})
