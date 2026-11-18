/**
 * 헤어 GLB를 불러온 머리 위에 얹는 위치·크기(S15P31B204-699).
 *
 * 헤어는 GNM 평균 머리(`gnm-template-v2.npz`, m 단위·Y-up) 좌표로 만들었다. 앱의 머리 GLB(기본 모델·복원 모델)는
 * 크기는 같지만 원점이 달라(기본 여성 모델: y −26.7cm, z −2.7cm) 그대로 겹치면 헤어가 공중에 뜬다.
 *
 * 맞추는 방법은 두 가지다.
 * 1. `fitHairToLandmarks`(S15P31B204-714): 머리 피부의 `_TEMPLATE_INDEX`로 템플릿과 같은 자리의 점 9개(정수리·이마 라인
 *    가운데·이마 양 모서리·관자놀이·귀 위·뒤통수)를 찾아, 헤어를 만든 평균 머리의 같은 점들에 겹치도록 크기·위치·앞뒤 기울기를 푼다.
 *    이마 라인 가운데와 정수리에 무게를 더 준다. 복원 모델은 모두 GNM 위상이라(export_glb.py) 점 번호가 같은 해부학적 자리다.
 *    머리는 대머리로 복원되므로 실제 사람의 머리카락 시작선이 아니라 평균 머리의 이마 라인 자리를 그 얼굴에 옮긴 것이다.
 * 2. `fitHairToHead`: 점을 못 찾거나 결과가 이상하면 피부 경계 상자로 되돌린다. 좌우·앞뒤는 가운데, 위아래는 정수리,
 *    머리 폭 비율로 균일하게 키운다.
 *
 * 크기(S15P31B204-723): 복원 모델은 눈 사이를 63mm로 맞춰 내보내서 평균 머리(86mm)의 0.68~0.73배다. 크기 허용 범위를
 * 고정값(0.8~1.25배)으로 두면 복원 모델에서 결과를 버리고 1배로 씌워 헤어가 1.4배 컸다. 그래서 눈 사이 거리로 기대 크기를
 * 먼저 구하고(`expectedScale`) 그 0.8~1.25배를 허용한다.
 *
 * 헤어라인(S15P31B204-723): 모델링이 head.glb에 사람별 헤어라인을 담는다(S15P31B204-722, 피부 삼각형 기준 점).
 * 통째 맞춤 뒤 헤어 자신의 앞쪽 경계(catalog.ts `hairline`)가 그 사람 헤어라인과 어긋난 만큼, 헤어 앞부분만 부드럽게
 * 옮긴다(`hairlineAnchors` → `bendFront`). 같은 자리는 이마 펼친 지도의 각도로 찾는다(`foreheadAngle`).
 * 714의 이마 라인 점은 헤어마다 실제 경계와 6~16mm 달라 기준으로 쓰지 않는다. 헤어라인이 없는 모델이나 경계가 없는
 * 헤어는 이 단계를 건너뛴다.
 *
 * 머리 모양(S15P31B204-792): 통째 맞춤은 사람마다 볼·정수리·목이 평균 머리와 3~7mm 달라 구레나룻이 묻히고 정수리에
 * 구멍처럼 보이는 곳이 생기고 뒷머리가 떴다. 템플릿 피부 점마다 그 사람 머리에서 움직인 만큼을 부드럽게 펴 칸 격자로 만들고
 * (`skinShifts` → `skinShiftField`), 헤어 점을 가까운 두피 점의 움직임만큼 옮긴다(`followSkin`). 점마다 따로 밀면 튜브가
 * 납작해지지만 이웃 점이 같이 움직여 단면이 유지된다. 귀 둘레는 귀 점 평균 차이로 옮기고(`followEars`), 남은 작은 파고듦만
 * 피부 밖으로 민다(`pushOutOfSkin`). 템플릿 번호가 없는 모델은 이 단계를 건너뛴다.
 *
 * 긴 머리(S15P31B204-795): 어깨·가슴 피부(템플릿 높이 0.15m 아래)에는 묶지 않는다(`SKIN_FOLLOW_FROM_Y`). 상반신은 사람마다
 * 잘린 모양이 달라 긴 뒷머리가 각졌다. 볼륨이 크고 굴곡 있는 머리는 헤어 목록에서 `skinFollow: 'root'`로 두면 가닥마다
 * 뿌리만 두피를 따라가고 가닥 모양은 그대로 옮긴다(`followSkinByStrand`). 점마다 따라가면 옆모습 뒤통수가 울퉁불퉁했다.
 *
 * 뒷머리 등 맞추기(S15P31B204-805): 목 아래를 묶지 않으니 등이 평균보다 앞에 있는 사람은 긴 뒷머리가 등에서 1~3cm 떴다. 몸 둘레 칸마다
 * 몸과 가장 안쪽 헤어 사이 틈을 평균 머리와 그 사람에게서 재고(`backProfile`), 늘어난 만큼 그 칸의 헤어를 통째로 등 쪽으로
 * 옮긴다(`backSettleShift` → `settleOnBack`). 층 두께와 컬은 그대로 남고, 평균 머리와 같은 몸이면 아무것도 옮기지 않는다.
 */
