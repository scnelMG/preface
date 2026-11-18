/**
 * 표정 트래킹용 리그(rig.json의 표정 부분) 읽기와 계산.
 *
 * 리그는 재구성 파이프라인이 만든다(`tools/glb_rig.py`, 표정 옵션은 `tools/rig_expr_upgrade.py`). 좌표는 GLB 좌표,
 * 정점 번호는 GLB의 `_TEMPLATE_INDEX`다. 표정 옵션(`options`)이 없는 리그는 표정 트래킹에 쓰지 않는다.
 *
 * - `gnmx`: GNM 표정 성분(정점 변위)과 풀이 행렬 P. 가중치 = P · 얼굴 점 움직임.
 * - `rig.shapes`: 이름 붙은 표정의 얼굴 점 움직임을 얻는 데만 쓴다(표정 점수 → 얼굴 점 움직임 → 같은 풀이).
 * - `expr.native`: GNM 가중치로 직접 정의한 표정(입술 내밀기).
 * - `mouth.placed`: 치아·잇몸·혀의 무표정 위치(입 안에 맞게 다시 놓은 것).
 * - `head`: 머리 관절 가중치와 위치(상체는 두고 머리만 돌린다).
 */

const LANDMARKS = 468

/** 좌우(찍힌 사람 기준). MediaPipe 표정 점수 이름의 끝과 같다 */
export const SIDES = ['Left', 'Right'] as const
export type Side = (typeof SIDES)[number]

interface Shape {
  idx: Int32Array
  d: Float32Array
}

export interface ExpressionRig {
  nbase: number
  iod: number
  axes: { right: number[]; up: number[]; fwd: number[] }
  /** 얼굴 점 468개의 템플릿 정점 번호와 무표정 위치(GLB 좌표) */
  lid: number[]
  lmk: Float32Array
  components: { names: string[]; shapes: Shape[]; P: Float32Array; clip: number }
  /** 이름 붙은 표정 → 얼굴 점 움직임(468×3) */
  named: Record<string, Float32Array>
  /** 이름 붙은 표정 → GNM 가중치(성분 수) */
  native: Record<string, Float32Array>
  /** 직접 정의한 표정이 점수 1에서 각 눈의 눈 틈을 닫는 비율(없으면 0). 눈꺼풀이 다 감긴 것보다 더 닫히지 않게 한다 */
  nativeLid: Record<string, Partial<Record<Side, number>>>
  /** 템플릿 정점마다 좌우 짝 정점(없으면 null). 표정을 거울처럼 뒤집어 보여 줄 때 쓴다 */
  mirror: Int32Array | null
  /** 미소가 입꼬리를 올릴 때 콧볼도 그 몇 배 오르는지(GNM 'happy', 쪽마다). 콧볼로 코 찡그림을 읽을 때 미소 몫을 뺀다 */
  smileWingRatio: Partial<Record<Side, number>>
  namedGain: Record<string, number>
  eyes: { L: number[]; R: number[] } | null
  head: { w: Float32Array; pivot: number[] } | null
  placed: { at: Map<number, number>; pos: Float32Array; rgb: Float32Array | null } | null
  /**
   * 입술과 치아의 접촉: 피부 정점(`v`)마다 마주 보는 치아·잇몸 정점 후보(`cand`, 정점당 `ncand`개, `hard` 안의 자리 번호)와
   * 치아 법선 방향으로 지켜야 할 거리(`c`). `hard`는 치아·잇몸 템플릿 정점, `normal`은 그 법선
   */
  contact: {
    v: Int32Array
    cand: Int32Array
    c: Float32Array
    ncand: number
    reach: number
    hard: Int32Array
    normal: Float32Array
    /** 접촉 정점끼리의 피부 이웃(CSR): 밀려난 정점이 이웃을 함께 데려가 입술이 매끈하게 부푼다 */
    neighborStart: Int32Array
    neighbors: Int32Array
  } | null
}

function bytes(text: string): ArrayBuffer {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out.buffer
}
const f32 = (text: string) => new Float32Array(bytes(text))
const i32 = (text: string) => new Int32Array(bytes(text))
const i16 = (text: string) => new Int16Array(bytes(text))

