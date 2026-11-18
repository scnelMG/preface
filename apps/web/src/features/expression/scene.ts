/**
 * 표정을 얹을 After 모델 준비: 움직일 메쉬(부품)와 템플릿 정점 대응, 눈알과 그 앞 피부, 입술-치아 접촉 대응.
 * 모델이 바뀔 때 한 번 만든다(프레임마다 쓰는 계산은 deform.ts).
 */
import {
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three'
import type { EyeRig } from '@/features/viewer/eyeRig'
import { isAfterOnly, markAfterOnly } from './bus'
import type { ExpressionRig } from './rig'

/**
 * 표정이 움직이는 메쉬. `other`는 치아와 잇몸 경계의 삼각형이다(내보내기가 재질이 섞인 면을 따로 묶는다):
 * 빼면 머리가 돌거나 입이 움직일 때 그 조각만 제자리에 남는다.
 */
const PARTS = ['skin', 'eye', 'iris', 'teeth', 'gums', 'tongue', 'other']

/** MediaPipe 눈꺼풀 가운데 점 [윗눈꺼풀, 아랫눈꺼풀] (두 눈) */
const LID_MIDDLE = [
  [159, 145],
  [386, 374],
]

export interface Eyeball {
  center: number[]
  radius: number
  /** 눈알 앞쪽을 덮는 피부 정점(GLB 정점 번호)과 무표정일 때 눈알 중심까지의 거리 */
  lids: Int32Array
  rest: Float32Array
}

/** 눈 편집이 열린 모델의 피부를 눈 리그로 그릴 때 쓰는 값(`Part.viaEyeRig`) */
export interface ViaEyeRig {
  scratch: Float32Array
  rest: Float32Array
  /** 원래 해상도 피부의 삼각형 번호와, GLB 원래 형상에서 구한 법선·지금 법선(작업용) */
  index: ArrayLike<number>
  normalRest: Float32Array
  normalNow: Float32Array
  /** 눈마다 윗·아랫눈꺼풀 가운데 정점과 무표정 때의 눈 틈·눈 가운데(쌍꺼풀을 눈 뜬 정도에 맞춰 펴는 데 쓴다) */
  lids: { upper: number; lower: number; gap: number; center: number[] }[]
}

export interface Part {
  mesh: Mesh
  name: string
  template: ArrayLike<number>
  /** 표정을 얹기 전 위치(코 편집 등 다른 편집이 쓴 값) */
  base: Float32Array
  /** 눈알·홍채: 정점이 속한 눈(0 = 왼쪽, 1 = 오른쪽) */
  eyeSide: Uint8Array | null
  /** 같은 템플릿 정점에서 갈라진 GLB 정점 묶음(UV 이음새). 법선을 평균해 이음새 줄이 보이지 않게 한다 */
  seams: number[][]
  /**
   * 눈 편집이 열린 모델의 피부: 화면의 형상은 눈 리그가 세분화한 것이라 직접 쓰지 않는다. 원본 정점 기준으로 계산해
   * (`scratch`) GLB 원래 위치(`rest`)와의 차이를 눈 리그에 넘기면, 눈 리그가 세분화 정점으로 옮겨 눈 변형과 합쳐 그린다
   */
  viaEyeRig: ViaEyeRig | null
}

export interface Scene {
  parts: Part[]
  skin: Part | null
  /** 눈알 메시에 맞춘 구의 중심(왼눈, 오른눈). 시선은 이 점을 중심으로 돌린다. 눈알 메시가 없으면 null */
  eyeCenters: [number[], number[]] | null
  eyeballs: Eyeball[]
  /** 접촉: 피부 정점마다 그 템플릿 정점을 쓰는 GLB 정점들, 치아·잇몸 정점마다 [부품, GLB 정점] */
  lipVertices: number[][]
  hard: ([Part, number] | null)[]
  hardNow: Float32Array
  push: Float32Array
  pushBefore: Float32Array
}

function templateOf(geometry: BufferGeometry) {
  return geometry.getAttribute('_TEMPLATE_INDEX') ?? geometry.getAttribute('_template_index')
}

/** Before 모델과 형상을 나눠 쓰지 않도록 After 쪽 형상을 한 번 복제한다 */
function ownGeometry(mesh: Mesh) {
  if (!isAfterOnly(mesh.geometry)) {
    mesh.geometry = mesh.geometry.clone()
    markAfterOnly(mesh.geometry)
  }
  return mesh.geometry as BufferGeometry
}

/**
 * 피부 위에 겹친 메시(헤어의 두피 칠, `scalp-paint`): 피부와 같은 템플릿 정점을 쓰므로 피부와 같은 표정·고개 회전을
 * 얹는다. 따로 두면 고개를 돌릴 때 피부만 돌고 두피 칠은 제자리에 남았다(만두 11/15). 헤어를 씌우고 벗길 때 붙었다
 * 떨어지므로 그때마다 만든다
 */
export function overlayPart(mesh: Mesh): Part | null {
  if (!templateOf(mesh.geometry)) return null
  const geometry = ownGeometry(mesh)
  return {
    mesh,
    name: mesh.name,
    template: templateOf(geometry).array,
    base: Float32Array.from(geometry.getAttribute('position').array as Float32Array),
    eyeSide: null,
    seams: [],
    viaEyeRig: null,
  }
}

export const distance = (a: Float32Array, i: number, c: number[]) =>
  Math.hypot(a[3 * i] - c[0], a[3 * i + 1] - c[1], a[3 * i + 2] - c[2])

/** 템플릿 정점 번호 → 그 번호를 쓰는 정점들 */
function verticesByTemplate(template: ArrayLike<number>) {
  const of = new Map<number, number[]>()
  for (let i = 0; i < template.length; i++) {
    const list = of.get(template[i])
    if (list) list.push(i)
    else of.set(template[i], [i])
  }
  return of
}

/**
 * 정점 법선(면적 가중). 같은 템플릿 정점에서 갈라진 정점(UV 이음새)은 한 법선을 나눠 쓴다 → 이음새에 줄이 생기지 않는다
 */
export function templateNormals(
  positions: Float32Array,
  index: ArrayLike<number>,
  template: ArrayLike<number>,
  out: Float32Array,
) {
  let size = 0
  for (let i = 0; i < template.length; i++) if (template[i] >= size) size = template[i] + 1
  const sum = new Float32Array(size * 3)
  for (let f = 0; f < index.length; f += 3) {
    const a = 3 * index[f]
    const b = 3 * index[f + 1]
    const c = 3 * index[f + 2]
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const corner of [index[f], index[f + 1], index[f + 2]]) {
      const t = 3 * template[corner]
      sum[t] += nx
      sum[t + 1] += ny
      sum[t + 2] += nz
    }
  }
  for (let i = 0; i < template.length; i++) {
    const t = 3 * template[i]
    const len = Math.hypot(sum[t], sum[t + 1], sum[t + 2]) || 1
    out[3 * i] = sum[t] / len
    out[3 * i + 1] = sum[t + 1] / len
    out[3 * i + 2] = sum[t + 2] / len
  }
  return out
}