export interface Box {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

/** 헤어를 만든 평균 머리의 피부 경계 상자 (gnm-template-v2.npz, components == 0) */
export const TEMPLATE_SKIN_BOX: Box = {
  min: [-0.1278, 0.0656, -0.0922],
  max: [0.1276, 0.4071, 0.1465],
}

export interface HairFit {
  scale: number
  position: [number, number, number]
  /** 앞뒤 기울기(x축 회전, 라디안). 양수면 앞이 올라간다(three.js 오른손 좌표) */
  rotationX: number
}

type Vec3 = readonly [number, number, number]

/**
 * 헤어를 맞출 템플릿 점. `vertex`는 GNM v2 템플릿 정점 번호, `at`은 그 점의 템플릿 좌표(m),
 * 이마 라인 점은 헤어 생성기의 머리카락 시작선(방위각별 높이) 위에서 골랐다.
 */
export const HAIR_LANDMARKS: readonly { name: string; vertex: number; at: Vec3; weight: number }[] =
  [
    { name: 'crown', vertex: 12398, at: [0, 0.4071, 0.0209], weight: 2 },
    { name: 'hairlineFront', vertex: 12355, at: [-0.0001, 0.3651, 0.1112], weight: 3 },
    { name: 'hairlineL', vertex: 2253, at: [0.0572, 0.3526, 0.0827], weight: 2 },
    { name: 'hairlineR', vertex: 8381, at: [-0.0574, 0.3527, 0.0826], weight: 2 },
    { name: 'templeL', vertex: 1684, at: [0.0738, 0.3087, 0.0509], weight: 1 },
    { name: 'templeR', vertex: 7812, at: [-0.0739, 0.3087, 0.0508], weight: 1 },
    { name: 'aboveEarL', vertex: 2635, at: [0.0774, 0.3093, 0.0122], weight: 1 },
    { name: 'aboveEarR', vertex: 8763, at: [-0.0775, 0.3093, 0.0121], weight: 1 },
    { name: 'occiput', vertex: 12456, at: [-0.0001, 0.3015, -0.0676], weight: 1 },
  ]

/** 템플릿의 두 눈 바깥 끝(MediaPipe 33·263) 정점 번호와 그 사이 거리(m, gnm-template-v2.npz) */
export const EYE_CORNERS = [7428, 1295] as const
export const TEMPLATE_EYE_DISTANCE = 0.0863
/** 눈 사이 거리로 맞춘 기대 크기에서 사람 사이 머리 크기가 벌어질 수 있는 범위 */
const SCALE_MIN = 0.8
const SCALE_MAX = 1.25

/** 머리의 기대 크기(평균 머리 대비) = 눈 사이 거리 비. 눈 점을 못 찾으면 1(기본 모델과 같은 크기로 본다) */
export function expectedScale(pointOf: (vertex: number) => Vec3 | null): number {
  const a = pointOf(EYE_CORNERS[0])
  const b = pointOf(EYE_CORNERS[1])
  if (!a || !b) return 1
  const ratio = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / TEMPLATE_EYE_DISTANCE
  return Number.isFinite(ratio) && ratio > 0.3 && ratio < 3 ? ratio : 1
}

const MAX_TILT = (12 * Math.PI) / 180
const TILT_STEP = (0.25 * Math.PI) / 180
/** 점들이 이보다 더 어긋나면(가중 RMS, m) 머리 모양이 템플릿과 너무 달라 믿지 않는다 */
const MAX_RMS = 0.012

/**
 * 템플릿 점 번호 → 머리 좌표를 받아 헤어 변환을 푼다. 점이 빠졌거나 결과가 이상하면 null(경계 상자로 되돌린다).
 * 기울기는 ±12°를 0.25° 간격으로 훑고, 각 기울기에서 크기·위치는 가중 최소제곱 닫힌 식으로 구한다.
 */
export function fitHairToLandmarks(pointOf: (vertex: number) => Vec3 | null): HairFit | null {
  const pairs: { p: Vec3; q: Vec3; w: number }[] = []
  for (const mark of HAIR_LANDMARKS) {
    const q = pointOf(mark.vertex)
    if (!q || !q.every(Number.isFinite)) return null
    pairs.push({ p: mark.at, q, w: mark.weight })
  }
  const total = pairs.reduce((sum, { w }) => sum + w, 0)
  const qMean = [0, 1, 2].map((k) => pairs.reduce((sum, { q, w }) => sum + q[k] * w, 0) / total)

  let best: (HairFit & { error: number }) | null = null
  for (let tilt = -MAX_TILT; tilt <= MAX_TILT + 1e-9; tilt += TILT_STEP) {
    const c = Math.cos(tilt)
    const s = Math.sin(tilt)
    // x축 회전: y' = c·y − s·z, z' = s·y + c·z
    const rotated = pairs.map(({ p }) => [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]])
    const pMean = [0, 1, 2].map(
      (k) => rotated.reduce((sum, r, i) => sum + r[k] * pairs[i].w, 0) / total,
    )
    let dot = 0
    let norm = 0
    rotated.forEach((r, i) => {
      for (let k = 0; k < 3; k++) {
        const a = r[k] - pMean[k]
        dot += pairs[i].w * a * (pairs[i].q[k] - qMean[k])
        norm += pairs[i].w * a * a
      }
    })
    const scale = dot / norm
    let error = 0
    rotated.forEach((r, i) => {
      for (let k = 0; k < 3; k++) {
        const d = scale * (r[k] - pMean[k]) - (pairs[i].q[k] - qMean[k])
        error += pairs[i].w * d * d
      }
    })
    if (!best || error < best.error) {
      best = {
        scale,
        rotationX: tilt,
        position: [0, 1, 2].map((k) => qMean[k] - scale * pMean[k]) as [number, number, number],
        error,
      }
    }
  }
  if (!best) return null
  const rms = Math.sqrt(best.error / total)
  const edge = Math.abs(best.rotationX) >= MAX_TILT - TILT_STEP / 2
  const expected = expectedScale(pointOf)
  const relative = best.scale / expected
  if (!(relative > SCALE_MIN && relative < SCALE_MAX) || rms > MAX_RMS * expected || edge)
    return null
  // 두피 캡이 피부에 바짝 붙어 있어 1~2mm만 안으로 들어가도 정수리 살이 비친다(기본 여성 모델에서 확인).
  // 어느 점도 머리 안으로 들어가지 않게, 점들 가운데를 기준으로 가장 많이 들어간 점만큼 살짝 키운다(최대 5%).
  const placed = (p: Vec3) => {
    const c = Math.cos(best.rotationX)
    const s = Math.sin(best.rotationX)
    const r = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]
    return r.map((v, k) => best.scale * v + best.position[k])
  }
  const radius = (v: readonly number[]) => Math.hypot(...v.map((x, k) => x - qMean[k]))
  const grow = Math.min(
    1.05,
    Math.max(1, ...pairs.map(({ p, q }) => radius(q) / radius(placed(p)))),
  )
  return {
    scale: best.scale * grow,
    position: best.position.map((t, k) => qMean[k] + grow * (t - qMean[k])) as [
      number,
      number,
      number,
    ],
    rotationX: best.rotationX,
  }
}

/** 헤어 루트에 줄 변환. 헤어 점 p는 `p * scale + position`으로 머리 좌표에 놓인다(기울기 없음) */
export function fitHairToHead(
  head: Box,
  template: Box = TEMPLATE_SKIN_BOX,
  /** 눈 사이 거리로 구한 기대 크기(`expectedScale`). 복원 모델은 약 0.73 */
  expected = 1,
): HairFit {
  const width = (box: Box) => box.max[0] - box.min[0]
  const centerX = (box: Box) => (box.min[0] + box.max[0]) / 2
  const centerZ = (box: Box) => (box.min[2] + box.max[2]) / 2
  const raw = width(head) / width(template)
  // 경계 상자가 이상하면(빈 메시 등) 기대 크기를 쓴다. 머리 폭 차이는 기대 크기에서 ±20%를 넘지 않는다
  const relative = raw / expected
  const scale =
    Number.isFinite(raw) && relative > SCALE_MIN && relative < SCALE_MAX ? raw : expected
  // 정수리(템플릿 위끝) 아래로 균일하게 늘리므로, 위끝·가운데가 머리의 위끝·가운데에 오게 옮긴다
  return {
    scale,
    rotationX: 0,
    position: [
      centerX(head) - centerX(template) * scale,
      head.max[1] - template.max[1] * scale,
      centerZ(head) - centerZ(template) * scale,
    ],
  }
}

/** head.glb의 사람별 헤어라인 점(S15P31B204-722): 템플릿 정점 번호 3개와 앞 두 정점의 무게 */
export type HairlinePoint = readonly [number, number, number, number, number]

/**
 * head.glb 메타데이터의 헤어라인(`asset.extras["live-mirror"].hairline`)에서 점 목록을 꺼낸다.
 * 형식이 다르거나 없으면 null(통째 맞춤만 한다).
 */
export function readHairline(value: unknown): HairlinePoint[] | null {
  if (!value || typeof value !== 'object') return null
  const { version, points } = value as { version?: unknown; points?: unknown }
  if (version !== 1 || !Array.isArray(points)) return null
  const valid = points.filter(
    (p): p is HairlinePoint =>
      Array.isArray(p) &&
      p.length === 5 &&
      p.every((v) => typeof v === 'number' && Number.isFinite(v)),
  )
  return valid.length >= 8 ? valid : null
}

/** 헤어라인 점 → 머리 위 곡선: w0·V[i0] + w1·V[i1] + (1−w0−w1)·V[i2]. 정점을 못 찾은 점은 뺀다 */
export function hairlineCurve(
  points: readonly HairlinePoint[],
  pointOf: (vertex: number) => Vec3 | null,
): Vec3[] {
  const curve: Vec3[] = []
  for (const [i0, i1, i2, w0, w1] of points) {
    const a = pointOf(i0)
    const b = pointOf(i1)
    const c = pointOf(i2)
    if (!a || !b || !c) continue
    const w2 = 1 - w0 - w1
    curve.push([0, 1, 2].map((k) => w0 * a[k] + w1 * b[k] + w2 * c[k]) as unknown as Vec3)
  }
  return curve
}

/** 헤어 좌표(템플릿) 점을 맞춤대로 머리 좌표에 놓는다: scale·Rx(t)·p + position (three.js Object3D와 같은 순서) */
export function placeHairPoint(fit: HairFit, p: Vec3): Vec3 {
  const c = Math.cos(fit.rotationX)
  const s = Math.sin(fit.rotationX)
  const r = [p[0], c * p[1] - s * p[2], s * p[1] + c * p[2]]
  return r.map((v, k) => fit.scale * v + fit.position[k]) as unknown as Vec3
}

/** 머리 좌표의 변위를 헤어 좌표(템플릿)의 변위로: placeHairPoint의 선형 부분을 거꾸로 */
function toHairVector(fit: HairFit, d: readonly number[]): Vec3 {
  const c = Math.cos(fit.rotationX)
  const s = Math.sin(fit.rotationX)
  const v = d.map((x) => x / fit.scale)
  return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]]
}

/** 헤어 앞부분을 옮길 기준점: 헤어 좌표(평균 머리)의 앞쪽 경계 점과 그 점이 옮겨 갈 변위(헤어 좌표) */
export interface HairlineAnchor {
  at: Vec3
  shift: Vec3
}

/** 이마 펼친 지도에 쓰는 템플릿 점: 턱끝(MediaPipe 152) */
const CHIN = 12256
/**
 * 앞부분을 옮기는 최대 거리(헤어 좌표, m). 평균 머리 크기 기준 3.5cm(눈~턱의 약 30%). 더 멀면 그 점은 맞추지 않는다:
 * 확인 세트에서 이보다 먼 점은 귀 쪽 끝(앞머리 숏컷의 구레나룻 뿌리)이 사람 헤어라인 끝과 4.5cm 떨어진 경우뿐이었다
 */
