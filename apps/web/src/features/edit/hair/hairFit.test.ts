import { describe, expect, it } from 'vitest'
import {
  backBody,
  backHair,
  backProfile,
  backSettleShift,
  EAR_POINTS,
  earAnchors,
  fitHairToHead,
  followEars,
  followSkin,
  readTemplateSkin,
  followSkinByStrand,
  skinShiftField,
  skinShifts,
  type TemplateSkin,
  fitHairToLandmarks,
  HAIR_LANDMARKS,
  pushOutOfSkin,
  settleOnBack,
  TEMPLATE_SKIN_BOX,
  type Box,
  type HairFit,
} from './hairFit'
import { HAIR_ASSETS, HAIR_NONE, hairUrlOf } from './catalog'

const place = (p: readonly [number, number, number], box: Box) => {
  const fit = fitHairToHead(box)
  return p.map((v, i) => v * fit.scale + fit.position[i])
}

describe('fitHairToHead', () => {
  it('템플릿과 같은 머리면 그대로 둔다', () => {
    const fit = fitHairToHead(TEMPLATE_SKIN_BOX)
    expect(fit.scale).toBe(1)
    fit.position.forEach((v) => expect(v).toBeCloseTo(0, 6))
  })

  it('기본 여성 모델처럼 원점만 다른 머리는 정수리·가운데를 맞춰 옮긴다', () => {
    // apps/web/public/models/base-female.glb skin 경계 상자
    const head: Box = { min: [-0.1278, -0.2016, -0.1172], max: [0.1277, 0.1401, 0.1185] }
    const fit = fitHairToHead(head)
    expect(fit.scale).toBeCloseTo(1, 2)
    expect(fit.position[1]).toBeCloseTo(-0.267, 3)
    expect(fit.position[2]).toBeCloseTo(-0.0265, 3)
    // 템플릿 정수리 점이 머리 정수리로 간다
    expect(place([0, TEMPLATE_SKIN_BOX.max[1], 0], head)[1]).toBeCloseTo(head.max[1], 6)
  })

  it('머리 폭에 맞춰 정수리 기준으로 키운다', () => {
    const head: Box = {
      min: [-0.1278 * 1.1, 0.0656, -0.0922],
      max: [0.1276 * 1.1, 0.4071, 0.1465],
    }
    const fit = fitHairToHead(head)
    expect(fit.scale).toBeCloseTo(1.1, 3)
    expect(place([0, TEMPLATE_SKIN_BOX.max[1], 0], head)[1]).toBeCloseTo(head.max[1], 6)
  })

  it('경계 상자가 이상하면 크기는 바꾸지 않는다', () => {
    const head: Box = { min: [0, 0, 0], max: [0.01, 0.4, 0.1] }
    expect(fitHairToHead(head).scale).toBe(1)
  })
})

type V = [number, number, number]
/** 헤어 점 p를 변환대로 놓는다: s·Rx(t)·p + position (three.js Object3D와 같은 순서) */
const apply = (fit: HairFit, p: readonly number[]): V => {
  const c = Math.cos(fit.rotationX)
  const s = Math.sin(fit.rotationX)
  const r = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]
  return r.map((v, i) => fit.scale * v + fit.position[i]) as V
}
const pointsFrom = (move: (p: readonly number[]) => V) => {
  const map = new Map(HAIR_LANDMARKS.map((mark) => [mark.vertex, move(mark.at)]))
  return (vertex: number) => map.get(vertex) ?? null
}

