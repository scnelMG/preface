import {
  backBody,
  backHair,
  backProfile,
  backSettleShift,
  type BackProfile,
  bendFront,
  followEars,
  followSkin,
  followStrands,
  type HairFit,
  type HairlineAnchor,
  pushOutWithGrid,
  settleOnBack,
  SKIN_CLEAR,
  SKIN_REACH,
  skinPushGrid,
  type SkinPushGrid,
  skinShiftField,
  type SkinShiftField,
  skinShifts,
  type SkinSurface,
  strandLabels,
  type TemplateSkin,
} from '@/features/edit/hair/hairFit'
import { fitOffEars, pushRings, strandStarts } from '@/features/edit/hair/earFit'

/**
 * 헤어 맞춤 계산의 typed array 부분(S15P31B204-861). three 객체 없이 배열만 다뤄 Worker(hairFit.worker.ts)와 화면 스레드
 * (Worker를 못 쓸 때)가 같은 코드를 돈다.
 *
 * 레이어드컷은 맞추는 데 2~4초가 걸려 화면 스레드에서 돌리면 그동안 화면이 멈췄다. 계산은 두 갈래로 나눈다.
 * - 머리마다 한 번(`prepareHairHead`): 두피 변위 칸(`skinShifts` → `skinShiftField`, 약 0.2초), 피부 밖 밀기 칸 격자,
 *   등 맞추기의 몸 둘레. 헤어와 상관없어 같은 머리에 다른 헤어를 맞출 때 다시 쓴다.
 * - 헤어마다(`fitHairParts`): 메시 점을 옮긴다. 가닥 대표 번호(`strandLabels`)는 헤어 파일에만 달려 머리를 바꿔도 다시 쓴다.
 *
 * 순서와 식은 화면 스레드에서 하던 맞춤(HairLayer `fittedCopy`, -792·-795·-805)과 같다. 행렬은 화면 쪽이 three로 구해
 * `Matrix4.elements`(열 우선) 그대로 넘긴다(역행렬 계산을 따로 두지 않아 결과가 같다).
 */

/**
 * 템플릿 피부는 머리 메시지마다 복사돼 새 객체로 온다. 내용이 같으면 처음 받은 객체를 다시 써, 템플릿 피부에만 달린
 * 계산(hairFit `onceForSkin`)을 머리마다 되풀이하지 않는다. 템플릿 피부는 파일 하나(gnm-skin.bin)라 하나만 기억한다
 */
let knownTemplateSkin: TemplateSkin | null = null
function sameTemplateSkin(skin: TemplateSkin | null) {
  if (skin && !(knownTemplateSkin && sameSkin(skin, knownTemplateSkin))) knownTemplateSkin = skin
  return skin && knownTemplateSkin
}

/** 템플릿 피부 두 개가 같은 내용인가(번호·위치·귀 표시) */
function sameSkin(a: TemplateSkin, b: TemplateSkin) {
  const same = (x: ArrayLike<number>, y: ArrayLike<number>) => {
    if (x.length !== y.length) return false
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
    return true
  }
  return same(a.ids, b.ids) && same(a.points, b.points) && same(a.ear, b.ear)
}

/** three `Matrix4.elements`(열 우선 16개) */
export type Mat4 = readonly number[]

/** 머리 하나의 맞춤 입력(헤어와 상관없다) */
export interface HairHeadInput {
  fit: HairFit
  /** 귀 둘레 옮기기(`earAnchors`). 가닥 방식 헤어는 쓰지 않는다 */
  ears: HairlineAnchor[]
  /** 사람 피부 정점·법선(머리 좌표). 피부가 없으면 null */
  surface: SkinSurface | null
  /** 평균 머리 피부(gnm-skin.bin). 못 받았으면 null */
  templateSkin: TemplateSkin | null
  /** 템플릿 점 번호 × 3 → 사람 피부의 그 점(머리 좌표, 없으면 NaN). 피부나 템플릿 피부가 없으면 null */
  personByTemplate: Float64Array | null
  /** 헤어 좌표 → 머리 좌표와 그 역행렬 */
  toHead: Mat4
  fromHead: Mat4
  /** 사람 귀 삼각형(머리 좌표, xyz 9개씩, S15P31B204-919). 피부나 템플릿 피부가 없으면 없다 */
  earTris?: Float32Array | null
}

