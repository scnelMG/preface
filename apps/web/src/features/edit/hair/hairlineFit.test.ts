import { describe, expect, it } from 'vitest'
import { HAIR_ASSETS, hairAssetOfUrl } from './catalog'
import {
  bendFront,
  EYE_CORNERS,
  expectedScale,
  fitHairToHead,
  fitHairToLandmarks,
  foreheadAngle,
  HAIR_LANDMARKS,
  hairlineAnchors,
  hairlineCurve,
  placeHairPoint,
  readHairline,
  scalpPaintFade,
  TEMPLATE_EYE_DISTANCE,
  TEMPLATE_SKIN_BOX,
} from './hairFit'

type V = [number, number, number]

/** 평균 머리(gnm-template-v2.npz)의 눈 바깥 끝 두 점과 턱끝 */
const EXTRA: Record<number, V> = {
  [EYE_CORNERS[0]]: [-0.0425, 0.2993, 0.1074],
  [EYE_CORNERS[1]]: [0.0437, 0.3016, 0.1085],
  12256: [0, 0.1865, 0.1163],
}

/** 템플릿 점(헤어 기준점·눈·턱)을 move로 옮긴 머리 */
const headFrom = (move: (p: readonly number[]) => V) => {
  const map = new Map<number, V>()
  for (const mark of HAIR_LANDMARKS) map.set(mark.vertex, move(mark.at))
  for (const [id, at] of Object.entries(EXTRA)) map.set(Number(id), move(at))
  return (vertex: number) => map.get(vertex) ?? null
}

/** 복원 모델처럼 눈 사이를 63mm로 맞춘 머리: 약 0.73배, 원점도 다르다 */
const eyeDistance = Math.hypot(...EXTRA[EYE_CORNERS[0]].map((v, k) => v - EXTRA[EYE_CORNERS[1]][k]))
const SMALL = 0.063 / eyeDistance
const small = (p: readonly number[]): V => [p[0] * SMALL, p[1] * SMALL - 0.2, p[2] * SMALL - 0.02]

describe('크기: 복원 모델(평균 머리의 약 0.73배)', () => {
  it('눈 사이 거리로 기대 크기를 구한다', () => {
    expect(expectedScale(headFrom(small))).toBeCloseTo(0.063 / TEMPLATE_EYE_DISTANCE, 2)
    expect(expectedScale(() => null)).toBe(1)
  })

  it('점 맞춤이 0.73배를 버리지 않고 그대로 쓴다', () => {
    const fit = fitHairToLandmarks(headFrom(small))!
    expect(fit).not.toBeNull()
    expect(fit.scale).toBeCloseTo(SMALL, 3)
  })

  it('상자 맞춤도 기대 크기 근처면 그 크기를 쓰고, 이상하면 기대 크기로 둔다', () => {
    const box = {
      min: TEMPLATE_SKIN_BOX.min.map((v) => v * SMALL) as unknown as V,
      max: TEMPLATE_SKIN_BOX.max.map((v) => v * SMALL) as unknown as V,
    }
    expect(fitHairToHead(box, TEMPLATE_SKIN_BOX, SMALL).scale).toBeCloseTo(SMALL, 6)
    const empty = { min: [0, 0, 0] as V, max: [0.001, 0.1, 0.1] as V }
    expect(fitHairToHead(empty, TEMPLATE_SKIN_BOX, SMALL).scale).toBeCloseTo(SMALL, 6)
  })
})

describe('헤어라인 읽기', () => {
  const points = Array.from({ length: 10 }, (_, i) => [i, i + 1, i + 2, 0.2, 0.3])

  it('version 1과 다섯 숫자 점만 받는다', () => {
    expect(readHairline({ version: 1, points })).toHaveLength(10)
    expect(readHairline({ version: 2, points })).toBeNull()
    expect(readHairline({ version: 1, points: points.slice(0, 3) })).toBeNull()
    expect(readHairline(undefined)).toBeNull()
    expect(readHairline({ version: 1, points: [...points, [1, 2, 3]] })).toHaveLength(10)
  })

  it('피부 삼각형 무게로 곡선을 다시 그리고, 못 찾은 정점의 점은 뺀다', () => {
    const at = (v: number): V | null => (v === 99 ? null : [v, 2 * v, 0])
    const curve = hairlineCurve(
      [
        [1, 2, 3, 0.5, 0.25],
        [99, 2, 3, 0.5, 0.25],
      ],
      at,
    )
    expect(curve).toHaveLength(1)
    // 0.5·1 + 0.25·2 + 0.25·3 = 1.75
    expect(curve[0][0]).toBeCloseTo(1.75, 9)
    expect(curve[0][1]).toBeCloseTo(3.5, 9)
  })
})

describe('헤어별 앞쪽 경계', () => {
  it('목록의 헤어가 모두 경계를 갖고, 이마 가운데가 위쪽에 있다', () => {
    for (const asset of HAIR_ASSETS) {
      const edge = hairAssetOfUrl(asset.url)!.hairline!
      expect(edge.length).toBeGreaterThanOrEqual(10)
      const top = Math.max(...edge.map((p) => p[1]))
      expect(top).toBeGreaterThan(0.36)
      expect(top).toBeLessThan(0.4)
    }
    expect(hairAssetOfUrl('/hair/unknown.glb')).toBeNull()
  })

  it('이마 펼친 지도 각도: 이마 가운데 90°, 사람의 왼쪽(+X)이 작다', () => {
    const angle = foreheadAngle(headFrom((p) => [...p] as V))!
    expect((angle([0, 0.38, 0.1]) * 180) / Math.PI).toBeCloseTo(90, 0)
    expect(angle([0.06, 0.34, 0.08])).toBeLessThan(angle([-0.06, 0.34, 0.08]))
    expect(foreheadAngle(() => null)).toBeNull()
  })
})