const MAX_SHIFT = 0.035

/**
 * 머리의 이마 펼친 지도(헤어 경계를 잴 때와 같은 방식, live-mirror-poc tools/hair_mh/hair_edge.py): 눈 높이를 기준으로
 * h = 눈 위 높이, s = 양 귀 사이 세로축을 도는 둘레 길이(둘 다 눈~턱 길이로 나눔), 각도 = atan2(h, s)(90° = 이마 가운데).
 * 관자놀이처럼 헤어라인이 세로로 내려오는 곳도 각도가 달라 같은 자리를 찾을 수 있다. 점을 못 찾으면 null.
 * 머리 좌표는 Y가 위, Z가 앞이다(복원 모델·기본 모델·평균 머리 모두).
 */
export function foreheadAngle(
  pointOf: (vertex: number) => Vec3 | null,
): ((p: readonly number[]) => number) | null {
  const map = foreheadMap(pointOf)
  return map ? (p) => map(p).angle : null
}

/**
 * 이마 펼친 지도의 자리: 각도(라디안, 90° = 이마 가운데), 반지름(눈~턱 길이 단위), 앞뒤 깊이(귀 사이 축에서 앞쪽 +).
 * `foreheadAngle`과 같은 지도다.
 */
export function foreheadMap(
  pointOf: (vertex: number) => Vec3 | null,
): ((p: readonly number[]) => { angle: number; radius: number; depth: number }) | null {
  const eyeA = pointOf(EYE_CORNERS[0])
  const eyeB = pointOf(EYE_CORNERS[1])
  const chin = pointOf(CHIN)
  const earL = pointOf(HAIR_LANDMARKS.find((m) => m.name === 'aboveEarL')!.vertex)
  const earR = pointOf(HAIR_LANDMARKS.find((m) => m.name === 'aboveEarR')!.vertex)
  if (!eyeA || !eyeB || !chin || !earL || !earR) return null
  const eyeY = (eyeA[1] + eyeB[1]) / 2
  const height = eyeY - chin[1]
  if (!(height > 0)) return null
  const cx = (earL[0] + earR[0]) / 2
  const cz = (earL[2] + earR[2]) / 2
  return (p) => {
    const lat = (p[0] - cx) / height
    const depth = (p[2] - cz) / height
    const s = Math.hypot(lat, depth) * Math.atan2(lat, depth)
    const h = (p[1] - eyeY) / height
    return { angle: Math.atan2(h, s), radius: Math.hypot(s, h), depth }
  }
}

/**
 * 두피 칠(catalog `scalpPaint`)이 사람 헤어라인 밖으로 나오지 않게 하는 정점별 무게(0~1). 헤어라인이 지나는 각도에서
 * 헤어라인보다 2mm(눈~턱 0.02) 안쪽까지는 0, 9mm(0.08) 안쪽부터 1이다. 헤어라인 각도 범위 밖·뒤쪽은 1.
 * 헤어 앞부분은 사람 헤어라인으로 옮겨지지만 칠은 템플릿 UV에 고정돼 있어, 헤어라인이 헤어 경계보다 높은 사람에서
 * 칠만 이마에 남지 않게 한다.
 */
export function scalpPaintFade(
  points: readonly (readonly number[])[],
  curve: readonly Vec3[],
  pointOf: (vertex: number) => Vec3 | null,
): Float32Array {
  const fade = new Float32Array(points.length).fill(1)
  const map = foreheadMap(pointOf)
  if (!map || curve.length < 8) return fade
  const line = curve.map((q) => map(q)).sort((x, y) => x.angle - y.angle)
  const lo = line[0].angle
  const hi = line[line.length - 1].angle
  points.forEach((p, i) => {
    const { angle, radius, depth } = map(p)
    if (angle < lo || angle > hi || depth < -0.6) return
    let j = 1
    while (j < line.length - 1 && line[j].angle < angle) j++
    const a = line[j - 1]
    const b = line[j]
    const t = b.angle > a.angle ? (angle - a.angle) / (b.angle - a.angle) : 0
    const behind = radius - (a.radius + (b.radius - a.radius) * t)
    const x = Math.min(1, Math.max(0, (behind - 0.02) / 0.06))
    fade[i] = x * x * (3 - 2 * x)
  })
  return fade
}

/**
 * 통째 맞춤 뒤 헤어의 앞쪽 경계 점(`edge`, 헤어 좌표)이 사람 헤어라인의 같은 자리(이마 펼친 지도에서 같은 각도)까지
 * 얼마나 옮겨야 하는지. 사람 곡선이 덮지 않는 각도의 점과 너무 먼 점(`MAX_SHIFT`)은 뺀다.
 */
export function hairlineAnchors(
  fit: HairFit,
  curve: readonly Vec3[],
  edge: readonly (readonly [number, number, number])[],
  pointOf: (vertex: number) => Vec3 | null,
): HairlineAnchor[] {
  const angle = foreheadAngle(pointOf)
  if (!angle || curve.length < 8 || !edge.length) return []
  const line = curve.map((q) => ({ a: angle(q), q })).sort((x, y) => x.a - y.a)
  const anchors: HairlineAnchor[] = []
  for (const at of edge) {
    const placed = placeHairPoint(fit, at)
    const a = angle(placed)
    if (a < line[0].a || a > line[line.length - 1].a) continue
    let j = 1
    while (j < line.length - 1 && line[j].a < a) j++
    const lo = line[j - 1]
    const hi = line[j]
    const t = hi.a > lo.a ? (a - lo.a) / (hi.a - lo.a) : 0
    const target = [0, 1, 2].map((k) => lo.q[k] + (hi.q[k] - lo.q[k]) * t)
    const shift = toHairVector(
      fit,
      target.map((v, k) => v - placed[k]),
    )
    if (Math.hypot(...shift) > MAX_SHIFT) continue
    anchors.push({ at, shift })
  }
  return anchors
}

/**
 * 기준점에서 옮기는 정도가 줄어드는 거리(헤어 좌표, m). 정수리(경계에서 약 8~10cm)는 옮기는 양의 2~7%
 * (4.5cm는 9~20%라 1.5cm 옮길 때 정수리가 떴다)
 */
const BEND_SIGMA = 0.035

/**
 * 헤어 점들(헤어 좌표, xyz 연속 배열)의 앞부분을 기준점 변위만큼 옮긴다. 방향·크기는 가까운 기준점들의 변위를
 * 거리 무게로 섞은 값이고, 옮기는 정도는 가장 가까운 기준점까지의 거리로만 가우시안으로 줄인다(기준점이 촘촘해도
 * 멀리 있는 정수리·뒷머리가 따라 움직이지 않게). 제자리에서 바꾼다.
 */
export function bendFront(
  positions: Float32Array | number[],
  anchors: readonly HairlineAnchor[],
  sigma = BEND_SIGMA,
): void {
  if (!anchors.length) return
  const k2 = 1 / (2 * sigma * sigma)
  for (let i = 0; i < positions.length; i += 3) {
    let total = 0
    let nearest = Infinity
    const move = [0, 0, 0]
    for (const { at, shift } of anchors) {
      const d2 =
        (positions[i] - at[0]) ** 2 +
        (positions[i + 1] - at[1]) ** 2 +
        (positions[i + 2] - at[2]) ** 2
      nearest = Math.min(nearest, d2)
      const w = Math.exp(-d2 * k2) + 1e-12
      total += w
      for (let k = 0; k < 3; k++) move[k] += w * shift[k]
    }
    const fade = Math.exp(-nearest * k2)
    for (let k = 0; k < 3; k++) positions[i + k] += (move[k] / total) * fade
  }
}

/**
 * 헤어를 피부 밖으로 띄우는 거리(헤어 좌표, m). 맞춤 배율을 곱해 머리 좌표로 쓴다. 헤어는 먼저 두피 점을 따라 옮기므로
 * (`followSkin`) 여기서는 남은 작은 파고듦만 잡는다. 크게 밀면 튜브 마디의 꼭짓점이 서로 다른 법선으로 밀려 넓적하게 펴졌다
 */
export const SKIN_CLEAR = 0.0005
/** 이 거리(헤어 좌표, m)보다 피부에서 먼 헤어 점은 보지 않는다. 피부 정점 간격(3~5mm)보다 넉넉히 */
export const SKIN_REACH = 0.015

/** 사람 피부 정점의 위치·바깥 법선(머리 좌표, xyz 연속 배열) */
export interface SkinSurface {
  points: Float32Array
  normals: Float32Array
}

