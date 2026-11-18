/**
 * 웹캠 얼굴 점 → 표정 한 프레임(GNM 가중치, 시선, 머리 회전).
 *
 * 1. 머리 움직임 제거: 단단한 점들로 현재 얼굴을 무표정 얼굴에 강체 정합(Horn). 처음 20프레임 평균이 무표정이다.
 * 2. 표정 = 정합 뒤 남은 얼굴 점 움직임. 아주 작은 움직임은 잡음으로 보고 버린다. 고개를 돌릴수록 이 값을 믿지 않는다
 *    (화면 좌표 + 약한 깊이라 돌린 머리는 강체가 아니다).
 * 3. 표정 점수 52개가 얼굴 점이 못 보는 것을 채운다: 고개를 돌린 만큼 점수 움직임이 대신하고, 눈 감김·인상처럼
 *    얼굴 점이 약한 표정은 점수가 더 크다고 할 때 그 차이만 더한다.
 * 4. 모두 얼굴 점 움직임으로 합친 뒤 한 번 푼다(가중치 = P · 움직임). 직접 정의한 표정(`expr.native`)은 GNM
 *    가중치를 모자란 만큼 더한다.
 * 5. 눈 감김은 마지막에 모델 눈이 실제로 감긴 정도를 재서 모자란 만큼 눈 감기 형상으로 채운다(blink.ts).
 */
import {
  landmarkMotion,
  lidClosure,
  lidClosureRows,
  limitWeights,
  SIDES,
  solveWeights,
  type ExpressionRig,
  type Side,
} from './rig'
import { blinkAmount, buildBlinkShapes } from './blink'

const N = 468
/**
 * 머리 움직임을 재는 점. 얼굴 윤곽 점은 쓰지 않는다: MediaPipe의 윤곽 점은 피부에 붙은 점이 아니라 보이는 윤곽을
 * 따라가서 고개를 돌리면 얼굴 위를 미끄러진다. 넣었을 때는 20° 돌린 고개를 6.6°로 재고 나머지를 표정으로 풀어
 * 얼굴이 일그러졌다(합성 시험, 2026-11-12). 이마 가운데·콧대·코끝·눈꼬리·콧볼 밑은 피부에 붙어 있다.
 * 풀이 행렬(rig P)도 윤곽 점을 0으로 두고 만든다(tools/rig_expr_upgrade.py).
 */
const STABLE = [151, 9, 8, 108, 337, 168, 6, 197, 195, 5, 4, 133, 362, 33, 263, 98, 327]
const ALL = Array.from({ length: N }, (_, i) => i)
/** 고개 각도(도): 여기까지 표정 100%, 여기부터 0% */
const POSE_FULL = 12
const POSE_NONE = 35
/** 시선 점수 1 = 이 각도(도) */
const GAZE_H = 30
const GAZE_V = 22

export interface TrackedPoint {
  x: number
  y: number
  z: number
}
export interface Score {
  categoryName: string
  score: number
}
export interface ExpressionFrame {
  weights: Float32Array
  /** [yaw, pitch] 라디안. yaw + = 사람 기준 왼쪽 */
  gaze: { L: [number, number]; R: [number, number] } | null
  /** 머리 회전 쿼터니언 [x, y, z, w] (GLB 좌표) */
  head: [number, number, number, number]
  /** 무표정 대비 고개 각도(도)와, 그 각도에서 얼굴 점 표정을 믿는 비율(0~1) */
  poseDeg: number
  poseGain: number
  /** 주름 음영 세기 0~1: [찡그림(미간), 눈썹 올림(이마), 코 찡그림(콧등 옆)]. 표정 점수에서 온다(없으면 주름 없음) */
  wrinkle?: [number, number, number]
}

interface Similarity {
  s: number
  R: number[][]
  t: number[]
}