/** 머리마다 한 번 구해 두는 값 */
export interface HairHead {
  input: HairHeadInput
  field: SkinShiftField | null
  pushGrid: SkinPushGrid | null
  /** 등 맞추기의 몸 둘레(평균 몸, 그 사람 몸). 템플릿 피부와 사람 피부가 다 있어야 한다 */
  settle: { template: Float32Array; person: Float32Array } | null
}

export function prepareHairHead(input: HairHeadInput): HairHead {
  const { fit, surface, templateSkin, personByTemplate } = input
  const field =
    templateSkin && personByTemplate
      ? skinShiftField(
          templateSkin,
          skinShifts(templateSkin, fit, (vertex) => {
            const x = personByTemplate[vertex * 3]
            if (x === undefined || Number.isNaN(x)) return null
            return [x, personByTemplate[vertex * 3 + 1], personByTemplate[vertex * 3 + 2]]
          }),
        )
      : null
  const pushGrid = surface ? skinPushGrid(surface, SKIN_REACH * fit.scale) : null
  let settle: HairHead['settle'] = null
  if (templateSkin && surface) {
    const template = backProfile()
    backBody(template, templateSkin.points)
    const person = backProfile()
    const body = surface.points.slice()
    applyAffine(body, input.fromHead)
    backBody(person, body)
    settle = { template: template.body, person: person.body }
  }
  return { input, field, pushGrid, settle }
}

/** 헤어 메시 하나의 입력 */
export interface HairPartInput {
  /** 헤어 좌표(장면 루트 기준) 위치. 제자리에서 바꿔 메시 좌표로 돌려준다 */
  xyz: Float32Array
  /** 가닥 대표 번호(`strandLabels`). 가닥 방식이 아니거나 삼각형이 없으면 null */
  labels: Int32Array | null
  /** 가닥마다 첫 정점 번호(`strandStarts`)와 삼각형 번호. 가닥 방식일 때만 */
  starts?: Int32Array | null
  index?: ArrayLike<number> | null
  /** 헤어 좌표 → 메시 좌표 */
  toMesh: Mat4
  /** 머리 좌표 → 메시 좌표(`toMesh × fromHead`) */
  back: Mat4
}

export interface HairPartResult {
  /** 맞춘 위치(메시 좌표) */
  xyz: Float32Array
  /** three `computeBoundingSphere`와 같은 값 */
  center: [number, number, number]
  radius: number
  /** 귀에 맞춰 잘라 낸 가닥이 있으면 새 삼각형 번호(`fitOffEars`) */
  index?: Uint32Array
}

/** 귀 맞춤 설정(헤어 목록 `earFit`) */
export interface EarFitOption {
  keep: number
}

/**
 * 헤어 메시들을 그 머리에 맞춘다(제자리에서 바꾼다). 앞부분 옮기기(bendFront) → 귀(followEars) → 두피 따라 옮기기
 * (followSkin·followStrands) → 등 맞추기(settleOnBack) → 피부 밖 밀기(pushOutOfSkin, 머리 좌표) → 메시 좌표.
 */
