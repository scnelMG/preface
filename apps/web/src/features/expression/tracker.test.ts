import { describe, expect, it } from 'vitest'
import {
  displacement,
  landmarkMotion,
  lidClosure,
  lidClosureRows,
  limitWeights,
  parseExpressionRig,
  solveWeights,
} from './rig'
import { blinkAmount } from './blink'
import { createExpressionSolver, frownWrinkle, type TrackedPoint } from './tracker'

const N = 468
const b64 = (array: Float32Array | Int32Array | Int16Array) =>
  btoa(String.fromCharCode(...new Uint8Array(array.buffer)))

/**
 * 작은 가짜 리그: 얼굴 점 i는 템플릿 정점 i에 붙고, 성분 하나가 얼굴 점 13(윗입술)을 위로 1만큼 올린다.
 * 풀이 행렬 P는 그 움직임을 그대로 읽는다(가중치 = 얼굴 점 13의 위쪽 움직임).
 */
function tinyRig(extra: Record<string, unknown> = {}) {
  const lmk = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) {
    lmk[3 * i] = Math.cos(i * 0.7) * 0.05 + (i % 7) * 0.003
    lmk[3 * i + 1] = Math.sin(i * 1.3) * 0.06 + (i % 5) * 0.002
    lmk[3 * i + 2] = Math.cos(i * 0.31) * 0.02
  }
  const P = new Float32Array(N * 3)
  P[3 * 13 + 1] = 1
  const blink = new Float32Array(N * 3)
  blink[3 * 13 + 1] = 0.5
  return parseExpressionRig({
    format: 'live-mirror-rig',
    options: { blink_gain: {}, named_gain: {} },
    iod: 0.063,
    axes: { right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, 1] },
    expr: {
      lid: Array.from({ length: N }, (_, i) => i),
      lmk: b64(lmk),
      nbase: N,
      named_extra: { jawOpen: b64(blink) },
      ...extra,
    },
    gnmx: {
      names: ['gx_lower_face_region_000'],
      K: 1,
      clip: 4,
      P: b64(P),
      shapes: {
        gx_lower_face_region_000: {
          idx: b64(Int32Array.of(13)),
          q: b64(Int16Array.of(0, 1000, 0)),
          sc: 0.001,
        },
      },
    },
    rig: { shapes: {} },
  })
}

function points(rig: NonNullable<ReturnType<typeof tinyRig>>, yawDeg = 0, lift = 0) {
  const a = (yawDeg * Math.PI) / 180
  const out: TrackedPoint[] = []
  for (let i = 0; i < N; i++) {
    const x = rig.lmk[3 * i]
    const y = rig.lmk[3 * i + 1] + (i === 13 ? lift : 0)
    const z = rig.lmk[3 * i + 2]
    out.push({ x: Math.cos(a) * x + Math.sin(a) * z, y, z: -Math.sin(a) * x + Math.cos(a) * z })
  }
  return out
}

const jaw = () => {
  const motion = new Float32Array(N * 3)
  motion[3 * 13 + 1] = 0.5
  return motion
}

function run(
  yawDeg: number,
  lift: number,
  scores: Record<string, number> | null = null,
  extra: Record<string, unknown> = {},
) {
  const rig = tinyRig(extra)
  if (!rig) throw Error('rig')
  return { rig, frame: runWith(rig, yawDeg, lift, scores) }
}

function runWith(
  rig: NonNullable<ReturnType<typeof tinyRig>>,
  yawDeg: number,
  lift: number,
  scores: Record<string, number> | null = null,
) {
  const solver = createExpressionSolver(rig)
  const list = (values: Record<string, number>) =>
    Object.entries(values).map(([categoryName, score]) => ({ categoryName, score }))
  let t = 0
  for (let i = 0; i < 21; i++)
    solver.step(points(rig), 1, 1, scores ? list({ jawOpen: 0 }) : null, (t += 0.033))
  let frame = null
  for (let i = 0; i < 90; i++)
    frame = solver.step(points(rig, yawDeg, lift), 1, 1, scores ? list(scores) : null, (t += 0.033))
  if (!frame) throw Error('no frame')
  return frame
}