describe('fitHairToLandmarks', () => {
  it('템플릿과 같은 머리면 그대로 둔다', () => {
    const fit = fitHairToLandmarks(pointsFrom((p) => [...p] as V))!
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.rotationX).toBeCloseTo(0, 6)
    fit.position.forEach((v) => expect(v).toBeCloseTo(0, 6))
  })

  it('기본 여성 모델처럼 원점만 다른 머리는 그만큼 옮긴다', () => {
    const fit = fitHairToLandmarks(pointsFrom((p) => [p[0], p[1] - 0.267, p[2] - 0.0265]))!
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.position[1]).toBeCloseTo(-0.267, 6)
    expect(fit.position[2]).toBeCloseTo(-0.0265, 6)
  })

  it('크기·앞뒤 기울기·위치가 다른 머리에서 정수리와 이마 라인을 그 자리에 놓는다', () => {
    const truth: HairFit = {
      scale: 1.1,
      rotationX: (5 * Math.PI) / 180,
      position: [0.003, -0.25, -0.02],
    }
    const fit = fitHairToLandmarks(pointsFrom((p) => apply(truth, p)))!
    expect(fit.scale).toBeCloseTo(1.1, 4)
    expect(fit.rotationX).toBeCloseTo(truth.rotationX, 4)
    for (const name of ['crown', 'hairlineFront']) {
      const mark = HAIR_LANDMARKS.find((m) => m.name === name)!
      apply(fit, mark.at).forEach((v, i) => expect(v).toBeCloseTo(apply(truth, mark.at)[i], 4))
    }
  })

  it('이마가 넓은 얼굴이면 이마 라인 쪽으로 헤어를 올린다', () => {
    const forehead = new Set(['hairlineFront', 'hairlineL', 'hairlineR'])
    const raised = new Map(
      HAIR_LANDMARKS.map((m) => [
        m.vertex,
        [m.at[0], m.at[1] + (forehead.has(m.name) ? 0.008 : 0), m.at[2]] as V,
      ]),
    )
    const fit = fitHairToLandmarks((v) => raised.get(v) ?? null)!
    const front = HAIR_LANDMARKS.find((m) => m.name === 'hairlineFront')!
    expect(apply(fit, front.at)[1]).toBeGreaterThan(front.at[1] + 0.004)
  })

  it('어느 점도 머리 안으로 들어가지 않는다(두피가 비치지 않게)', () => {
    // 정수리만 2mm 높은 머리: 최소제곱만 하면 정수리에서 헤어가 피부 안으로 들어간다
    const map = new Map(
      HAIR_LANDMARKS.map((m) => [
        m.vertex,
        [m.at[0], m.at[1] + (m.name === 'crown' ? 0.002 : 0), m.at[2]] as V,
      ]),
    )
    const fit = fitHairToLandmarks((v) => map.get(v) ?? null)!
    const all = HAIR_LANDMARKS.map((m) => ({
      hair: apply(fit, m.at),
      head: map.get(m.vertex)!,
      w: m.weight,
    }))
    // 가운데는 맞출 때와 같은 가중 평균
    const total = all.reduce((sum, { w }) => sum + w, 0)
    const c = [0, 1, 2].map((k) => all.reduce((sum, { head, w }) => sum + head[k] * w, 0) / total)
    const r = (v: V) => Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2])
    // 머리 가운데에서 잰 거리로 본다: 헤어 점이 피부 점보다 바깥(같거나 멀리)에 있다
    for (const { hair, head } of all) expect(r(hair)).toBeGreaterThanOrEqual(r(head) - 1e-6)
    expect(fit.scale).toBeLessThan(1.05)
  })

  it('점이 하나라도 없으면 null(경계 상자로 되돌린다)', () => {
    const all = pointsFrom((p) => [...p] as V)
    expect(fitHairToLandmarks((v) => (v === HAIR_LANDMARKS[1].vertex ? null : all(v)))).toBeNull()
  })

  it('점들이 템플릿 머리와 너무 다르면 null', () => {
    let k = 0
    const noisy = pointsFrom((p) => {
      k += 1
      return [p[0] + (k % 2 ? 0.03 : -0.03), p[1], p[2] + (k % 3 ? 0.02 : -0.04)]
    })
    expect(fitHairToLandmarks(noisy)).toBeNull()
  })

  it('크기가 범위를 벗어나면 null', () => {
    expect(fitHairToLandmarks(pointsFrom((p) => p.map((v) => v * 1.6) as V))).toBeNull()
  })
})