/**
 * 피부 안으로 들어간 헤어 점을 피부 밖 `clear`까지 밀어낸다(머리 좌표, 제자리에서 바꾼다). 밀어낸 점 수를 돌려준다.
 *
 * 헤어는 평균 머리 위에서 만들어 통째로만 맞추므로(크기·위치·앞뒤 기울기), 볼·관자놀이가 평균보다 나온 사람은
 * 피부에 붙어 있는 구레나룻·옆머리가 피부 안으로 들어가 가려진다(확인 세트에서 그 자리 피부가 평균보다 최대 7mm 바깥).
 * 점마다 가장 가까운 피부 정점을 찾고, 그 정점의 접평면 위 높이가 `clear`보다 낮으면 법선 방향으로 올린다.
 * 피부 정점은 `reach / 2` 크기 칸의 격자에 칸 순서대로 담아 이웃 27칸만 본다(적어도 `reach / 2` 안은 빠짐없이 찾는다).
 * 1.6M점 헤어에서 칸을 `reach`로 두면 칸마다 피부 정점이 많아 4초 넘게 걸렸다.
 */
export function pushOutOfSkin(
  positions: Float32Array,
  skin: SkinSurface,
  clear: number,
  reach: number,
): number {
  const grid = skinPushGrid(skin, reach)
  return grid ? pushOutWithGrid(positions, grid, clear) : 0
}

/** `pushOutOfSkin`이 피부 정점을 찾는 칸 격자. 헤어와 상관없이 머리·`reach`마다 같아 한 번 만들어 여러 헤어에 쓴다(S15P31B204-861) */
export interface SkinPushGrid {
  lo: [number, number, number]
  cell: number
  dims: [number, number, number]
  reach: number
  /** 칸마다 담은 점의 시작 번호(칸 순서) */
  start: Int32Array
  /** 칸 순서로 다시 담은 위치·법선 */
  points: Float32Array
  normals: Float32Array
}

/** 피부 정점을 `reach / 2` 크기 칸에 칸 순서대로 담는다. 정점이 없거나 `reach`가 0 이하면 null */
export function skinPushGrid(skin: SkinSurface, reach: number): SkinPushGrid | null {
  const { points, normals } = skin
  const count = points.length / 3
  if (!count || !(reach > 0)) return null
  const cell = reach / 2
  let lx = Infinity
  let ly = Infinity
  let lz = Infinity
  let hx = -Infinity
  let hy = -Infinity
  let hz = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    lx = Math.min(lx, points[i])
    ly = Math.min(ly, points[i + 1])
    lz = Math.min(lz, points[i + 2])
    hx = Math.max(hx, points[i])
    hy = Math.max(hy, points[i + 1])
    hz = Math.max(hz, points[i + 2])
  }
  // 두 칸씩 여유를 둔다: 피부 경계 상자 바로 밖(한 칸)의 점도 찾고, 이웃 칸을 볼 때 경계 검사를 하지 않는다
  const nx = Math.ceil((hx - lx) / cell) + 5
  const ny = Math.ceil((hy - ly) / cell) + 5
  const nz = Math.ceil((hz - lz) / cell) + 5
  const cellIndexOf = (x: number, y: number, z: number) =>
    ((Math.floor((x - lx) / cell) + 2) * ny + Math.floor((y - ly) / cell) + 2) * nz +
    Math.floor((z - lz) / cell) +
    2
  const cells = nx * ny * nz
  const start = new Int32Array(cells + 1)
  const cellOfPoint = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const c = cellIndexOf(points[i * 3], points[i * 3 + 1], points[i * 3 + 2])
    cellOfPoint[i] = c
    start[c + 1]++
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c]
  // 칸 순서로 다시 담은 위치·법선(메모리를 차례로 읽게)
  const sp = new Float32Array(count * 3)
  const sn = new Float32Array(count * 3)
  const fill = start.slice(0, cells)
  for (let i = 0; i < count; i++) {
    const o = fill[cellOfPoint[i]]++ * 3
    for (let k = 0; k < 3; k++) {
      sp[o + k] = points[i * 3 + k]
      sn[o + k] = normals[i * 3 + k]
    }
  }
  return { lo: [lx, ly, lz], cell, dims: [nx, ny, nz], reach, start, points: sp, normals: sn }
}

/** 미리 만든 칸 격자(`skinPushGrid`)로 `pushOutOfSkin`을 한다 */
export function pushOutWithGrid(
  positions: Float32Array,
  grid: SkinPushGrid,
  clear: number,
): number {
  const [lx, ly, lz] = grid.lo
  const [nx, ny, nz] = grid.dims
  const { cell, reach, start } = grid
  const sp = grid.points
  const sn = grid.normals
  const dy = nz
  const dx = ny * nz
  let pushed = 0
  for (let p = 0; p < positions.length; p += 3) {
    const x = positions[p]
    const y = positions[p + 1]
    const z = positions[p + 2]
    const gx = Math.floor((x - lx) / cell) + 2
    const gy = Math.floor((y - ly) / cell) + 2
    const gz = Math.floor((z - lz) / cell) + 2
    if (gx < 1 || gy < 1 || gz < 1 || gx > nx - 2 || gy > ny - 2 || gz > nz - 2) continue
    const center = (gx * ny + gy) * nz + gz
    let best = -1
    let bestD2 = reach * reach
    for (let ox = -dx; ox <= dx; ox += dx)
      for (let oy = -dy; oy <= dy; oy += dy)
        for (let oz = -1; oz <= 1; oz++) {
          const c = center + ox + oy + oz
          for (let o = start[c] * 3, end = start[c + 1] * 3; o < end; o += 3) {
            const ex = x - sp[o]
            const ey = y - sp[o + 1]
            const ez = z - sp[o + 2]
            const d2 = ex * ex + ey * ey + ez * ez
            if (d2 < bestD2) {
              bestD2 = d2
              best = o
            }
          }
        }
    if (best < 0) continue
    const ux = sn[best]
    const uy = sn[best + 1]
    const uz = sn[best + 2]
    const h = (x - sp[best]) * ux + (y - sp[best + 1]) * uy + (z - sp[best + 2]) * uz
    if (h >= clear) continue
    const up = clear - h
    positions[p] = x + ux * up
    positions[p + 1] = y + uy * up
    positions[p + 2] = z + uz * up
    pushed++
  }
  return pushed
}

/**
 * 템플릿 귀의 기준 점(GNM v2 정점 번호와 템플릿 좌표, m). 귀마다 가운데·위·아래·앞·뒤 5점
 * (live-mirror-poc tools/hair_mh/template_ears.json의 귀 정점에서 골랐다)
 */
export const EAR_POINTS: readonly { side: 'L' | 'R'; vertex: number; at: Vec3 }[] = [
  { side: 'L', vertex: 2402, at: [0.0785, 0.2744, 0.0138] },
  { side: 'L', vertex: 2930, at: [0.0778, 0.3019, 0.0197] },
  { side: 'L', vertex: 2485, at: [0.0713, 0.2422, 0.033] },
  { side: 'L', vertex: 4974, at: [0.0752, 0.2858, 0.0352] },
  { side: 'L', vertex: 2374, at: [0.086, 0.2806, 0.0012] },
  { side: 'R', vertex: 8530, at: [-0.0785, 0.2744, 0.0137] },
  { side: 'R', vertex: 9058, at: [-0.0778, 0.3019, 0.0196] },
  { side: 'R', vertex: 8613, at: [-0.0714, 0.2423, 0.0329] },
  { side: 'R', vertex: 11102, at: [-0.0754, 0.2858, 0.0351] },
  { side: 'R', vertex: 8502, at: [-0.0859, 0.2807, 0.001] },
]
/** 귀를 따라 옮기는 정도가 줄어드는 거리(헤어 좌표, m). 귀 둘레 2~3cm 안의 헤어가 귀와 함께 움직인다 */
export const EAR_SIGMA = 0.02
/** 귀가 이보다 멀리(헤어 좌표, m) 어긋나면 그 귀는 맞추지 않는다(점을 잘못 찾은 경우) */
const EAR_MAX_SHIFT = 0.02

/**
 * 귀마다 그 사람 귀 위치와, 통째 맞춤으로 놓인 평균 머리 귀 위치의 차이(헤어 좌표 변위).
 * 헤어는 평균 머리 귀에 맞춰 귀 둘레를 비워 두었는데(구레나룻·옆머리), 통째 맞춤 뒤에도 사람 귀는 4~9mm(주로 위아래)
 * 어긋나 머리가 귀를 덮거나 귀 위에 빈 피부가 넓게 남는다. 이 변위만큼 귀 둘레 헤어를 옮긴다(`followEars`).
 * 귀 점을 3개 넘게 못 찾으면 그 귀는 뺀다.
 */