describe('표정 리그', () => {
  it('표정 옵션이 없는 리그는 쓰지 않는다', () => {
    expect(parseExpressionRig({ format: 'live-mirror-rig', gnmx: {}, expr: {} })).toBeNull()
  })

  it('가중치 = P · 얼굴 점 움직임, 변위 = 가중치 × 성분', () => {
    const rig = tinyRig()
    if (!rig) throw Error('rig')
    const motion = new Float32Array(N * 3)
    motion[3 * 13 + 1] = 2
    const weights = solveWeights(rig, motion)
    expect(weights[0]).toBeCloseTo(2)
    const moved = displacement(rig, weights, new Float32Array(N * 3))
    expect(moved[3 * 13 + 1]).toBeCloseTo(2)
    expect(moved[3 * 12 + 1]).toBe(0)
  })

  it('가중치는 한계에서 잘린다', () => {
    const rig = tinyRig()
    if (!rig) throw Error('rig')
    const motion = new Float32Array(N * 3)
    motion[3 * 13 + 1] = 99
    expect(solveWeights(rig, motion)[0]).toBe(4)
  })

  it('한계를 넘으면 전체를 같은 비율로 줄여 표정 모양을 지킨다', () => {
    expect(Array.from(limitWeights(Float32Array.of(8, -2, 1), 4))).toEqual([4, -1, 0.5])
    expect(Array.from(limitWeights(Float32Array.of(3, -2), 4))).toEqual([3, -2])
  })
})

describe('표정 풀이', () => {
  it('무표정 그대로면 표정도 머리 회전도 없다', () => {
    const { frame } = run(0, 0)
    expect(frame.weights[0]).toBeCloseTo(0, 5)
    expect(frame.poseDeg).toBeCloseTo(0, 3)
    expect(frame.head[3]).toBeCloseTo(1, 5)
  })

  it('얼굴 점이 움직인 만큼 가중치가 나온다(작은 움직임은 버린다)', () => {
    expect(run(0, 0.01).frame.weights[0]).toBeCloseTo(0.01, 3)
    expect(run(0, 0.0003).frame.weights[0]).toBeCloseTo(0, 5)
  })

  it('고개를 돌리면 머리 회전만 따라가고 얼굴 점 표정은 줄어든다', () => {
    const turned = run(40, 0.01).frame
    expect(turned.poseDeg).toBeCloseTo(40, 0)
    expect(turned.poseGain).toBe(0)
    expect(turned.weights[0]).toBeCloseTo(0, 5)
    expect((2 * Math.acos(Math.abs(turned.head[3])) * 180) / Math.PI).toBeCloseTo(40, 0)
    const half = run(20, 0.01).frame
    expect(half.poseGain).toBeGreaterThan(0.5)
    expect(half.poseGain).toBeLessThan(1)
  })

  it('고개를 돌린 동안에는 표정 점수가 대신한다', () => {
    // 가짜 리그의 jawOpen은 얼굴 점 13을 0.5 올린다 → 점수 1이면 가중치 0.5
    expect(run(40, 0, { jawOpen: 1 }).frame.weights[0]).toBeCloseTo(0.5, 2)
    expect(run(0, 0, { jawOpen: 1 }).frame.weights[0]).toBeCloseTo(0, 5)
  })

  it('직접 정의한 표정은 얼굴 점이 이미 만든 만큼을 빼고 얹는다', () => {
    // 점수 1 = 가중치 0.8인 표정. 얼굴 점이 0.4를 이미 만들었으면 나머지 0.4만 더한다(1.2가 되지 않는다)
    const native = { native: { mouthPucker: b64(Float32Array.of(0.8)) } }
    expect(run(0, 0, { mouthPucker: 1 }, native).frame.weights[0]).toBeCloseTo(0.8, 2)
    expect(run(0, 0.4, { mouthPucker: 1 }, native).frame.weights[0]).toBeCloseTo(0.8, 2)
    expect(run(0, 0, { mouthPucker: 0.5 }, native).frame.weights[0]).toBeCloseTo(0.4, 2)
  })

  it('점수 보조는 얼굴 점이 보여 준 만큼과 합쳐 점수 × 배율이 되게 채운다', () => {
    // 가짜 리그의 풀이는 그대로 전달한다. 배율 1.5, 점수 1: 얼굴 점이 0.2(목표 0.5의 40 %)를 보였으면 합쳐 0.75가 된다.
    // 부족분에만 배율을 곱하던 때는 0.2 + 0.6 × 1.5 × 0.5 = 0.65였다
    const gain = { named_extra: { jawOpen: b64(jaw()) } }
    const rig = tinyRig(gain)
    if (!rig) throw Error('rig')
    rig.namedGain.jawOpen = 1.5
    expect(runWith(rig, 0, 0.2, { jawOpen: 1 }).weights[0]).toBeCloseTo(0.75, 2)
    expect(runWith(rig, 0, 0, { jawOpen: 1 }).weights[0]).toBeCloseTo(0.75, 2)
  })

  it('끝까지 올라가지 않는 점수는 실제 최댓값을 1로 보고 편다', () => {
    // 눈썹 내림 점수는 세게 찡그려도 0.6 안팎이다 → 0.6이면 다 얹고 0.3이면 절반
    const native = { native: { browDownLeft: b64(Float32Array.of(0.8)) } }
    expect(run(0, 0, { browDownLeft: 0.6 }, native).frame.weights[0]).toBeCloseTo(0.8, 2)
    expect(run(0, 0, { browDownLeft: 0.3 }, native).frame.weights[0]).toBeCloseTo(0.4, 2)
  })

  it('가중치로 잰 눈 감김은 변위를 풀어 잰 눈 감김과 같다', () => {
    // 오른눈 윗눈꺼풀(얼굴 점 159)을 아래로 내리는 성분을 하나 더 붙인다
    const rig = tinyRig()
    if (!rig) throw Error('rig')
    rig.components.names.push('lid')
    rig.components.shapes.push({ idx: Int32Array.of(159), d: Float32Array.of(0, -0.004, 0) })
    const weights = Float32Array.of(0.3, 0.7)
    const shown = landmarkMotion(rig, weights, new Float32Array(N * 3), new Float32Array(N * 3))
    const rows = lidClosureRows(rig)
    const closed = rows.Right[0] * weights[0] + rows.Right[1] * weights[1]
    expect(closed).toBeGreaterThan(0)
    expect(closed).toBeCloseTo(lidClosure(rig, shown, 'Right'), 5)
    expect(rows.Left[1]).toBe(0)
  })

  it('눈을 좁히는 표정은 눈이 다 감긴 것보다 더 닫지 않는다', () => {
    // 점수 1에서 눈 틈의 4배를 닫는 표정(과장) → 눈이 떠 있을 때 1/4까지만 얹는다
    const native = {
      native: { browDownLeft: b64(Float32Array.of(0.8)) },
      native_lid: { browDownLeft: { Left: 4 } },
    }
    expect(run(0, 0, { browDownLeft: 1 }, native).frame.weights[0]).toBeCloseTo(0.2, 2)
  })
})