/** B ≈ s R A + t (Horn 쿼터니언 방법) */
function horn(A: Float32Array, B: Float32Array, idx: readonly number[]): Similarity {
  const n = idx.length
  const ca = [0, 0, 0]
  const cb = [0, 0, 0]
  for (const i of idx)
    for (let k = 0; k < 3; k++) {
      ca[k] += A[3 * i + k] / n
      cb[k] += B[3 * i + k] / n
    }
  const S = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  let sa = 0
  let sb = 0
  for (const i of idx) {
    const a = [A[3 * i] - ca[0], A[3 * i + 1] - ca[1], A[3 * i + 2] - ca[2]]
    const b = [B[3 * i] - cb[0], B[3 * i + 1] - cb[1], B[3 * i + 2] - cb[2]]
    sa += a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
    sb += b[0] * b[0] + b[1] * b[1] + b[2] * b[2]
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c]
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S
  const M = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]
  let q = [1, 0, 0, 0]
  const shift =
    Math.abs(xx) +
    Math.abs(yy) +
    Math.abs(zz) +
    Math.abs(xy) +
    Math.abs(xz) +
    Math.abs(yz) +
    Math.abs(yx) +
    Math.abs(zx) +
    Math.abs(zy) +
    1e-9
  for (let it = 0; it < 60; it++) {
    const v = [0, 0, 0, 0]
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) v[r] += (M[r][c] + (r === c ? shift : 0)) * q[c]
    const len = Math.hypot(...v)
    q = v.map((value) => value / len)
  }
  const [w, x, y, z] = q
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ]
  const s = Math.sqrt(sb / sa)
  return {
    s,
    R,
    t: [0, 1, 2].map((k) => cb[k] - s * (R[k][0] * ca[0] + R[k][1] * ca[1] + R[k][2] * ca[2])),
  }
}

function transform(T: Similarity, A: Float32Array): Float32Array {
  const out = new Float32Array(A.length)
  for (let i = 0; i < N; i++) {
    const a = A[3 * i]
    const b = A[3 * i + 1]
    const c = A[3 * i + 2]
    for (let k = 0; k < 3; k++)
      out[3 * i + k] = T.s * (T.R[k][0] * a + T.R[k][1] * b + T.R[k][2] * c) + T.t[k]
  }
  return out
}

/** One-Euro 필터(Casiez 외): 가만히 있을 때는 부드럽게, 움직일 때는 빠르게 */
function oneEuro(n: number, minCut: number, beta: number, dCut = 1) {
  const x = new Float32Array(n)
  const dx = new Float32Array(n)
  let t0 = 0
  let started = false
  const alpha = (cut: number, dt: number) => {
    const r = 2 * Math.PI * cut * dt
    return r / (r + 1)
  }
  return (v: Float32Array, t: number) => {
    if (!started) {
      x.set(v)
      started = true
      t0 = t
      return x
    }
    const dt = Math.max(1e-3, t - t0)
    t0 = t
    const ad = alpha(dCut, dt)
    for (let i = 0; i < n; i++) {
      const d = (v[i] - x[i]) / dt
      dx[i] = ad * d + (1 - ad) * dx[i]
      const a = alpha(minCut + beta * Math.abs(dx[i]), dt)
      x[i] = a * v[i] + (1 - a) * x[i]
    }
    return x
  }
}

const mul3 = (A: number[][], B: number[][]) =>
  A.map((row) => [0, 1, 2].map((c) => row[0] * B[0][c] + row[1] * B[1][c] + row[2] * B[2][c]))
const transpose = (A: number[][]) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => A[c][r]))

function quaternion(M: number[][]): [number, number, number, number] {
  const trace = M[0][0] + M[1][1] + M[2][2]
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [(M[2][1] - M[1][2]) * s, (M[0][2] - M[2][0]) * s, (M[1][0] - M[0][1]) * s, 0.25 / s]
  }
  if (M[0][0] > M[1][1] && M[0][0] > M[2][2]) {
    const s = 2 * Math.sqrt(1 + M[0][0] - M[1][1] - M[2][2])
    return [0.25 * s, (M[0][1] + M[1][0]) / s, (M[0][2] + M[2][0]) / s, (M[2][1] - M[1][2]) / s]
  }
  if (M[1][1] > M[2][2]) {
    const s = 2 * Math.sqrt(1 + M[1][1] - M[0][0] - M[2][2])
    return [(M[0][1] + M[1][0]) / s, 0.25 * s, (M[1][2] + M[2][1]) / s, (M[0][2] - M[2][0]) / s]
  }
  const s = 2 * Math.sqrt(1 + M[2][2] - M[0][0] - M[1][1])
  return [(M[0][2] + M[2][0]) / s, (M[1][2] + M[2][1]) / s, 0.25 * s, (M[1][0] - M[0][1]) / s]
}