export function earAnchors(
  fit: HairFit,
  pointOf: (vertex: number) => Vec3 | null,
): HairlineAnchor[] {
  const anchors: HairlineAnchor[] = []
  for (const side of ['L', 'R'] as const) {
    const at = [0, 0, 0]
    const person = [0, 0, 0]
    let n = 0
    for (const mark of EAR_POINTS) {
      if (mark.side !== side) continue
      const q = pointOf(mark.vertex)
      if (!q) continue
      for (let k = 0; k < 3; k++) {
        at[k] += mark.at[k]
        person[k] += q[k]
      }
      n++
    }
    if (n < 3) continue
    const centre = at.map((v) => v / n) as unknown as Vec3
    const placed = placeHairPoint(fit, centre)
    const shift = toHairVector(
      fit,
      person.map((v, k) => v / n - placed[k]),
    )
    if (Math.hypot(...shift) > EAR_MAX_SHIFT) continue
    anchors.push({ at: centre, shift })
  }
  return anchors
}

/** 헤어 점들(헤어 좌표, xyz 연속 배열)을 귀 기준점 변위만큼, 귀에서 멀어질수록 가우시안으로 덜 옮긴다. 제자리에서 바꾼다 */
export function followEars(
  positions: Float32Array | number[],
  anchors: readonly HairlineAnchor[],
  sigma = EAR_SIGMA,
): void {
  if (!anchors.length) return
  const k2 = 1 / (2 * sigma * sigma)
  for (let i = 0; i < positions.length; i += 3)
    for (const { at, shift } of anchors) {
      const d2 =
        (positions[i] - at[0]) ** 2 +
        (positions[i + 1] - at[1]) ** 2 +
        (positions[i + 2] - at[2]) ** 2
      const w = Math.exp(-d2 * k2)
      if (w < 1e-4) continue
      for (let k = 0; k < 3; k++) positions[i + k] += w * shift[k]
    }
}

/** 템플릿(GNM v2) 피부 정점: 번호, 템플릿 좌표(m, xyz 연속), 귀 정점 표시(1). public/hair/gnm-skin.bin */
export interface TemplateSkin {
  ids: Uint16Array
  points: Float32Array
  ear: Uint8Array
}

/** gnm-skin.bin: "GNMS" | u32 개수 | u16 번호[개수](4바이트 맞춤) | f32 xyz[개수×3] | u8 귀[개수] */
export function readTemplateSkin(buffer: ArrayBuffer): TemplateSkin | null {
  const view = new DataView(buffer)
  if (buffer.byteLength < 8 || view.getUint32(0, false) !== 0x474e4d53) return null
  const count = view.getUint32(4, true)
  const idsEnd = 8 + count * 2
  const pointsStart = idsEnd + ((4 - (idsEnd % 4)) % 4)
  if (buffer.byteLength < pointsStart + count * 13) return null
  return {
    ids: new Uint16Array(buffer.slice(8, idsEnd)),
    points: new Float32Array(buffer.slice(pointsStart, pointsStart + count * 12)),
    ear: new Uint8Array(buffer.slice(pointsStart + count * 12, pointsStart + count * 13)),
  }
}

/** 두피 변위를 이웃 정점과 섞는 거리(헤어 좌표, m). 정점 하나하나의 오차(1~2mm)가 헤어에 그대로 옮지 않게 */
export const SKIN_SMOOTH = 0.008
/** 헤어 점이 묶일 두피 정점을 찾는 최대 거리(헤어 좌표, m). 더 멀면 옮기지 않는다 */
export const SKIN_BIND_REACH = 0.05
/**
 * 두피 따라 옮기기를 하는 높이(템플릿 y, m). 이 위(목·머리)는 다 따르고 `SKIN_FOLLOW_FROM_Y` 아래(어깨·가슴)는 따르지
 * 않으며 그 사이는 서서히 줄인다. 상반신은 사람마다 잘린 모양과 어깨 폭이 달라서, 긴 머리가 어깨·등 점에 묶이면 마디마다
 * 다르게 끌려가 뒷머리가 각지고 물결졌다(S15P31B204-795). 목은 0.17~0.23, 어깨는 0.17 아래에서 넓어진다.
 */
export const SKIN_FOLLOW_FROM_Y = 0.15
export const SKIN_FOLLOW_FULL_Y = 0.18

/**
 * 템플릿 피부(gnm-skin.bin)에만 달린 계산을 피부마다 한 번만 한다. 사람과 상관없는 계산이라 머리마다 다시 하면 같은 일을
 * 되풀이한다: 머리 하나 준비가 0.64초였고 그중 0.43초가 이 되풀이였다(이제 두 번째 머리부터 0.21초, 11/15)
 */
const perTemplateSkin = new WeakMap<TemplateSkin, Map<string, unknown>>()
function onceForSkin<T>(skin: TemplateSkin, key: string, make: () => T): T {
  let done = perTemplateSkin.get(skin)
  if (!done) perTemplateSkin.set(skin, (done = new Map()))
  if (!done.has(key)) done.set(key, make())
  return done.get(key) as T
}

/** 점 격자(칸 크기 `cell`). 칸 순서로 점 번호를 담는다 */
function pointGrid(points: Float32Array, cell: number) {
  const count = points.length / 3
  let lx = Infinity
  let ly = Infinity
  let lz = Infinity
  let hx = -Infinity
  let hy = -Infinity
  let hz = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    lx = Math.min(lx, points[i])
    ly = Math.min(ly, points[i + 1])
    lz = Math.min(lz, points[i + 2])
    hx = Math.max(hx, points[i])
    hy = Math.max(hy, points[i + 1])
    hz = Math.max(hz, points[i + 2])
  }
  const nx = Math.ceil((hx - lx) / cell) + 1
  const ny = Math.ceil((hy - ly) / cell) + 1
  const nz = Math.ceil((hz - lz) / cell) + 1
  const at = (v: number, lo: number, n: number) =>
    Math.min(n - 1, Math.max(0, Math.floor((v - lo) / cell)))
  const start = new Int32Array(nx * ny * nz + 1)
  const cellOf = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const c =
      (at(points[i * 3], lx, nx) * ny + at(points[i * 3 + 1], ly, ny)) * nz +
      at(points[i * 3 + 2], lz, nz)
    cellOf[i] = c
    start[c + 1]++
  }
  for (let c = 0; c < nx * ny * nz; c++) start[c + 1] += start[c]
  const order = new Int32Array(count)
  const fill = start.slice(0, nx * ny * nz)
  for (let i = 0; i < count; i++) order[fill[cellOf[i]]++] = i
  /** (x, y, z)에서 칸 반지름 `ring` 안의 점 번호마다 visit을 부른다 */
  const around = (x: number, y: number, z: number, ring: number, visit: (i: number) => void) => {
    const gx = Math.floor((x - lx) / cell)
    const gy = Math.floor((y - ly) / cell)
    const gz = Math.floor((z - lz) / cell)
    for (let ix = Math.max(gx - ring, 0); ix <= Math.min(gx + ring, nx - 1); ix++)
      for (let iy = Math.max(gy - ring, 0); iy <= Math.min(gy + ring, ny - 1); iy++)
        for (let iz = Math.max(gz - ring, 0); iz <= Math.min(gz + ring, nz - 1); iz++) {
          const c = (ix * ny + iy) * nz + iz
          for (let n = start[c]; n < start[c + 1]; n++) visit(order[n])
        }
  }
  return { around }
}

/**
 * 템플릿 피부 정점마다, 통째 맞춤으로 놓인 그 정점에서 그 사람 피부의 같은 정점까지의 변위(헤어 좌표, xyz 연속).
 * 이웃 정점과 가우시안으로 섞는다(`SKIN_SMOOTH`). 귀 정점과 사람 쪽에서 못 찾은 정점은 값을 내지 않고 이웃 값으로 채운다
 * (귀는 `followEars`가 맡는다).
 */