/** 눈 리그가 세분화한 피부: 원래 해상도 피부(`original`의 skin)를 기준으로 계산할 준비 */
function eyeRigSkinPart(eyeSkin: Mesh, original: Object3D, rig: ExpressionRig): Part | null {
  const source = original.getObjectByName('skin')
  if (!(source instanceof Mesh) || !templateOf(source.geometry) || !source.geometry.index)
    return null
  const rest = Float32Array.from(source.geometry.getAttribute('position').array as Float32Array)
  const index = source.geometry.index.array
  const template = templateOf(source.geometry).array
  return {
    mesh: eyeSkin,
    name: 'skin',
    template,
    base: Float32Array.from(rest),
    eyeSide: null,
    seams: [],
    viaEyeRig: {
      scratch: new Float32Array(rest.length),
      rest,
      index,
      normalRest: templateNormals(rest, index, template, new Float32Array(rest.length)),
      normalNow: new Float32Array(rest.length),
      lids: LID_MIDDLE.flatMap(([upper, lower]) => {
        const a = Array.prototype.indexOf.call(template, rig.lid[upper])
        const b = Array.prototype.indexOf.call(template, rig.lid[lower])
        if (a < 0 || b < 0) return []
        const at = (i: number) => [rest[3 * i], rest[3 * i + 1], rest[3 * i + 2]]
        const center = at(a).map((v, k) => (v + at(b)[k]) / 2)
        return [{ upper: a, lower: b, gap: distance(rest, a, at(b)), center }]
      }),
    },
  }
}