export function fitHairParts(
  head: HairHead,
  anchors: readonly HairlineAnchor[],
  byRoot: boolean,
  parts: readonly HairPartInput[],
  earFit: EarFitOption | null = null,
): HairPartResult[] {
  const { input, field, pushGrid } = head
  // 머리 좌표의 얼굴 쪽(앞) = 헤어 좌표 +z를 옮긴 방향(toHead 셋째 열)
  const t = input.toHead
  const length = Math.hypot(t[8], t[9], t[10]) || 1
  const forward: [number, number, number] = [t[8] / length, t[9] / length, t[10] / length]
  const ears = byRoot ? [] : input.ears
  // 등 맞추기: 평균 머리에서의 몸·헤어 틈(맞추기 전 헤어)과 그 사람에게서의 틈(맞춘 헤어)을 비교한다
  const settle: { template: BackProfile; person: BackProfile } | null = head.settle
    ? {
        template: { body: head.settle.template, hair: backProfile().hair },
        person: { body: head.settle.person, hair: backProfile().hair },
      }
    : null
  for (const { xyz, labels } of parts) {
    if (settle) backHair(settle.template, xyz)
    bendFront(xyz, anchors)
    followEars(xyz, ears)
    if (field && byRoot && labels) followStrands(xyz, labels, field)
    else if (field) followSkin(xyz, field)
    if (settle) backHair(settle.person, xyz)
  }
  const shift = settle ? backSettleShift(settle.template, settle.person) : null
  return parts.map(({ xyz, toMesh, back, labels, starts, index }) => {
    if (shift) settleOnBack(xyz, shift)
    let cut: Uint32Array | null = null
    if (input.surface) {
      // 피부 밖 밀기는 머리 좌표에서 한다(가까운 피부 점을 찾는 칸이 사람 피부 기준이다)
      applyAffine(xyz, input.toHead)
      // 가닥 튜브는 고리(점 4개)째 민다. 점마다 밀면 가닥이 넓적한 삼각형으로 벌어졌다(-919)
      const push = () => {
        if (!pushGrid) return
        const before = labels && starts ? xyz.slice() : null
        pushOutWithGrid(xyz, pushGrid, SKIN_CLEAR * input.fit.scale)
        if (before && labels && starts) pushRings(before, xyz, labels, starts)
      }
      push()
      if (earFit && labels && starts && index && input.earTris?.length) {
        cut = fitOffEars(xyz, index, labels, starts, input.earTris, {
          unit: 0.001 * input.fit.scale,
          forward,
          keep: earFit.keep,
        }).index
        // 앞으로 옮긴 가닥이 볼에 닿을 수 있어 귀 둘레(귀 상자 + 2cm)만 한 번 더 민다(전체를 다시 밀면 0.3초 더 걸렸다)
        if (pushGrid)
          pushAround(
            xyz,
            input.earTris,
            0.02 * input.fit.scale,
            (points) => {
              pushOutWithGrid(points, pushGrid, SKIN_CLEAR * input.fit.scale)
            },
            labels,
            starts,
          )
      }
      applyAffine(xyz, back)
    } else applyAffine(xyz, toMesh)
    return { xyz, ...boundingSphereOf(xyz), ...(cut ? { index: cut } : {}) }
  })
}

/**
 * 귀 삼각형 상자(`margin` 여유) 안의 점만 모아 `push`로 밀고 되돌려 넣은 뒤 고리째 맞춘다(제자리, -919)
 */
function pushAround(
  xyz: Float32Array,
  earTris: Float32Array,
  margin: number,
  push: (points: Float32Array) => void,
  labels: Int32Array,
  starts: Int32Array,
) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < earTris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], earTris[i + k] - margin)
      hi[k] = Math.max(hi[k], earTris[i + k] + margin)
    }
  const count = xyz.length / 3
  const picked = new Int32Array(count)
  let n = 0
  for (let v = 0; v < count; v++) {
    const x = xyz[v * 3]
    const y = xyz[v * 3 + 1]
    const z = xyz[v * 3 + 2]
    if (x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2])
      picked[n++] = v
  }
  if (!n) return
  const before = xyz.slice()
  const points = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const v = picked[i] * 3
    points[i * 3] = xyz[v]
    points[i * 3 + 1] = xyz[v + 1]
    points[i * 3 + 2] = xyz[v + 2]
  }
  push(points)
  for (let i = 0; i < n; i++) {
    const v = picked[i] * 3
    xyz[v] = points[i * 3]
    xyz[v + 1] = points[i * 3 + 1]
    xyz[v + 2] = points[i * 3 + 2]
  }
  pushRings(before, xyz, labels, starts)
}

/** 점들(xyz 연속)에 행렬(열 우선)을 곱한다(제자리에서, 원근 없는 변환) */
export function applyAffine(xyz: Float32Array, e: Mat4) {
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i]
    const y = xyz[i + 1]
    const z = xyz[i + 2]
    xyz[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    xyz[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    xyz[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
}

/**
 * three `BufferGeometry.computeBoundingSphere`와 같은 식(경계 상자 가운데, 가장 먼 점까지 거리). 5백만 점이 넘는 헤어에서
 * 화면 스레드가 다시 돌지 않게 여기서 구해 넘긴다
 */
export function boundingSphereOf(xyz: Float32Array): {
  center: [number, number, number]
  radius: number
} {
  if (xyz.length < 3) return { center: [0, 0, 0], radius: 0 }
  let lx = Infinity
  let ly = Infinity
  let lz = Infinity
  let hx = -Infinity
  let hy = -Infinity
  let hz = -Infinity
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i]
    const y = xyz[i + 1]
    const z = xyz[i + 2]
    if (x < lx) lx = x
    if (y < ly) ly = y
    if (z < lz) lz = z
    if (x > hx) hx = x
    if (y > hy) hy = y
    if (z > hz) hz = z
  }
  const cx = (lx + hx) * 0.5
  const cy = (ly + hy) * 0.5
  const cz = (lz + hz) * 0.5
  let max = 0
  for (let i = 0; i < xyz.length; i += 3) {
    const dx = cx - xyz[i]
    const dy = cy - xyz[i + 1]
    const dz = cz - xyz[i + 2]
    max = Math.max(max, dx * dx + dy * dy + dz * dz)
  }
  return { center: [cx, cy, cz], radius: Math.sqrt(max) }
}