/** 찡그림(편 눈썹 내림, 0~1) → 미간 주름 세기. FROWN_WRINKLE_ONSET 아래는 0, 그 위로 부드럽게 올라 1에서 다 그린다 */
export function frownWrinkle(down: number): number {
  const t = Math.min(1, Math.max(0, (down - FROWN_WRINKLE_ONSET) / (1 - FROWN_WRINKLE_ONSET)))
  return t * t * (3 - 2 * t)
}

/**
 * MediaPipe 표정 점수가 "끝까지 한 표정"에서 실제로 내는 값. 1까지 오르지 않는 점수는 이 값을 1로 보고 편다.
 * 눈 감김 0.62(이전부터), 눈썹 내림 0.6(만두 녹화 3건에서 세게 찡그릴 때 최대 0.60~0.69, 2026-11-14)
 */
const SCORE_FULL: Record<string, number> = { eyeBlink: 0.62, browDown: 0.6 }
/**
 * 미간 주름이 나타나기 시작하는 찡그림(눈썹 내림 점수를 SCORE_FULL로 편 값, 0~1). 미간 세로 주름은 눈썹 머리를 모으는
 * 근육을 세게 당길 때 접히는 골이라, 살짝 찡그리거나 집중할 때, 눈을 감을 때 같이 오르는 점수로는 생기지 않아야 한다.
 * 이 값까지는 그리지 않고 다 찡그렸을 때(1) 다 그린다. 점수에 그대로 비례시키면 얕은 표정에도 주름이 보였다(만두 11/15).
 * 눈썹 내림 점수는 눈만 감아도 오른다: 녹화 18건(11/14~15)에서 눈을 반 넘게 감은 프레임의 점수 상위 10 %가 0.31~0.33
 * (눈 뜨고 편할 때는 상위 1 %가 0.10), 세게 찡그린 프레임의 중앙값은 0.52다. 0.55(원래 점수 약 0.34)는 눈 감김이 만드는
 * 점수 위다. 0.4(원래 점수 약 0.25)는 눈을 감을 때 주름이 생겼다
 */
const FROWN_WRINKLE_ONSET = 0.55
/**
 * 주름 세기를 거르는 차단 주파수(Hz, 시간 상수 약 0.1초). 주름은 피부가 접히는 만큼 생기고 펴진다: 점수가 빨리 변할수록
 * 빨리 따라가게 하면(다른 표정 값처럼) 시작 기준을 넘나들 때 주름이 갑자기 생겼다 사라졌다
 */
const WRINKLE_CUT = 1.5
/** 이마 주름: 눈썹 올림 점수(무표정을 뺀 값)가 이만큼이면 주름을 다 그린다(녹화 3건 최대 0.49~0.70) */
const RAISE_FULL = 0.5
/** 콧볼 점(쪽마다, 사람 기준) */
const WING_SIDES = { Right: [64, 48], Left: [294, 278] } as const
/** 입꼬리 점 */
const MOUTH_CORNERS = { Right: 61, Left: 291 } as const
/**
 * 코 찡그림을 콧볼 점으로 읽을 때 버리는 몫(그 표정의 콧볼 올라감 대비). MediaPipe 코 찡그림 점수는 녹화 5건 내내 0이라
 * 콧볼 점을 쓴다. 무표정 구간의 콧볼 흔들림이 눈 사이 거리의 약 0.5 %, GNM 코 찡그림 포즈의 콧볼 올라감이 2.1~2.9 %다
 * (만두 녹화 11/14, dev-706344da·0e91d7f1) → 그 1/5은 떨림으로 본다
 */
const SNEER_NOISE = 0.2

/** 무반응 구간(눈 사이 거리 대비): 이보다 작은 얼굴 점 움직임은 떨림으로 보고 버린다 */
const DEAD_ZONE = 0.012
/** 처음 이만큼의 프레임 평균을 무표정으로 잡는다 */
const CALIBRATION_FRAMES = 20