describe('헤어 목록', () => {
  it('없음·모르는 값은 주소가 없다', () => {
    expect(hairUrlOf(HAIR_NONE)).toBeNull()
    expect(hairUrlOf('unknown')).toBeNull()
    expect(hairUrlOf('male-leaf')).toMatch(/\/hair\/male-leaf\.glb$/)
  })

  it('블렌더 가닥 헤어도 GLB와 썸네일 주소가 있다', () => {
    for (const id of ['layered', 'dandy', 'male-leaf', 'wolf']) {
      const asset = HAIR_ASSETS.find((item) => item.id === id)
      expect(asset?.url).toMatch(new RegExp(`/hair/${id}\\.glb$`))
      expect(asset?.thumbnail).toMatch(new RegExp(`/hair/${id}\\.webp$`))
    }
  })

  it('id가 겹치지 않는다', () => {
    const ids = HAIR_ASSETS.map((asset) => asset.id)
    expect(new Set([...ids, HAIR_NONE]).size).toBe(ids.length + 1)
  })
})

describe('pushOutOfSkin', () => {
  // 위를 보는 평면 피부(y = 0) 한 장: 1cm 간격 격자 점, 법선 +Y
  const plane = () => {
    const points: number[] = []
    const normals: number[] = []
    for (let x = -0.05; x <= 0.05 + 1e-9; x += 0.01)
      for (let z = -0.05; z <= 0.05 + 1e-9; z += 0.01) {
        points.push(x, 0, z)
        normals.push(0, 1, 0)
      }
    return { points: new Float32Array(points), normals: new Float32Array(normals) }
  }

  it('피부 안이나 너무 가까운 점만 피부 밖 clear까지 올린다', () => {
    const xyz = new Float32Array([
      0.001,
      -0.004,
      0.002, // 피부 안 4mm
      0.003,
      0.0005,
      -0.001, // 피부에서 0.5mm
      0.002,
      0.005,
      0.001, // 피부에서 5mm: 그대로
    ])
    const pushed = pushOutOfSkin(xyz, plane(), 0.0015, 0.015)
    expect(pushed).toBe(2)
    expect(xyz[1]).toBeCloseTo(0.0015, 6)
    expect(xyz[4]).toBeCloseTo(0.0015, 6)
    expect(xyz[7]).toBeCloseTo(0.005, 6)
    // 법선 방향으로만 움직인다
    expect(Float32Array.from([xyz[0], xyz[2], xyz[3], xyz[5]])).toEqual(
      Float32Array.from([0.001, 0.002, 0.003, -0.001]),
    )
  })

  it('피부에서 reach보다 먼 점은 보지 않는다', () => {
    const xyz = new Float32Array([0.3, -0.004, 0])
    expect(pushOutOfSkin(xyz, plane(), 0.0015, 0.015)).toBe(0)
    expect(xyz[1]).toBeCloseTo(-0.004, 6)
  })
})

describe('귀 맞춤', () => {
  const fit: HairFit = { scale: 0.75, position: [0.01, -0.2, 0.03], rotationX: 0 }
  const place = (p: readonly number[]) => p.map((v, k) => fit.scale * v + fit.position[k])

  it('사람 귀가 놓인 평균 머리 귀보다 아래면 그만큼(헤어 좌표) 내려가는 변위를 준다', () => {
    // 왼쪽 귀만 머리 좌표에서 6mm 아래, 오른쪽 귀는 그대로
    const pointOf = (vertex: number) => {
      const mark = EAR_POINTS.find((item) => item.vertex === vertex)
      if (!mark) return null
      const q = place(mark.at)
      if (mark.side === 'L') q[1] -= 0.006
      return q as unknown as [number, number, number]
    }
    const anchors = earAnchors(fit, pointOf)
    expect(anchors).toHaveLength(2)
    const left = anchors.find((a) => a.at[0] > 0)!
    const right = anchors.find((a) => a.at[0] < 0)!
    expect(left.shift[1]).toBeCloseTo(-0.006 / 0.75, 6)
    expect(Math.hypot(...right.shift)).toBeLessThan(1e-9)
  })

  it('귀 점을 못 찾으면 그 귀는 맞추지 않는다', () => {
    expect(earAnchors(fit, () => null)).toEqual([])
  })

  it('귀 가운데는 변위만큼, 멀리 있는 점은 거의 그대로 옮긴다', () => {
    const at: [number, number, number] = [0.078, 0.277, 0.02]
    const xyz = new Float32Array([...at, 0, 0.4, 0])
    followEars(xyz, [{ at, shift: [0, -0.008, 0] }])
    expect(xyz[1]).toBeCloseTo(0.277 - 0.008, 6)
    expect(xyz[4]).toBeCloseTo(0.4, 6)
  })
})