/** Worker에 보내는 요청 */
export type HairFitRequest =
  | { type: 'head'; headId: number; input: HairHeadInput }
  /** 머리 하나(`headId`) 또는 전부(없으면)의 값을 버린다. 전부 버리면 가닥 대표 번호도 버린다 */
  | { type: 'drop'; headId?: number }
  | {
      type: 'fit'
      id: number
      headId: number
      anchors: HairlineAnchor[]
      byRoot: boolean
      /** 그 사람 귀에 맞추기(헤어 목록 `earFit`). 가닥 방식에서만 쓴다 */
      earFit?: EarFitOption | null
      parts: {
        xyz: Float32Array
        toMesh: number[]
        back: number[]
        /** 가닥 대표 번호를 남겨 둘 이름(헤어·메시). 가닥 방식이 아니면 null */
        strandKey: string | null
        /** 그 이름으로 남긴 번호가 없을 때만 보내는 삼각형 번호(복사본) */
        index?: ArrayLike<number>
      }[]
    }

export type HairFitResponse =
  | { type: 'result'; id: number; parts: HairPartResult[] }
  | { type: 'error'; id: number; message: string }

/**
 * 요청을 처리하는 상태(머리별 값, 헤어별 가닥 번호)와 처리 함수. Worker 파일은 이것을 메시지에 잇기만 하고, Worker를
 * 못 쓰면 화면 스레드가 같은 것을 바로 부른다. 결과 위치 배열은 옮겨 보낼(transfer) 목록과 같이 돌려준다.
 */
export function createHairFitHandler() {
  const heads = new Map<number, HairHead>()
  /** 헤어 메시마다 가닥 번호·첫 번호·삼각형 번호(처음 한 번 받는다) */
  const strands = new Map<
    string,
    { labels: Int32Array; starts: Int32Array; index: ArrayLike<number> }
  >()
  return (
    message: HairFitRequest,
  ): { response: HairFitResponse; transfer: ArrayBuffer[] } | null => {
    if (message.type === 'head') {
      const input = message.input
      heads.set(
        message.headId,
        prepareHairHead({ ...input, templateSkin: sameTemplateSkin(input.templateSkin) }),
      )
      return null
    }
    if (message.type === 'drop') {
      if (message.headId === undefined) {
        heads.clear()
        strands.clear()
      } else heads.delete(message.headId)
      return null
    }
    try {
      const head = heads.get(message.headId)
      if (!head) throw new Error('맞출 머리 정보가 없어요')
      const parts = message.parts.map(({ xyz, toMesh, back, strandKey, index }) => {
        if (!strandKey) return { xyz, labels: null, toMesh, back }
        let strand = strands.get(strandKey)
        if (!strand && index) {
          const labels = strandLabels(index, xyz.length / 3)
          strand = { labels, starts: strandStarts(labels), index }
          strands.set(strandKey, strand)
        }
        if (!strand) throw new Error('가닥 정보가 없어요')
        return { xyz, ...strand, toMesh, back }
      })
      const results = fitHairParts(
        head,
        message.anchors,
        message.byRoot,
        parts,
        message.earFit ?? null,
      )
      const transfer: ArrayBuffer[] = []
      for (const part of results) {
        transfer.push(part.xyz.buffer as ArrayBuffer)
        if (part.index) transfer.push(part.index.buffer as ArrayBuffer)
      }
      return { response: { type: 'result', id: message.id, parts: results }, transfer }
    } catch (error) {
      return {
        response: {
          type: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : '헤어 맞춤 계산 실패',
        },
        transfer: [],
      }
    }
  }
}