/** 치아·잇몸·혀(와 그 경계 조각)는 리그가 준 자리(입 안에 맞게 다시 놓은 무표정 위치)와 색에서 시작한다 */
function placeMouth(object: Mesh, template: ArrayLike<number>, rig: ExpressionRig) {
  if (!rig.placed) return
  const geometry: BufferGeometry = object.geometry
  const position = geometry.getAttribute('position')
  const array = position.array as Float32Array
  const { at, pos, rgb } = rig.placed
  const color = rgb ? new Float32Array(template.length * 3).fill(1) : null
  let placed = false
  for (let i = 0; i < template.length; i++) {
    const j = at.get(template[i])
    if (j === undefined) continue
    array.set(pos.subarray(3 * j, 3 * j + 3), 3 * i)
    if (color && rgb) color.set(rgb.subarray(3 * j, 3 * j + 3), 3 * i)
    placed = true
  }
  if (!placed) return
  position.needsUpdate = true
  geometry.computeVertexNormals()
  if (color && object.material instanceof MeshStandardMaterial) {
    // 치아가 흰 띠 하나로 보이지 않게: 재질 단색 대신 정점 색(바탕색 × 입 안 깊이 × 치아 사이 음영)
    geometry.setAttribute('color', new BufferAttribute(color, 3))
    const material = object.material.clone()
    material.color.setRGB(1, 1, 1)
    material.vertexColors = true
    object.material = material
  }
}

/**
 * 점들에 맞춘 구(최소제곱: |p|² = 2c·p + (r² − |c|²)를 c, r에 대해 푼다). 점이 모자라거나 풀리지 않으면 null
 */
function fitSphere(points: Float32Array, pick: (i: number) => boolean) {
  const A = Array.from({ length: 4 }, () => [0, 0, 0, 0, 0])
  let count = 0
  for (let i = 0; i < points.length / 3; i++) {
    if (!pick(i)) continue
    const x = points[3 * i]
    const y = points[3 * i + 1]
    const z = points[3 * i + 2]
    const row = [2 * x, 2 * y, 2 * z, 1, x * x + y * y + z * z]
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) A[r][c] += row[r] * row[c]
    count++
  }
  if (count < 20) return null
  // 가우스 소거(부분 피벗)
  for (let i = 0; i < 4; i++) {
    let p = i
    for (let k = i + 1; k < 4; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k
    ;[A[i], A[p]] = [A[p], A[i]]
    if (Math.abs(A[i][i]) < 1e-30) return null
    for (let k = 0; k < 4; k++) {
      if (k === i) continue
      const f = A[k][i] / A[i][i]
      for (let j = i; j < 5; j++) A[k][j] -= f * A[i][j]
    }
  }
  const center = [0, 1, 2].map((k) => A[k][4] / A[k][k])
  const radius = Math.sqrt(A[3][4] / A[3][3] + center[0] ** 2 + center[1] ** 2 + center[2] ** 2)
  return Number.isFinite(radius) ? { center, radius } : null
}

/**
 * 눈알마다 메시에 맞춘 구. rig의 눈 중심(`eyes.L/R.center`)은 눈알 구의 중심이 아니다: 0e91d7f1에서 4.4 mm 앞에 있어
 * 그 점에서 잰 눈알 정점 거리가 반지름의 0.65~1.44배로 흩어졌다(맞춘 구는 0.98~1.03배, 11/15). 그 구로 눈꺼풀을 밀면
 * 눈알을 뚫지 않는 아랫눈꺼풀까지 밀려 애굣살이 두툼하게 부풀었고, 그 점을 축으로 시선을 돌리면 눈알이 옆으로 밀렸다
 */