export function skinShifts(
  skin: TemplateSkin,
  fit: HairFit,
  pointOf: (vertex: number) => Vec3 | null,
  sigma = SKIN_SMOOTH,
): Float32Array {
  const count = skin.ids.length
  const raw = new Float32Array(count * 3)
  const known = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    if (skin.ear[i]) continue
    const q = pointOf(skin.ids[i])
    if (!q) continue
    const t: Vec3 = [skin.points[i * 3], skin.points[i * 3 + 1], skin.points[i * 3 + 2]]
    const placed = placeHairPoint(fit, t)
    const v = toHairVector(fit, [q[0] - placed[0], q[1] - placed[1], q[2] - placed[2]])
    raw.set(v, i * 3)
    known[i] = 1
  }
  const grid = onceForSkin(skin, `grid|${sigma}`, () => pointGrid(skin.points, 2 * sigma))
  const k2 = 1 / (2 * sigma * sigma)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = skin.points[i * 3]
    const y = skin.points[i * 3 + 1]
    const z = skin.points[i * 3 + 2]
    let total = 0
    let sx = 0
    let sy = 0
    let sz = 0
    grid.around(x, y, z, 1, (j) => {
      if (!known[j]) return
      const d2 =
        (x - skin.points[j * 3]) ** 2 +
        (y - skin.points[j * 3 + 1]) ** 2 +
        (z - skin.points[j * 3 + 2]) ** 2
      const w = Math.exp(-d2 * k2)
      total += w
      sx += w * raw[j * 3]
      sy += w * raw[j * 3 + 1]
      sz += w * raw[j * 3 + 2]
    })
    if (total > 1e-9) out.set([sx / total, sy / total, sz / total], i * 3)
  }
  return out
}

/** 머리 둘레 칸(헤어 좌표)마다 담은 두피 변위. `skinShiftField`로 만들고 `followSkin`으로 읽는다 */
export interface SkinShiftField {
  lo: [number, number, number]
  cell: number
  dims: [number, number, number]
  /** 칸마다 변위(xyz 연속) */
  shift: Float32Array
  /** 칸 가운데에서 가장 가까운 두피 정점까지 거리(m). 없으면 Infinity. 가닥 뿌리를 고를 때 쓴다 */
  dist: Float32Array
}

/**
 * 머리 둘레를 `cell` 칸으로 나눠, 칸 가운데마다 가장 가까운 두피 정점(이웃 칸으로 퍼뜨려 찾는 대략의 최근접, 26방향)의
 * 변위(`skinShifts`)를 담는다. 두피에서 `reach`에 가까워질수록 변위를 줄여 0으로 맞춘다. 머리 하나에 한 번만 만든다.
 * 칸마다 가장 가까운 두피 정점은 템플릿 피부에만 달려 피부마다 한 번만 찾는다(`nearestScalp`)
 */
export function skinShiftField(
  skin: TemplateSkin,
  shifts: Float32Array,
  reach = SKIN_BIND_REACH,
  cell = 0.005,
): SkinShiftField {
  if (!skin.ids.length)
    return {
      lo: [0, 0, 0],
      cell,
      dims: [1, 1, 1],
      shift: new Float32Array(3),
      dist: new Float32Array(1).fill(Infinity),
    }
  const pts = skin.points
  const { lo, dims, source, dist2, dist } = onceForSkin(skin, `nearest|${reach}|${cell}`, () =>
    nearestScalp(pts, reach, cell),
  )
  // 사람마다 다른 것은 정점별 변위뿐이다: 칸마다 가장 가까운 두피 정점의 변위를 거리·높이로 줄여 담는다
  const cells = source.length
  const shift = new Float32Array(cells * 3)
  const fade = Math.min(0.01, reach / 2)
  for (let c = 0; c < cells; c++) {
    const i = source[c]
    if (i < 0) continue
    const t = Math.min(1, Math.max(0, (reach - Math.sqrt(dist2[c])) / fade))
    const b = Math.min(
      1,
      Math.max(
        0,
        (pts[i * 3 + 1] - SKIN_FOLLOW_FROM_Y) / (SKIN_FOLLOW_FULL_Y - SKIN_FOLLOW_FROM_Y),
      ),
    )
    const w = t * t * (3 - 2 * t) * b * b * (3 - 2 * b)
    shift[c * 3] = shifts[i * 3] * w
    shift[c * 3 + 1] = shifts[i * 3 + 1] * w
    shift[c * 3 + 2] = shifts[i * 3 + 2] * w
  }
  return { lo, cell, dims, shift, dist }
}

/**
 * 머리 둘레를 `cell` 칸으로 나눠, 칸 가운데마다 가장 가까운 두피 정점(이웃 칸으로 퍼뜨려 찾는 대략의 최근접, 26방향)과
 * 그 거리를 찾는다. 두피에서 `reach`보다 먼 칸은 비운다(-1). 템플릿 피부에만 달려 피부마다 한 번만 한다(`skinShiftField`)
 */
function nearestScalp(pts: Float32Array, reach: number, cell: number) {
  const count = pts.length / 3
  let lx = Infinity
  let ly = Infinity
  let lz = Infinity
  let hx = -Infinity
  let hy = -Infinity
  let hz = -Infinity
  for (let i = 0; i < pts.length; i += 3) {
    lx = Math.min(lx, pts[i])
    ly = Math.min(ly, pts[i + 1])
    lz = Math.min(lz, pts[i + 2])
    hx = Math.max(hx, pts[i])
    hy = Math.max(hy, pts[i + 1])
    hz = Math.max(hz, pts[i + 2])
  }
  const pad = Math.ceil(reach / cell) + 2
  lx -= pad * cell
  ly -= pad * cell
  lz -= pad * cell
  const nx = Math.ceil((hx - lx) / cell) + pad + 1
  const ny = Math.ceil((hy - ly) / cell) + pad + 1
  const nz = Math.ceil((hz - lz) / cell) + pad + 1
  const cells = nx * ny * nz
  const source = new Int32Array(cells).fill(-1)
  const dist2 = new Float32Array(cells).fill(Infinity)
  const reach2 = reach * reach
  // 칸이 여러 번 좋아질 수 있어 넉넉히, 넘치면 그 칸은 더 퍼뜨리지 않는다
  const queue = new Int32Array(cells * 3)
  let head = 0
  let tail = 0
  const offer = (c: number, cx: number, cy: number, cz: number, i: number) => {
    const ex = cx - pts[i * 3]
    const ey = cy - pts[i * 3 + 1]
    const ez = cz - pts[i * 3 + 2]
    const d2 = ex * ex + ey * ey + ez * ez
    if (d2 >= dist2[c] || d2 > reach2) return
    dist2[c] = d2
    source[c] = i
    if (tail < queue.length) queue[tail++] = c
  }
  for (let i = 0; i < count; i++) {
    const ix = Math.floor((pts[i * 3] - lx) / cell)
    const iy = Math.floor((pts[i * 3 + 1] - ly) / cell)
    const iz = Math.floor((pts[i * 3 + 2] - lz) / cell)
    offer(
      (ix * ny + iy) * nz + iz,
      lx + (ix + 0.5) * cell,
      ly + (iy + 0.5) * cell,
      lz + (iz + 0.5) * cell,
      i,
    )
  }
  while (head < tail) {
    const c = queue[head++]
    const i = source[c]
    const iz = c % nz
    const iy = ((c - iz) / nz) % ny
    const ix = (c - iz - iy * nz) / (nz * ny)
    for (let jx = Math.max(ix - 1, 0); jx <= Math.min(ix + 1, nx - 1); jx++) {
      const cx = lx + (jx + 0.5) * cell
      for (let jy = Math.max(iy - 1, 0); jy <= Math.min(iy + 1, ny - 1); jy++) {
        const cy = ly + (jy + 0.5) * cell
        const row = (jx * ny + jy) * nz
        for (let jz = Math.max(iz - 1, 0); jz <= Math.min(iz + 1, nz - 1); jz++) {
          offer(row + jz, cx, cy, lz + (jz + 0.5) * cell, i)
        }
      }
    }
  }
  const dist = new Float32Array(cells)
  for (let c = 0; c < cells; c++) dist[c] = Math.sqrt(dist2[c])
  return {
    lo: [lx, ly, lz] as [number, number, number],
    dims: [nx, ny, nz] as [number, number, number],
    source,
    dist2,
    dist,
  }
}