/** 맞춤 계산용 헤어 경계(예전 긴 웨이브 헤어의 경계, 평균 머리 좌표). 목록에서 빠져도 같은 값으로 시험한다 */
const EDGE: readonly (readonly [number, number, number])[] = [
  [0.0676, 0.32, 0.0714],
  [0.0625, 0.3318, 0.083],
  [0.0576, 0.3418, 0.0882],
  [0.0523, 0.3485, 0.0926],
  [0.0446, 0.3567, 0.0969],
  [0.0367, 0.3651, 0.0984],
  [0.0268, 0.3735, 0.097],
  [0.0079, 0.3815, 0.0948],
  [0.0063, 0.3827, 0.0935],
  [-0.0132, 0.3798, 0.0954],
  [-0.0289, 0.3725, 0.0964],
  [-0.0323, 0.3674, 0.0988],
  [-0.0458, 0.3551, 0.0955],
  [-0.0489, 0.3517, 0.0939],
  [-0.058, 0.341, 0.0867],
  [-0.0646, 0.3279, 0.0782],
  [-0.068, 0.3206, 0.0705],
]

describe('헤어 앞부분을 사람 헤어라인에 맞춤', () => {
  const head = headFrom(small)
  const fit = fitHairToLandmarks(head)!
  const edge = EDGE
  /** 헤어 경계를 그대로 놓은 뒤 up(머리 좌표, m)만큼 올린 사람 헤어라인 */
  const personLine = (up: number): V[] =>
    edge.map((p) => {
      const q = placeHairPoint(fit, p)
      return [q[0], q[1] + up, q[2]]
    })

  it('헤어라인이 헤어 경계와 같으면 옮기지 않는다', () => {
    const anchors = hairlineAnchors(fit, personLine(0), edge, head)
    expect(anchors.length).toBeGreaterThanOrEqual(10)
    for (const { shift } of anchors) expect(Math.hypot(...shift)).toBeLessThan(1e-6)
  })

  it('헤어라인이 1cm 높으면 이마 가운데 경계를 그만큼(헤어 좌표로 1cm/크기) 올리고, 정수리는 거의 그대로', () => {
    const anchors = hairlineAnchors(fit, personLine(0.01), edge, head)
    const front = anchors.reduce((a, b) => (b.at[1] > a.at[1] ? b : a))
    expect(front.shift[1] * fit.scale).toBeGreaterThan(0.008)
    expect(Math.hypot(...front.shift) * fit.scale).toBeLessThan(0.0125)
    const crown = HAIR_LANDMARKS.find((m) => m.name === 'crown')!.at
    const xyz = [...front.at, ...crown]
    bendFront(xyz, anchors)
    // 같은 각도의 점으로 옮기므로(머리 중심에서 바깥쪽) 위쪽 성분은 올린 양보다 조금 작다
    expect((xyz[1] - front.at[1]) * fit.scale).toBeGreaterThan(0.007)
    expect(Math.abs(xyz[4] - crown[1]) * fit.scale).toBeLessThan(0.001)
  })

  it('너무 먼 점(헤어 좌표 3.5cm 넘게)은 맞추지 않는다', () => {
    expect(hairlineAnchors(fit, personLine(0.08), edge, head)).toHaveLength(0)
  })

  it('곡선이 짧거나 지도 점이 없거나 경계가 없으면 옮기지 않는다', () => {
    expect(hairlineAnchors(fit, personLine(0.01).slice(0, 4), edge, head)).toHaveLength(0)
    expect(hairlineAnchors(fit, personLine(0.01), edge, () => null)).toHaveLength(0)
    expect(hairlineAnchors(fit, personLine(0.01), [], head)).toHaveLength(0)
  })
})

describe('두피 칠', () => {
  it('목록의 헤어가 모두 두피 칠 텍스처를 갖는다', () => {
    for (const asset of HAIR_ASSETS)
      expect(asset.scalpPaint).toMatch(/\/hair\/[a-z-]+\.scalp\.webp$/)
  })

  it('사람 헤어라인 밖(이마 쪽)은 지우고, 1cm 안쪽(정수리 쪽)은 그대로 둔다', () => {
    const head = headFrom((p) => [...p] as V)
    const edge = EDGE
    const curve = edge.map((p) => [...p] as V)
    const front = edge.reduce((a, b) => (b[1] > a[1] ? b : a))
    const below: V = [front[0], front[1] - 0.015, front[2] + 0.004] // 헤어라인 아래 이마
    const above: V = [front[0], front[1] + 0.02, front[2] - 0.012] // 헤어라인 2cm 위
    const back: V = [0, 0.33, -0.08] // 뒤통수: 헤어라인 각도 밖
    const fade = scalpPaintFade([below, above, back], curve, head)
    expect(fade[0]).toBe(0)
    expect(fade[1]).toBeGreaterThan(0.9)
    expect(fade[2]).toBe(1)
  })

  it('헤어라인이 없으면 모두 1', () => {
    expect([...scalpPaintFade([[0, 0.38, 0.1]], [], () => null)]).toEqual([1])
  })
})