/** 프레임 사이 잡음을 거르는 필터들. 무표정을 다시 잡을 때 함께 새로 만든다 */
function createFilters(nativeCount: number) {
  return {
    motion: oneEuro(N * 3, 1.0, 6.0),
    pose: oneEuro(4, 1.0, 1.5),
    gaze: oneEuro(4, 1.5, 3.0),
    native: oneEuro(Math.max(1, nativeCount), 1.5, 4.0),
    /** 주름 세기 [미간, 이마, 콧등 옆]: 속도에 따라 빨라지지 않는 일정한 거르기 */
    wrinkle: oneEuro(3, WRINKLE_CUT, 0),
    /** 눈 감김 목표 [왼눈, 오른눈] */
    blink: oneEuro(2, 1.5, 4.0),
  }
}

export function createExpressionSolver(rig: ExpressionRig) {
  const dead = DEAD_ZONE * rig.iod
  const up = rig.axes.up
  const nativeNames = Object.keys(rig.native)

  /** 얼굴 점 i의 움직임을 축 방향으로 잰 양(눈 사이 거리 대비) */
  const along = (motion: ArrayLike<number>, i: number, axis: readonly number[]) =>
    (motion[3 * i] * axis[0] + motion[3 * i + 1] * axis[1] + motion[3 * i + 2] * axis[2]) / rig.iod
  const meanUp = (motion: ArrayLike<number>, points: readonly number[]) =>
    points.reduce((sum, i) => sum + along(motion, i, up), 0) / points.length

  /** 각 쪽 코 찡그림 포즈(점수 1)가 그 쪽 콧볼 점을 올리는 양 */
  const sneerRise: Record<Side, number> = { Left: 0, Right: 0 }
  {
    const vertex = new Float32Array(rig.nbase * 3)
    const landmarks = new Float32Array(N * 3)
    for (const side of SIDES) {
      const pose = rig.native[`noseSneer${side}`]
      if (pose)
        sneerRise[side] = meanUp(landmarkMotion(rig, pose, vertex, landmarks), WING_SIDES[side])
    }
  }

  /** 눈 감기 형상(쪽마다)과, 가중치로 모델 눈이 감긴 정도를 재는 행 */
  const blinkShapes = buildBlinkShapes(rig)
  const lidRows = lidClosureRows(rig)

  let neutral: Float32Array | null = null
  let averaged = 0
  let calib: Similarity | null = null
  let neutralScores: Record<string, number> | null = null
  let gaze0: Record<string, number> | null = null
  let headQ: [number, number, number, number] | null = null
  let filters = createFilters(nativeNames.length)

  function reset() {
    neutral = null
    averaged = 0
    calib = null
    neutralScores = null
    gaze0 = null
    headQ = null
    filters = createFilters(nativeNames.length)
  }

  /** 무표정 때 점수를 뺀 값. 좌우는 찍힌 사람 기준이다 */
  function scoreValues(scores: readonly Score[]): Record<string, number> {
    neutralScores ??= Object.fromEntries(scores.map((c) => [c.categoryName, c.score]))
    const out: Record<string, number> = {}
    for (const c of scores) {
      const n0 = neutralScores[c.categoryName] ?? 0
      const full = Object.entries(SCORE_FULL).find(([prefix]) => c.categoryName.startsWith(prefix))
      out[c.categoryName] = full
        ? Math.min(1, Math.max(0, (c.score - n0) / Math.max(full[1] - n0, 0.25)))
        : Math.max(0, c.score - 0.7 * n0)
    }
    return out
  }

  /** 얼굴 점 움직임(걸러 내기 전)에서 잰 콧볼·입꼬리 올라감. MediaPipe가 내지 않는 코 찡그림을 읽는 데 쓴다 */
  function measure(moved: ArrayLike<number>) {
    return {
      wingLift: {
        Left: meanUp(moved, WING_SIDES.Left),
        Right: meanUp(moved, WING_SIDES.Right),
      },
      cornerLift: {
        Left: along(moved, MOUTH_CORNERS.Left, up),
        Right: along(moved, MOUTH_CORNERS.Right, up),
      },
    }
  }

  /**
   * 코 찡그림 점수가 없으면(MediaPipe가 내지 않는다) 콧볼 점이 올라간 양으로 대신한다: 미소가 올린 몫(입꼬리가 오른
   * 양 × rig의 미소 콧볼 비율)을 빼고 그 쪽 코 찡그림 포즈의 올라감으로 나눈다. 점수가 있으면 둘 중 큰 쪽.
   * 미소 점수 × 손 정의 미소 목표로 빼던 때는 그 목표가 콧볼을 전혀 올리지 않아 웃을 때마다 코 찡그림으로 읽혔다
   * (만두 녹화 11/14: 미소 0.87에서 콧볼 2.5 %)
   */
  function sneerFromWings(
    sc: Record<string, number>,
    { wingLift, cornerLift }: ReturnType<typeof measure>,
  ) {
    for (const side of SIDES) {
      if (sneerRise[side] < 0.005) continue
      const smile = Math.max(0, cornerLift[side]) * (rig.smileWingRatio[side] ?? 0)
      const own = (wingLift[side] - smile) / sneerRise[side]
      const amount = Math.min(1, Math.max(0, (own - SNEER_NOISE) / (1 - SNEER_NOISE)))
      sc[`noseSneer${side}`] = Math.max(sc[`noseSneer${side}`] ?? 0, amount)
    }
  }

  /** 얼굴 점 풀이에 앞서 점수가 얼굴 점이 못 보는 몫을 얼굴 점 움직임으로 더한다(`raw`를 고친다) */
  function addScores(raw: Float32Array, sc: Record<string, number>, poseGain: number) {
    const add = (motion: Float32Array, amount: number) => {
      for (let i = 0; i < raw.length; i++) raw[i] += amount * motion[i]
    }
    if (poseGain < 1)
      for (const [name, motion] of Object.entries(rig.named)) {
        const amount = (sc[name] ?? 0) * (1 - poseGain)
        if (amount > 0.02) add(motion, amount)
      }
    for (const [name, gain] of Object.entries(rig.namedGain)) {
      const motion = rig.named[name]
      const score = sc[name] ?? 0
      if (!motion || score < 0.08) continue
      let rm = 0
      let mm = 0
      for (let i = 0; i < raw.length; i++) {
        rm += raw[i] * motion[i]
        mm += motion[i] * motion[i]
      }
      // 풀이는 얼굴 점이 보여 준 부분도 1/gain만 전달한다 → 합쳐서 점수만큼 나오도록 (점수 × gain − 이미 보인 양)을 더한다.
      // 부족분에만 gain을 곱하면 얼굴 점이 많이 보여 줄수록 덜 전달됐다(눈 감김 84~93 %, 2026-11-14)
      const amount = score * gain - Math.min(1, Math.max(0, rm / (mm + 1e-20)))
      if (amount > 0) add(motion, amount)
    }
  }

  /**
   * 각 눈을 얼마나 감아 보여 줄지(0~1): 점수와 얼굴 점(눈꺼풀 사이 거리) 중 큰 쪽. 점수만 보면 윙크처럼 점수가 덜
   * 오르는 감김(녹화 11/14: 윙크한 눈 0.46, 끝까지 감아도 0.76)이 반쯤만 감겼다
   */
  function blinkTargets(
    sc: Record<string, number> | null,
    lids: [number, number],
    time: number,
  ): Float32Array {
    return filters.blink(
      Float32Array.from(SIDES, (side, i) =>
        blinkAmount(Math.max(sc?.[`eyeBlink${side}`] ?? 0, lids[i])),
      ),
      time,
    )
  }

  /**
   * 모델 눈이 목표만큼 감기도록 모자란 만큼 눈 감기 형상을 더한다(`weights`를 고친다). 한계를 적용한 **뒤에** 잰다:
   * 풀이 전에 눈 감김을 얼굴 점 움직임으로 섞던 때는 다른 성분이 한계에 닿으면 눈 감김도 같은 비율로 줄었다
   * (만두 기록 11/15: 눈 감은 48프레임 모두 한계에 닿음. 입을 크게 벌린 채 감으면 0.34만 감김)
   */
  function closeEyes(weights: Float32Array, target: Float32Array) {
    SIDES.forEach((side, i) => {
      const shape = blinkShapes[side]
      if (!shape || shape.closes < 0.05) return
      let shown = 0
      for (let k = 0; k < weights.length; k++) shown += lidRows[side][k] * weights[k]
      const missing = (target[i] - shown) / shape.closes
      if (missing <= 0) return
      for (let k = 0; k < weights.length; k++)
        if (shape.weights[k]) weights[k] += missing * shape.weights[k]
    })
    return weights
  }

  /**
   * 얼굴 점 풀이: 점수 보조를 얼굴 점 움직임에 더해 한 번 풀고, 직접 정의한 표정을 모자란 만큼 얹은 뒤, 눈을 목표만큼
   * 감긴다
   */
  function solveLandmarks(
    raw: Float32Array,
    sc: Record<string, number> | null,
    lids: [number, number],
    poseGain: number,
    time: number,
  ): Float32Array {
    const blink = blinkTargets(sc, lids, time)
    if (sc) addScores(raw, sc, poseGain)
    const weights = solveWeights(rig, filters.motion(raw, time))
    if (!sc || !nativeNames.length) return closeEyes(weights, blink)
    const f = filters.native(new Float32Array(nativeNames.map((name) => sc[name] ?? 0)), time)
    nativeNames.forEach((name, i) => {
      if (f[i] <= 0.03) return
      const w = rig.native[name]
      // 얼굴 점이 이미 만든 만큼은 빼고 얹는다(점수와 얼굴 점이 같은 표정을 두 번 만들지 않게)
      let dot = 0
      let size = 0
      for (let j = 0; j < weights.length; j++) {
        dot += weights[j] * w[j]
        size += w[j] * w[j]
      }
      let missing = f[i] - Math.min(1, Math.max(0, dot / (size + 1e-20)))
      // 이 표정이 눈을 좁히는 만큼, 눈 감김과 합쳐 다 감긴 것을 넘지 않게 한다
      SIDES.forEach((side, s) => {
        const share = rig.nativeLid[name]?.[side] ?? 0
        const closed = Math.max(lidClosure(rig, raw, side), blink[s])
        if (share > 0.02) missing = Math.min(missing, (1 - closed) / share)
      })
      if (missing <= 0) return
      for (let j = 0; j < weights.length; j++) if (w[j]) weights[j] += missing * w[j]
    })
    return closeEyes(limitWeights(weights, rig.components.clip), blink)
  }

  function gaze(scores: readonly Score[], time: number): ExpressionFrame['gaze'] {
    const sc: Record<string, number> = {}
    for (const c of scores) if (c.categoryName.startsWith('eyeLook')) sc[c.categoryName] = c.score
    gaze0 ??= { ...sc }
    const g = (name: string) => (sc[name] ?? 0) - (gaze0?.[name] ?? 0)
    const rad = Math.PI / 180
    const f = filters.gaze(
      new Float32Array([
        (g('eyeLookOutLeft') - g('eyeLookInLeft')) * GAZE_H * rad,
        (g('eyeLookUpLeft') - g('eyeLookDownLeft')) * GAZE_V * rad,
        (g('eyeLookInRight') - g('eyeLookOutRight')) * GAZE_H * rad,
        (g('eyeLookUpRight') - g('eyeLookDownRight')) * GAZE_V * rad,
      ]),
      time,
    )
    return { L: [f[0], f[1]], R: [f[2], f[3]] }
  }

  /** 무표정 대비 머리 회전(모델 좌표 Rc · Rrelᵀ · Rcᵀ)을 걸러 쿼터니언으로 */
  function headRotation(T: Similarity, C: Similarity, time: number) {
    const q = quaternion(mul3(mul3(C.R, transpose(T.R)), transpose(C.R)))
    if (headQ && q[0] * headQ[0] + q[1] * headQ[1] + q[2] * headQ[2] + q[3] * headQ[3] < 0)
      for (let k = 0; k < 4; k++) q[k] = -q[k]
    const fq = filters.pose(new Float32Array(q), time)
    const len = Math.hypot(fq[0], fq[1], fq[2], fq[3]) || 1
    headQ = [fq[0] / len, fq[1] / len, fq[2] / len, fq[3] / len]
    return headQ
  }

  /** 주름 음영 세기: [찡그림(미간), 눈썹 올림(이마), 코 찡그림(콧등 옆)] */
  function wrinkleOf(sc: Record<string, number>, time: number): [number, number, number] {
    // 시작 기준을 먼저 적용한 세기를 거른다: 기준을 넘나드는 떨림이 주름을 깜빡이게 하지 않는다
    const f = filters.wrinkle(
      Float32Array.of(
        frownWrinkle(((sc.browDownLeft ?? 0) + (sc.browDownRight ?? 0)) / 2),
        Math.min(
          1,
          Math.max(
            sc.browInnerUp ?? 0,
            ((sc.browOuterUpLeft ?? 0) + (sc.browOuterUpRight ?? 0)) / 2,
          ) / RAISE_FULL,
        ),
        Math.max(sc.noseSneerLeft ?? 0, sc.noseSneerRight ?? 0),
      ),
      time,
    )
    return [Math.max(0, f[0]), Math.max(0, f[1]), Math.max(0, f[2])]
  }

  /**
   * 한 프레임. 무표정 기준을 잡는 동안(처음 CALIBRATION_FRAMES프레임)은 null.
   * `points`는 MediaPipe 얼굴 점(0~1 정규화), `width`·`height`는 영상 크기, `time`은 초.
   */
  function step(
    points: readonly TrackedPoint[],
    width: number,
    height: number,
    scores: readonly Score[] | null,
    time: number,
  ): ExpressionFrame | null {
    const current = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      current[3 * i] = points[i].x * width
      current[3 * i + 1] = points[i].y * height
      current[3 * i + 2] = points[i].z * width
    }
    if (!neutral) {
      neutral = current
      averaged = 1
      return null
    }
    // 1. 머리 움직임 제거
    const T = horn(current, neutral, STABLE)
    const aligned = transform(T, current)
    if (averaged < CALIBRATION_FRAMES) {
      for (let i = 0; i < aligned.length; i++)
        neutral[i] = (neutral[i] * averaged + aligned[i]) / (averaged + 1)
      if (++averaged === CALIBRATION_FRAMES) calib = horn(neutral, rig.lmk, ALL)
      return null
    }
    const C = calib as Similarity
    const poseDeg =
      (Math.acos(Math.max(-1, Math.min(1, (T.R[0][0] + T.R[1][1] + T.R[2][2] - 1) / 2))) * 180) /
      Math.PI
    const fade = Math.min(1, Math.max(0, (poseDeg - POSE_FULL) / (POSE_NONE - POSE_FULL)))
    const poseGain = 1 - fade * fade * (3 - 2 * fade)
    // 2. 표정 = 무표정에서 움직인 양(모델 좌표). 작은 움직임은 버리고, 고개를 돌린 만큼 덜 믿는다
    const rest = neutral
    const moved = new Float64Array(N * 3)
    const raw = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const d = [0, 1, 2].map((k) => aligned[3 * i + k] - rest[3 * i + k])
      for (let k = 0; k < 3; k++)
        moved[3 * i + k] = C.s * (C.R[k][0] * d[0] + C.R[k][1] * d[1] + C.R[k][2] * d[2])
      const size = Math.hypot(moved[3 * i], moved[3 * i + 1], moved[3 * i + 2])
      const keep = (size < dead ? 0 : size < 2 * dead ? (size - dead) / dead : 1) * poseGain
      for (let k = 0; k < 3; k++) raw[3 * i + k] = moved[3 * i + k] * keep
    }
    const parts = measure(moved)
    const lids: [number, number] = [lidClosure(rig, raw, 'Left'), lidClosure(rig, raw, 'Right')]
    // 3·4. 점수로 보충해 가중치를 만든다
    const sc = scores ? scoreValues(scores) : null
    if (sc) sneerFromWings(sc, parts)
    return {
      weights: solveLandmarks(raw, sc, lids, poseGain, time),
      gaze: scores ? gaze(scores, time) : null,
      head: headRotation(T, C, time),
      poseDeg,
      poseGain,
      wrinkle: sc ? wrinkleOf(sc, time) : undefined,
    }
  }

  return {
    step,
    reset,
    get calibrating() {
      return averaged < CALIBRATION_FRAMES
    },
  }
}