/** 한 점의 변위를 둘레 8칸 값을 섞어(삼선형) `out`에 담는다. 칸 밖이면 false */
function sampleShift(
  field: SkinShiftField,
  x: number,
  y: number,
  z: number,
  out: [number, number, number],
): boolean {
  const [lx, ly, lz] = field.lo
  const [nx, ny, nz] = field.dims
  const { cell, shift } = field
  const fx = (x - lx) / cell - 0.5
  const fy = (y - ly) / cell - 0.5
  const fz = (z - lz) / cell - 0.5
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const iz = Math.floor(fz)
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx - 1 || iy >= ny - 1 || iz >= nz - 1) return false
  const tx = fx - ix
  const ty = fy - iy
  const tz = fz - iz
  let sx = 0
  let sy = 0
  let sz = 0
  for (let corner = 0; corner < 8; corner++) {
    const cx = corner & 1
    const cy = (corner >> 1) & 1
    const cz = (corner >> 2) & 1
    const w = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz)
    const c = (((ix + cx) * ny + iy + cy) * nz + iz + cz) * 3
    sx += w * shift[c]
    sy += w * shift[c + 1]
    sz += w * shift[c + 2]
  }
  out[0] = sx
  out[1] = sy
  out[2] = sz
  return true
}

/** 점이 든 칸의 두피 거리(가장 가까운 칸 하나). 칸 밖이면 Infinity */
function cellDistance(field: SkinShiftField, x: number, y: number, z: number): number {
  const [lx, ly, lz] = field.lo
  const [nx, ny, nz] = field.dims
  const ix = Math.floor((x - lx) / field.cell)
  const iy = Math.floor((y - ly) / field.cell)
  const iz = Math.floor((z - lz) / field.cell)
  if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return Infinity
  return field.dist[(ix * ny + iy) * nz + iz]
}

/**
 * 가닥 단위로 두피를 따라 옮긴다(헤어 좌표, 제자리에서 바꾼다). 삼각형으로 이어진 점들(튜브 가닥 하나)을 한 가닥으로 보고,
 * 그중 두피에 가장 가까운 점(뿌리)의 변위만큼 가닥 전체를 똑같이 옮긴다. 옮긴 점 수를 돌려준다.
 *
 * `followSkin`은 점마다 가장 가까운 두피 점을 따라가, 볼륨이 크고 긴 머리(레이어드 시험 에셋)는 한 가닥이 높이마다 정수리·뒤통수·목
 * 점에 따로 끌려가 옆모습 뒤통수가 들어갔다 나왔다 했다. 뿌리만 맞추면 가닥 모양(볼륨·컬)은 에셋 그대로 남는다.
 * 남은 작은 파고듦은 `pushOutOfSkin`이 민다.
 */
export function followSkinByStrand(
  positions: Float32Array,
  index: ArrayLike<number>,
  field: SkinShiftField,
): number {
  return followStrands(positions, strandLabels(index, positions.length / 3), field)
}

/**
 * 점마다 그 점이 든 가닥(삼각형으로 이어진 점 묶음)의 대표 점 번호. 헤어 파일에만 달려 머리와 상관없으니 헤어마다 한 번
 * 구해 다른 머리에도 쓴다(S15P31B204-861)
 */
export function strandLabels(index: ArrayLike<number>, count: number): Int32Array {
  const parent = new Int32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = find(index[t])
    const b = find(index[t + 1])
    if (a !== b) parent[b] = a
    const c = find(index[t + 2])
    const r = find(a)
    if (r !== c) parent[c] = r
  }
  for (let i = 0; i < count; i++) parent[i] = find(i)
  return parent
}

/** 가닥 대표 번호(`strandLabels`)로 `followSkinByStrand`를 한다 */
export function followStrands(
  positions: Float32Array,
  labels: Int32Array,
  field: SkinShiftField,
): number {
  const count = positions.length / 3
  const rootDist = new Float32Array(count).fill(Infinity)
  const rootOf = new Int32Array(count).fill(-1)
  for (let i = 0; i < count; i++) {
    const s = labels[i]
    const d = cellDistance(field, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    if (d < rootDist[s]) {
      rootDist[s] = d
      rootOf[s] = i
    }
  }
  const strandShift = new Float32Array(count * 3)
  const has = new Uint8Array(count)
  const out: [number, number, number] = [0, 0, 0]
  for (let s = 0; s < count; s++) {
    const r = rootOf[s]
    if (r < 0) continue
    if (!sampleShift(field, positions[r * 3], positions[r * 3 + 1], positions[r * 3 + 2], out))
      continue
    if (out[0] === 0 && out[1] === 0 && out[2] === 0) continue
    strandShift.set(out, s * 3)
    has[s] = 1
  }
  let moved = 0
  for (let i = 0; i < count; i++) {
    const s = labels[i]
    if (!has[s]) continue
    positions[i * 3] += strandShift[s * 3]
    positions[i * 3 + 1] += strandShift[s * 3 + 1]
    positions[i * 3 + 2] += strandShift[s * 3 + 2]
    moved++
  }
  return moved
}

/** 등 맞추기의 세로축(헤어 좌표 x = 0, z = 이 값). 평균 몸의 목·가슴 단면 가운데 */
const BACK_AXIS_Z = 0
/** 등 맞추기 칸: 축 둘레 각도 칸 수(7.5°), 높이 칸(1cm)의 시작·개수 */
const BACK_TURNS = 48
const BACK_LO_Y = -0.25
const BACK_CELL_Y = 0.01
const BACK_ROWS = 55
/** 등 맞추기를 다 하는 높이와 하지 않는 높이(템플릿 y, m). 목 위(뒤통수)는 두피 따라 옮기기가 맡는다 */
export const BACK_SETTLE_FULL_Y = 0.18
export const BACK_SETTLE_FROM_Y = 0.24
/** 뒤에서 이 각도까지는 다 맞추고 `BACK_SETTLE_SIDE_TO`부터는 맞추지 않는다(어깨 앞으로 넘어온 머리는 그대로) */
const BACK_SETTLE_SIDE_FULL = (60 * Math.PI) / 180
const BACK_SETTLE_SIDE_TO = (95 * Math.PI) / 180
/** 칸마다 옮기는 거리의 한계(헤어 좌표, m) */
const BACK_SETTLE_MAX = 0.04

/**
 * 몸 둘레 칸(축 둘레 각도 × 높이)마다 몸 바깥면 반지름과, 그 바깥에 있는 헤어 중 가장 안쪽 반지름(헤어 좌표, m).
 * `backBody`로 몸을 먼저 담고 `backHair`로 헤어를 담는다.
 */
export interface BackProfile {
  body: Float32Array
  hair: Float32Array
}

export function backProfile(): BackProfile {
  return {
    body: new Float32Array(BACK_TURNS * BACK_ROWS).fill(-Infinity),
    hair: new Float32Array(BACK_TURNS * BACK_ROWS).fill(Infinity),
  }
}

/** 뒤(-z)에서 잰 축 둘레 각도(-π~π, 사람의 왼쪽 +) */
function backAngle(x: number, z: number): number {
  return Math.atan2(x, BACK_AXIS_Z - z)
}

function backCell(x: number, y: number, z: number): number {
  const row = Math.floor((y - BACK_LO_Y) / BACK_CELL_Y)
  if (row < 0 || row >= BACK_ROWS) return -1
  const turn =
    (Math.floor(((backAngle(x, z) + Math.PI) / (2 * Math.PI)) * BACK_TURNS) + BACK_TURNS) %
    BACK_TURNS
  return turn * BACK_ROWS + row
}

/** 몸(피부) 점들(헤어 좌표, xyz 연속)을 담는다. 칸마다 가장 바깥 반지름 */
export function backBody(profile: BackProfile, points: ArrayLike<number>): void {
  for (let i = 0; i + 2 < points.length; i += 3) {
    const c = backCell(points[i], points[i + 1], points[i + 2])
    if (c < 0) continue
    const r = Math.hypot(points[i], points[i + 2] - BACK_AXIS_Z)
    if (r > profile.body[c]) profile.body[c] = r
  }
}

/** 헤어 점들(헤어 좌표)을 담는다. 칸마다 몸 바깥면에서 1cm 안쪽보다 바깥에 있는 점 중 가장 안쪽 반지름 */
export function backHair(profile: BackProfile, points: ArrayLike<number>): void {
  for (let i = 0; i + 2 < points.length; i += 3) {
    const c = backCell(points[i], points[i + 1], points[i + 2])
    if (c < 0 || profile.body[c] === -Infinity) continue
    const r = Math.hypot(points[i], points[i + 2] - BACK_AXIS_Z)
    if (r > profile.body[c] - 0.01 && r < profile.hair[c]) profile.hair[c] = r
  }
}

/**
 * 칸마다 헤어를 몸 쪽으로 옮길 거리(헤어 좌표, m, +면 안쪽): 그 사람에게서 몸과 가장 안쪽 헤어 사이 틈이
 * 평균 머리(헤어를 만든 몸)에서의 틈보다 넓은 만큼. 좁으면 음수(바깥으로). 몸이 끝난 아래(헤어가 몸 잘린 곳 밑으로
 * 내려온 곳)는 그 각도의 가장 아래 값을 쓰고, 이웃 칸과 가우시안으로 섞어 칸 경계에서 가닥이 꺾이지 않게 한다.
 */
export function backSettleShift(template: BackProfile, person: BackProfile): Float32Array {
  const n = BACK_TURNS * BACK_ROWS
  const value = new Float32Array(n)
  const known = new Float32Array(n)
  for (let c = 0; c < n; c++) {
    const gapT = template.hair[c] - template.body[c]
    const gapP = person.hair[c] - person.body[c]
    if (!Number.isFinite(gapT) || !Number.isFinite(gapP)) continue
    value[c] = Math.max(-BACK_SETTLE_MAX, Math.min(BACK_SETTLE_MAX, gapP - gapT))
    known[c] = 1
  }
  for (let t = 0; t < BACK_TURNS; t++) {
    const base = t * BACK_ROWS
    let lowest = -1
    for (let row = 0; row < BACK_ROWS && lowest < 0; row++) if (known[base + row]) lowest = row
    for (let row = 0; row < lowest; row++) {
      value[base + row] = value[base + lowest]
      known[base + row] = 1
    }
  }
  // 값이 있는 칸만으로 섞는다(가중 평균): 각도로 한 번(둘레로 이어서), 높이로 한 번
  const blur = (
    v: Float32Array,
    w: Float32Array,
    sigma: number,
    along: 'turn' | 'row',
  ): [Float32Array, Float32Array] => {
    const reach = Math.ceil(sigma * 2.5)
    const kernel = Array.from({ length: 2 * reach + 1 }, (_, k) =>
      Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)),
    )
    const ov = new Float32Array(n)
    const ow = new Float32Array(n)
    for (let t = 0; t < BACK_TURNS; t++)
      for (let row = 0; row < BACK_ROWS; row++) {
        let sv = 0
        let sw = 0
        for (let k = -reach; k <= reach; k++) {
          let c: number
          if (along === 'turn')
            c = ((((t + k) % BACK_TURNS) + BACK_TURNS) % BACK_TURNS) * BACK_ROWS + row
          else {
            const r = row + k
            if (r < 0 || r >= BACK_ROWS) continue
            c = t * BACK_ROWS + r
          }
          const g = kernel[k + reach] * w[c]
          sv += g * v[c]
          sw += g
        }
        const c = t * BACK_ROWS + row
        ov[c] = sw > 1e-6 ? sv / sw : 0
        ow[c] = Math.min(1, sw)
      }
    return [ov, ow]
  }
  const [v1, w1] = blur(value, known, 1.5, 'turn')
  const [v2] = blur(v1, w1, 2, 'row')
  return v2
}