describe('미간 주름', () => {
  it('얕은 찡그림에는 그리지 않고 세게 찡그릴수록 부드럽게 깊어진다', () => {
    expect(frownWrinkle(0)).toBe(0)
    expect(frownWrinkle(0.55)).toBe(0)
    expect(frownWrinkle(0.775)).toBeCloseTo(0.5)
    expect(frownWrinkle(1)).toBe(1)
  })

  it('살짝 찡그리거나 눈을 감을 때 오르는 점수로는 주름이 없고 세게 찡그리면 다 그린다', () => {
    // 눈썹 내림 점수 0.6이 다 찡그린 것(SCORE_FULL). 0.3 = 눈만 감아도 나오는 점수(녹화 상위 10 %)
    expect(run(0, 0, { browDownLeft: 0.3, browDownRight: 0.3 }).frame.wrinkle?.[0]).toBe(0)
    expect(run(0, 0, { browDownLeft: 0.6, browDownRight: 0.6 }).frame.wrinkle?.[0]).toBeCloseTo(
      1,
      2,
    )
  })

  it('주름은 점수가 확 바뀌어도 한 프레임에 생기지 않고 약 0.3초에 걸쳐 생기고 사라진다', () => {
    const rig = tinyRig()
    if (!rig) throw Error('rig')
    const solver = createExpressionSolver(rig)
    const scores = (score: number) => [
      { categoryName: 'browDownLeft', score },
      { categoryName: 'browDownRight', score },
    ]
    let t = 0
    const step = (score: number) =>
      solver.step(points(rig), 1, 1, scores(score), (t += 1 / 30))?.wrinkle?.[0] ?? NaN
    for (let i = 0; i < 21; i++) step(0)
    const rise = Array.from({ length: 9 }, () => step(0.6))
    expect(rise[0]).toBeGreaterThan(0.15)
    expect(rise[0]).toBeLessThan(0.35)
    expect(rise[8]).toBeGreaterThan(0.85)
    // 점수가 바로 0으로 돌아가도 주름은 한 프레임에 사라지지 않는다
    expect(step(0)).toBeGreaterThan(0.6)
  })
})

describe('눈 감김', () => {
  it('눈 감김은 0.8이면 다 감긴 것으로 보여 주고, 아주 작은 값은 버린다', () => {
    expect(blinkAmount(0.8)).toBe(1)
    expect(blinkAmount(0.05)).toBe(0)
    expect(blinkAmount(0.425)).toBeCloseTo(0.5)
  })
})