/* eslint-disable @typescript-eslint/no-explicit-any -- rig.json은 파이프라인이 쓰는 느슨한 JSON이다. 여기서만 읽고 타입을 붙인다 */
export function parseExpressionRig(json: any): ExpressionRig | null {
  if (json?.format !== 'live-mirror-rig' || !json.options || !json.gnmx || !json.expr) return null
  const lid: number[] = json.expr.lid
  if (!Array.isArray(lid) || lid.length !== LANDMARKS) return null
  const names: string[] = json.gnmx.names
  const shapes: Shape[] = names.map((name) => {
    const shape = json.gnmx.shapes[name]
    const q = i16(shape.q)
    const d = new Float32Array(q.length)
    for (let i = 0; i < q.length; i++) d[i] = q[i] * shape.sc
    return { idx: i32(shape.idx), d }
  })
  const named: Record<string, Float32Array> = {}
  for (const [name, shape] of Object.entries<any>(json.rig?.shapes ?? {})) {
    if (name.startsWith('edit_')) continue
    const idx = i32(shape.idx)
    const d = f32(shape.d)
    const at = new Map<number, number>()
    for (let j = 0; j < idx.length; j++) at.set(idx[j], j)
    const motion = new Float32Array(LANDMARKS * 3)
    for (let i = 0; i < LANDMARKS; i++) {
      const j = at.get(lid[i])
      if (j === undefined) continue
      motion.set(d.subarray(3 * j, 3 * j + 3), 3 * i)
    }
    named[name] = motion
  }
  for (const [name, text] of Object.entries<string>(json.expr.named_extra ?? {}))
    named[name] = f32(text)
  const native: Record<string, Float32Array> = {}
  for (const [name, text] of Object.entries<string>(json.expr.native ?? {}))
    native[name] = f32(text)
  const eyes = json.rig?.eyes
  const placed = json.mouth?.placed
  const contact = json.mouth?.contact
  return {
    nbase: json.expr.nbase,
    iod: json.iod,
    axes: json.axes,
    lid,
    lmk: f32(json.expr.lmk),
    components: { names, shapes, P: f32(json.gnmx.P), clip: json.gnmx.clip ?? 4 },
    named,
    native,
    nativeLid: json.expr.native_lid ?? {},
    mirror: json.expr.mirror ? i32(json.expr.mirror) : null,
    smileWingRatio: json.options.smile_wing_ratio ?? {},
    namedGain: json.options.named_gain ?? {},
    eyes: eyes?.L && eyes?.R ? { L: eyes.L.center, R: eyes.R.center } : null,
    head: json.head ? { w: f32(json.head.w), pivot: json.head.pivot } : null,
    placed: placed
      ? {
          at: new Map(Array.from(i32(placed.idx), (vertex, i) => [vertex, i])),
          pos: f32(placed.pos),
          rgb: placed.rgb ? f32(placed.rgb) : null,
        }
      : null,
    contact: contact
      ? {
          v: i32(contact.v),
          // 후보를 템플릿 정점 번호에서 `hard` 안의 자리 번호로 바꿔 둔다
          cand: (() => {
            const slot = new Map(Array.from(i32(contact.hard), (vertex, i) => [vertex, i]))
            return Int32Array.from(i32(contact.cand), (vertex) => slot.get(vertex) ?? -1)
          })(),
          c: f32(contact.c),
          ncand: contact.ncand,
          reach: contact.reach,
          hard: i32(contact.hard),
          normal: f32(contact.normal),
          neighborStart: i32(contact.nbr_ptr),
          neighbors: i32(contact.nbr),
        }
      : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function loadExpressionRig(
  url: string,
  signal?: AbortSignal,
): Promise<ExpressionRig | null> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error('rig load failed')
  return parseExpressionRig(await response.json())
}

/**
 * 가중치가 한계를 넘으면 **전체를 같은 비율로** 줄인다(제자리에서 고친다). 성분마다 따로 자르면 넘은 성분만 줄어 성분들의
 * 조합 = 표정 모양 자체가 바뀌었다: 녹화(11/14) 프레임의 19 %가 한계에 닿았고 그때 입 주변이 일그러질 수 있었다.
 * 같은 비율로 줄이면 표정은 조금 약해질 뿐 모양은 그대로다
 */
export function limitWeights(weights: Float32Array, clip: number): Float32Array {
  let peak = 0
  for (const w of weights) peak = Math.max(peak, Math.abs(w))
  if (peak > clip) {
    const scale = clip / peak
    for (let k = 0; k < weights.length; k++) weights[k] *= scale
  }
  return weights
}

/** 얼굴 점 움직임(468×3, GLB 좌표) → GNM 성분 가중치 */
export function solveWeights(rig: ExpressionRig, motion: Float32Array): Float32Array {
  const { P, clip, names } = rig.components
  const n = LANDMARKS * 3
  const out = new Float32Array(names.length)
  for (let k = 0; k < names.length; k++) {
    let w = 0
    const offset = k * n
    for (let j = 0; j < n; j++) w += P[offset + j] * motion[j]
    out[k] = w
  }
  return limitWeights(out, clip)
}

/** 눈꺼풀 위·아래 짝 얼굴 점(눈마다 셋, 좌우는 찍힌 사람 기준) */
const LID_PAIRS = {
  Left: [
    [386, 374],
    [385, 380],
    [387, 373],
  ],
  Right: [
    [159, 145],
    [158, 153],
    [160, 144],
  ],
} as const

/** 얼굴 점 움직임(468×3)이 그 눈의 눈 틈을 닫는 비율: 0 = 무표정 그대로, 1 = 다 감김 */
export function lidClosure(rig: ExpressionRig, motion: Float32Array, side: Side): number {
  const up = rig.axes.up
  let g0 = 0
  let g1 = 0
  for (const [u, l] of LID_PAIRS[side])
    for (let k = 0; k < 3; k++) {
      const d0 = (rig.lmk[3 * u + k] - rig.lmk[3 * l + k]) * up[k]
      g0 += d0
      g1 += d0 + (motion[3 * u + k] - motion[3 * l + k]) * up[k]
    }
  return Math.min(1, Math.max(0, 1 - g1 / g0))
}

/**
 * 성분마다 가중치 1이 각 눈의 눈 틈을 닫는 비율(부호 있음: 음수는 눈을 더 뜨게 한다). 눈 틈은 성분에 대해 선형이라
 * 모델 눈이 감긴 정도 = Σ 행 × 가중치다(`lidClosure`에서 0~1로 자르기 전 값). 프레임마다 변위를 풀지 않고 잰다
 */
export function lidClosureRows(rig: ExpressionRig): Record<Side, Float32Array> {
  const up = rig.axes.up
  const { shapes } = rig.components
  const rows = {} as Record<Side, Float32Array>
  for (const side of SIDES) {
    const row = new Float32Array(shapes.length)
    let g0 = 0
    // 템플릿 정점 → 눈 틈에 곱하는 부호(윗눈꺼풀 +, 아랫눈꺼풀 −)
    const sign = new Map<number, number>()
    for (const [u, l] of LID_PAIRS[side]) {
      for (let k = 0; k < 3; k++) g0 += (rig.lmk[3 * u + k] - rig.lmk[3 * l + k]) * up[k]
      sign.set(rig.lid[u], (sign.get(rig.lid[u]) ?? 0) + 1)
      sign.set(rig.lid[l], (sign.get(rig.lid[l]) ?? 0) - 1)
    }
    shapes.forEach(({ idx, d }, c) => {
      let gap = 0
      for (let j = 0; j < idx.length; j++) {
        const s = sign.get(idx[j])
        if (s) gap += s * (d[3 * j] * up[0] + d[3 * j + 1] * up[1] + d[3 * j + 2] * up[2])
      }
      row[c] = -gap / g0
    })
    rows[side] = row
  }
  return rows
}

/** 성분 가중치 → 템플릿 정점별 변위(nbase×3). `out`을 재사용한다 */
export function displacement(
  rig: ExpressionRig,
  weights: Float32Array,
  out: Float32Array,
): Float32Array {
  out.fill(0)
  const { shapes } = rig.components
  for (let k = 0; k < shapes.length; k++) {
    const w = weights[k]
    if (!w) continue
    const { idx, d } = shapes[k]
    for (let j = 0; j < idx.length; j++) {
      const v = 3 * idx[j]
      out[v] += w * d[3 * j]
      out[v + 1] += w * d[3 * j + 1]
      out[v + 2] += w * d[3 * j + 2]
    }
  }
  return out
}

/** 성분 가중치 → 얼굴 점 468개의 움직임(468×3)을 `out`에 쓴다. `vertex`(nbase×3)는 작업용 */
export function landmarkMotion(
  rig: ExpressionRig,
  weights: Float32Array,
  vertex: Float32Array,
  out: Float32Array,
): Float32Array {
  displacement(rig, weights, vertex)
  rig.lid.forEach((v, i) => out.set(vertex.subarray(3 * v, 3 * v + 3), 3 * i))
  return out
}