/**
 * 목 아래 등 쪽 헤어를 칸마다 옮길 거리(`backSettleShift`)만큼 축 쪽으로 옮긴다(헤어 좌표, 제자리에서 바꾼다).
 * 옮긴 점 수를 돌려준다.
 *
 * 목 아래는 두피 따라 옮기기를 하지 않아(`SKIN_FOLLOW_FROM_Y`) 뒷머리가 평균 몸 자리에 그대로 남는다. 등이 평균보다
 * 앞에 있거나 뒤통수가 커서 가닥이 뒤로 옮겨진 사람은 뒷머리가 등에서 1~2cm 떠 보였다. 점마다 가까운 등 점을 따라가면
 * 가닥이 마디마다 다르게 끌려 물결졌으므로, 가장 안쪽 헤어와 등 사이 틈만 재서 그 칸의 헤어 전체를 같은 거리만큼 옮긴다
 * (층 두께·컬은 그대로). 높이·각도마다 서서히 줄여 뒤통수와 어깨 앞 머리는 건드리지 않는다.
 */
export function settleOnBack(positions: Float32Array, shift: Float32Array): number {
  let moved = 0
  const full = BACK_SETTLE_FROM_Y - BACK_SETTLE_FULL_Y
  const side = BACK_SETTLE_SIDE_TO - BACK_SETTLE_SIDE_FULL
  for (let p = 0; p < positions.length; p += 3) {
    const x = positions[p]
    const y = positions[p + 1]
    const z = positions[p + 2]
    if (y >= BACK_SETTLE_FROM_Y) continue
    const angle = backAngle(x, z)
    const turnAway = Math.abs(angle)
    if (turnAway >= BACK_SETTLE_SIDE_TO) continue
    const a = Math.min(1, (BACK_SETTLE_FROM_Y - y) / full)
    const b = Math.min(1, (BACK_SETTLE_SIDE_TO - turnAway) / side)
    const weight = a * a * (3 - 2 * a) * b * b * (3 - 2 * b)
    // 칸 가운데 사이를 섞는다(각도는 둘레로 이어서, 높이는 끝에서 멈춘다)
    const ft = ((angle + Math.PI) / (2 * Math.PI)) * BACK_TURNS - 0.5
    const fr = Math.min(BACK_ROWS - 1, Math.max(0, (y - BACK_LO_Y) / BACK_CELL_Y - 0.5))
    const t0 = Math.floor(ft)
    const r0 = Math.min(BACK_ROWS - 2, Math.floor(fr))
    const tt = ft - t0
    const tr = fr - r0
    const ta = ((t0 % BACK_TURNS) + BACK_TURNS) % BACK_TURNS
    const tb = (ta + 1) % BACK_TURNS
    const d =
      (1 - tt) * ((1 - tr) * shift[ta * BACK_ROWS + r0] + tr * shift[ta * BACK_ROWS + r0 + 1]) +
      tt * ((1 - tr) * shift[tb * BACK_ROWS + r0] + tr * shift[tb * BACK_ROWS + r0 + 1])
    const step = d * weight
    if (step === 0) continue
    const dz = z - BACK_AXIS_Z
    const r = Math.hypot(x, dz)
    if (r < 1e-6) continue
    const k = Math.max(0, r - step) / r
    positions[p] = x * k
    positions[p + 2] = BACK_AXIS_Z + dz * k
    moved++
  }
  return moved
}

/**
 * 헤어 점들(헤어 좌표, 제자리에서 바꾼다)을 두피 변위 칸(`skinShiftField`)의 둘레 8칸 값을 섞어(삼선형) 옮긴다.
 * 옮긴 점 수를 돌려준다.
 *
 * 헤어는 평균 머리 위에서 만들어 통째로만 맞추므로, 볼·관자놀이가 나온 사람은 피부에 붙은 구레나룻이 피부 안에 묻히고
 * 목이 가는 사람은 뒷머리가 떠서 두피 칠이 보였다. 머리카락 점을 가까운 두피 점에 묶어 그 두피 점이 그 사람에게서 움직인
 * 만큼 같이 옮기면 피부와의 간격이 평균 머리에서와 같게 남는다. 칸 사이 값이 이어져 이웃 점(튜브 한 마디의 꼭짓점)이 같이
 * 움직이므로 마디가 찌그러지지 않는다(점마다 법선으로 밀면 넓적하게 펴졌다).
 */
export function followSkin(positions: Float32Array, field: SkinShiftField): number {
  const [lx, ly, lz] = field.lo
  const [nx, ny, nz] = field.dims
  const { cell, shift } = field
  let moved = 0
  for (let p = 0; p < positions.length; p += 3) {
    const fx = (positions[p] - lx) / cell - 0.5
    const fy = (positions[p + 1] - ly) / cell - 0.5
    const fz = (positions[p + 2] - lz) / cell - 0.5
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    const iz = Math.floor(fz)
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx - 1 || iy >= ny - 1 || iz >= nz - 1) continue
    const tx = fx - ix
    const ty = fy - iy
    const tz = fz - iz
    let sx = 0
    let sy = 0
    let sz = 0
    for (let corner = 0; corner < 8; corner++) {
      const cx = corner & 1
      const cy = (corner >> 1) & 1
      const cz = (corner >> 2) & 1
      const w = (cx ? tx : 1 - tx) * (cy ? ty : 1 - ty) * (cz ? tz : 1 - tz)
      const c = (((ix + cx) * ny + iy + cy) * nz + iz + cz) * 3
      sx += w * shift[c]
      sy += w * shift[c + 1]
      sz += w * shift[c + 2]
    }
    if (sx === 0 && sy === 0 && sz === 0) continue
    positions[p] += sx
    positions[p + 1] += sy
    positions[p + 2] += sz
    moved++
  }
  return moved
}