describe('두피 점 따라 옮기기', () => {
  // 템플릿 피부 3점(번호 10·11·12): 하나는 귀
  const skin: TemplateSkin = {
    ids: Uint16Array.from([10, 11, 12]),
    points: Float32Array.from([0, 0.3, 0.1, 0.05, 0.3, 0.08, 0.08, 0.27, 0.02]),
    ear: Uint8Array.from([0, 0, 1]),
  }
  const fit: HairFit = { scale: 1, position: [0, 0, 0], rotationX: 0 }

  it('사람 피부가 놓인 템플릿보다 바깥이면 그 변위를 주고, 귀는 이웃 값으로 채운다', () => {
    // 사람 피부: 모든 점이 템플릿보다 z로 4mm 앞
    const pointOf = (vertex: number) => {
      const i = skin.ids.indexOf(vertex)
      return i < 0
        ? null
        : ([skin.points[i * 3], skin.points[i * 3 + 1], skin.points[i * 3 + 2] + 0.004] as [
            number,
            number,
            number,
          ])
    }
    const shifts = skinShifts(skin, fit, pointOf)
    expect(shifts[2]).toBeCloseTo(0.004, 6)
    expect(shifts[5]).toBeCloseTo(0.004, 6)
    // 귀(멀리 떨어진 점)는 가까운 값이 없어 0
    expect(shifts[8]).toBe(0)
  })

  it('헤어 점은 가장 가까운 두피 점의 변위만큼 옮기고, 너무 먼 점은 그대로 둔다', () => {
    const shifts = Float32Array.from([0, 0, 0.004, 0, -0.003, 0, 0, 0, 0])
    const xyz = Float32Array.from([0.001, 0.302, 0.105, 0.049, 0.31, 0.085, 0.5, 0.5, 0.5])
    expect(followSkin(xyz, skinShiftField(skin, shifts))).toBe(2)
    expect(xyz[2]).toBeCloseTo(0.109, 6)
    expect(xyz[4]).toBeCloseTo(0.307, 6)
    expect(xyz[6]).toBeCloseTo(0.5, 6)
  })

  it('가닥 방식은 뿌리(두피에 가장 가까운 점)의 변위로 가닥 전체를 똑같이 옮긴다', () => {
    const shifts = Float32Array.from([0, 0, 0.004, 0, -0.003, 0, 0, 0, 0])
    // 가닥 A: 뿌리(0)는 피부 점 10 바로 위, 끝(3)은 4.5cm 밖. 가닥 B: 모든 점이 두피에서 멀다
    const xyz = Float32Array.from([
      0.001, 0.302, 0.102, 0.003, 0.3, 0.12, 0.004, 0.29, 0.135, 0.005, 0.28, 0.145, 0.5, 0.5, 0.5,
      0.51, 0.5, 0.5, 0.5, 0.51, 0.5,
    ])
    const index = [0, 1, 2, 1, 3, 2, 4, 5, 6]
    const moved = followSkinByStrand(xyz, index, skinShiftField(skin, shifts))
    expect(moved).toBe(4)
    for (const i of [0, 1, 2, 3])
      expect(xyz[i * 3 + 2]).toBeGreaterThan([0.102, 0.12, 0.135, 0.145][i] + 0.0035)
    expect(xyz[3 * 3 + 2]).toBeCloseTo(xyz[0 * 3 + 2] + 0.043, 4)
    expect(xyz[4 * 3 + 2]).toBeCloseTo(0.5, 6)
  })

  it('어깨·가슴(템플릿 y 0.15 아래) 피부 점에는 묶지 않고, 목과의 사이는 서서히 줄인다', () => {
    const body: TemplateSkin = {
      ids: Uint16Array.from([20, 21, 22]),
      points: Float32Array.from([0, 0.1, -0.08, 0, 0.165, -0.06, 0, 0.2, -0.045]),
      ear: Uint8Array.from([0, 0, 0]),
    }
    const shifts = Float32Array.from([0, 0, -0.01, 0, 0, -0.01, 0, 0, -0.01])
    const xyz = Float32Array.from([0, 0.1, -0.085, 0, 0.165, -0.065, 0, 0.2, -0.05])
    followSkin(xyz, skinShiftField(body, shifts))
    expect(xyz[2]).toBeCloseTo(-0.085, 6)
    expect(xyz[5]).toBeLessThan(-0.066)
    expect(xyz[5]).toBeGreaterThan(-0.075)
    expect(xyz[8]).toBeCloseTo(-0.06, 6)
  })

  it('gnm-skin.bin 형식을 읽는다', () => {
    const count = 3
    const buffer = new ArrayBuffer(8 + 8 + count * 12 + count)
    const view = new DataView(buffer)
    view.setUint32(0, 0x474e4d53, false)
    view.setUint32(4, count, true)
    new Uint16Array(buffer, 8, count).set([10, 11, 12])
    new Float32Array(buffer, 16, count * 3).set(skin.points)
    new Uint8Array(buffer, 16 + count * 12, count).set([0, 0, 1])
    const read = readTemplateSkin(buffer)
    expect(Array.from(read!.ids)).toEqual([10, 11, 12])
    expect(read!.points[3]).toBeCloseTo(0.05, 6)
    expect(Array.from(read!.ear)).toEqual([0, 0, 1])
    expect(readTemplateSkin(new ArrayBuffer(8))).toBeNull()
  })
})