function fitEyeballs(eye: Part | undefined) {
  if (!eye?.eyeSide) return null
  const sides = eye.eyeSide
  const fits = [0, 1].map((side) => fitSphere(eye.base, (i) => sides[i] === side))
  return fits[0] && fits[1]
    ? (fits as [NonNullable<(typeof fits)[0]>, NonNullable<(typeof fits)[0]>])
    : null
}

/** 눈알 앞을 덮는 피부 정점과 무표정일 때 눈알 중심까지의 거리 */
function findEyeballs(
  skin: Part | null,
  balls: { center: number[]; radius: number }[],
  rig: ExpressionRig,
): Eyeball[] {
  if (!skin) return []
  const fwd = rig.axes.fwd
  const b = skin.base
  return balls.map(({ center, radius }) => {
    const lids: number[] = []
    for (let i = 0; i < b.length / 3; i++) {
      const d = distance(b, i, center)
      const front =
        (b[3 * i] - center[0]) * fwd[0] +
        (b[3 * i + 1] - center[1]) * fwd[1] +
        (b[3 * i + 2] - center[2]) * fwd[2]
      if (d >= 0.85 * radius && d < 1.9 * radius && front > 0) lids.push(i)
    }
    return {
      center,
      radius,
      lids: Int32Array.from(lids),
      rest: Float32Array.from(lids, (i) => distance(b, i, center)),
    }
  })
}

export function prepareScene(
  after: Object3D,
  rig: ExpressionRig,
  eyeRig: EyeRig | null,
  original: Object3D,
): Scene {
  const parts: Part[] = []
  const eyeSkin = eyeRig?.skins[0]?.mesh ?? null
  const viaEyeRig = eyeSkin ? eyeRigSkinPart(eyeSkin, original, rig) : null
  if (viaEyeRig) parts.push(viaEyeRig)
  after.traverse((object) => {
    if (!(object instanceof Mesh) || !PARTS.includes(object.name)) return
    if (object === eyeSkin) return
    if (!templateOf(object.geometry)) return
    const template = templateOf(ownGeometry(object)).array
    if (object.name !== 'skin') placeMouth(object, template, rig)
    const array = object.geometry.getAttribute('position').array as Float32Array
    let eyeSide: Uint8Array | null = null
    if (rig.eyes && (object.name === 'eye' || object.name === 'iris')) {
      const { L, R } = rig.eyes
      eyeSide = Uint8Array.from({ length: template.length }, (_, i) =>
        distance(array, i, L) <= distance(array, i, R) ? 0 : 1,
      )
    }
    parts.push({
      mesh: object,
      name: object.name,
      template,
      base: Float32Array.from(array),
      eyeSide,
      seams:
        object.name === 'skin'
          ? [...verticesByTemplate(template).values()].filter((list) => list.length > 1)
          : [],
      viaEyeRig: null,
    })
  })
  const skin = parts.find((part) => part.name === 'skin') ?? null
  const balls = fitEyeballs(parts.find((part) => part.name === 'eye'))
  const eyeballs = findEyeballs(skin, balls ?? [], rig)
  // 입술-치아 접촉에 쓸 대응
  let lipVertices: number[][] = []
  let hard: ([Part, number] | null)[] = []
  if (skin && rig.contact) {
    const of = verticesByTemplate(skin.template)
    lipVertices = Array.from(rig.contact.v, (vertex) => of.get(vertex) ?? [])
    const where = new Map<number, [Part, number]>()
    for (const part of parts)
      if (part !== skin)
        for (let i = 0; i < part.template.length; i++)
          if (!where.has(part.template[i])) where.set(part.template[i], [part, i])
    hard = Array.from(rig.contact.hard, (vertex) => where.get(vertex) ?? null)
  }
  return {
    parts,
    skin,
    eyeCenters: balls ? [balls[0].center, balls[1].center] : null,
    eyeballs,
    lipVertices,
    hard,
    hardNow: new Float32Array(hard.length * 3),
    push: new Float32Array(lipVertices.length * 3),
    pushBefore: new Float32Array(lipVertices.length * 3),
  }
}