describe('뒷머리 등에 맞추기', () => {
  /** 세로축(x = 0, z = 0) 둘레 반지름 r 원기둥 점(헤어 좌표), 높이 y0~y1 */
  const ring = (r: number, y0: number, y1: number) => {
    const out: number[] = []
    for (let y = y0; y <= y1 + 1e-9; y += 0.005)
      for (let k = 0; k < 96; k++) {
        const a = (k / 96) * 2 * Math.PI
        out.push(r * Math.sin(a), y, -r * Math.cos(a))
      }
    return new Float32Array(out)
  }
  const profileOf = (body: Float32Array, hair: Float32Array) => {
    const profile = backProfile()
    backBody(profile, body)
    backHair(profile, hair)
    return profile
  }
  // 평균 몸(반지름 9cm, 높이 6~30cm)에서 헤어는 2mm 떨어져 있다
  const templateBody = ring(0.09, 0.06, 0.3)
  const hair = ring(0.092, 0.0, 0.3)
  const template = profileOf(templateBody, hair)

  it('사람 몸과 헤어가 평균 머리와 같으면 옮기지 않는다', () => {
    const shift = backSettleShift(template, profileOf(templateBody, hair))
    const points = new Float32Array([0, 0.1, -0.092, 0.05, 0.12, -0.08])
    expect(settleOnBack(points, shift)).toBe(0)
  })

  it('등이 평균보다 1cm 앞이면 목 아래 뒷머리를 1cm 안으로 옮기고, 뒤통수·앞쪽 머리는 그대로 둔다', () => {
    const shift = backSettleShift(template, profileOf(ring(0.08, 0.06, 0.3), hair))
    const back = new Float32Array([0, 0.1, -0.092])
    const tip = new Float32Array([0, 0.02, -0.092]) // 몸이 끝난 아래로 내려온 머리끝
    const crown = new Float32Array([0, 0.3, -0.092])
    const front = new Float32Array([0, 0.1, 0.092])
    settleOnBack(back, shift)
    settleOnBack(tip, shift)
    expect(back[2]).toBeCloseTo(-0.082, 3)
    expect(back[1]).toBe(Math.fround(0.1))
    expect(tip[2]).toBeCloseTo(-0.082, 3)
    expect(settleOnBack(crown, shift)).toBe(0)
    expect(settleOnBack(front, shift)).toBe(0)
  })
})
