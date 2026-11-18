import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  type InterleavedBufferAttribute,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hairAssetOfUrl, hairUrlOf } from '@/features/edit/hair/catalog'
import { pushRings, strandStarts } from '@/features/edit/hair/earFit'
import {
  backBody,
  backHair,
  backProfile,
  backSettleShift,
  bendFront,
  earAnchors,
  expectedScale,
  fitHairToHead,
  fitHairToLandmarks,
  followEars,
  followSkin,
  followSkinByStrand,
  type HairFit,
  type HairlineAnchor,
  hairlineAnchors,
  hairlineCurve,
  pushOutOfSkin,
  readHairline,
  readTemplateSkin,
  settleOnBack,
  SKIN_CLEAR,
  SKIN_REACH,
  skinShiftField,
  type SkinShiftField,
  skinShifts,
  strandLabels,
  type SkinSurface,
  type TemplateSkin,
} from '@/features/edit/hair/hairFit'
import { createHairFitHandler, type HairFitRequest } from './hairFitCore'
import { fitHairFor, hairFitKey, releaseHairFits, takeFit } from './hairFitClient'
import { hairPrefetchList, heavyHairPrefetchAllowed } from './useHairPrefetch'

/**
 * Worker 헤어 맞춤(S15P31B204-861)이 화면 스레드에서 하던 맞춤(-861 이전 HairLayer `fittedCopy`)과 같은 점을 내는지 본다.
 * 머리는 체험 기본 모델(base-female.glb) 피부, 헤어는 그 두피에서 뻗은 작은 합성 가닥(정규화 Int16 위치, 메시 배율)이다.
 * Worker는 메시지를 structuredClone(transfer 포함)으로 넘기는 가짜로 바꿔, 실제처럼 배열이 복사·이동된 뒤의 결과를 비교한다.
 */

// ---- 머리·헤어 만들기 ----

function readGlb(name: string) {
  const glb = readFileSync(resolve(process.cwd(), `public/models/${name}.glb`))
  const jsonLength = glb.readUInt32LE(12)
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength + 8
  const node = json.nodes.find((n: { name?: string }) => n.name === 'skin')
  const attributes = json.meshes[node.mesh].primitives[0].attributes
  const read = (accessorIndex: number) => {
    const accessor = json.accessors[accessorIndex]
    const view = json.bufferViews[accessor.bufferView]
    const offset = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const size = accessor.type === 'VEC3' ? 3 : 1
    const bytes = glb.buffer.slice(
      glb.byteOffset + offset,
      glb.byteOffset + offset + accessor.count * size * 4,
    )
    return accessor.componentType === 5126 ? new Float32Array(bytes) : new Uint32Array(bytes)
  }
  return {
    position: read(attributes.POSITION) as Float32Array,
    normal: read(attributes.NORMAL) as Float32Array,
    template: read(attributes._TEMPLATE_INDEX),
  }
}

const templateSkin = readTemplateSkin(
  (() => {
    const file = readFileSync(resolve(process.cwd(), 'public/hair/gnm-skin.bin'))
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  })(),
)!

/** 기본 모델 머리. `shift`만큼 옮기고 `scale`만큼 키운 사본을 만들어 다른 머리처럼 쓴다 */
function makeHead(name: string, shift = 0, scale = 1): Object3D {
  const { position, normal, template } = readGlb(name)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position.slice(), 3))
  geometry.setAttribute('normal', new BufferAttribute(normal.slice(), 3))
  geometry.setAttribute('_TEMPLATE_INDEX', new BufferAttribute(template.slice(), 1))
  const skin = new Mesh(geometry)
  skin.name = 'skin'
  const root = new Group()
  root.add(skin)
  root.position.set(0, shift, shift / 2)
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)
  return root
}

/**
 * 템플릿 두피 점에서 뻗은 가닥(점 4쌍, 삼각형 6개). 뒤쪽 일부는 목 아래까지 내려 등 맞추기도 거친다.
 * 위치는 glTF 압축처럼 정규화 Int16, 메시 배율·이동으로 헤어 좌표가 된다
 */
function makeHair(): Object3D {
  const points: number[] = []
  const index: number[] = []
  const p = templateSkin.points
  for (let i = 0; i < templateSkin.ids.length; i += 37) {
    const x = p[i * 3]
    const y = p[i * 3 + 1]
    const z = p[i * 3 + 2]
    if (y < 0.24 || templateSkin.ear[i]) continue
    const len = z < -0.02 ? 0.22 : 0.04
    const base = points.length / 3
    for (let k = 0; k < 4; k++) {
      const t = k / 3
      const out = 1.003 + 0.05 * t
      points.push(x * out, y + 0.004 - len * t, z * out - (z < 0 ? 0.01 * t : 0))
      points.push(x * out + 0.002, y + 0.004 - len * t, z * out + 0.001)
    }
    for (let k = 0; k < 3; k++) {
      const a = base + k * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const extent = 0.6
  const quantized = new Int16Array(points.length)
  for (let i = 0; i < points.length; i++) {
    quantized[i] = Math.round(((points[i] - (i % 3 === 1 ? 0.1 : 0)) / extent) * 32767)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(quantized, 3, true))
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1))
  const mesh = new Mesh(geometry, new MeshStandardMaterial())
  mesh.scale.setScalar(extent)
  mesh.position.set(0, 0.1, 0)
  const scene = new Group()
  scene.add(mesh)
  return scene
}

/** 템플릿 피부에서 헤어의 앞쪽 경계에 가장 가까운 점들로 만든 사람 헤어라인(형식만 head.glb와 같다) */
function makeHairline(url: string) {
  const edge = hairAssetOfUrl(url)!.hairline!
  const points = edge.map((at) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < templateSkin.ids.length; i++) {
      const d =
        (templateSkin.points[i * 3] - at[0]) ** 2 +
        (templateSkin.points[i * 3 + 1] - at[1] - 0.004) ** 2 +
        (templateSkin.points[i * 3 + 2] - at[2]) ** 2
      if (d < bestD) {
        bestD = d
        best = templateSkin.ids[i]
      }
    }
    return [best, best, best, 1, 0]
  })
  return { version: 1, points }
}

// ---- -861 이전 화면 스레드 맞춤(HairLayer.tsx에서 그대로 옮긴 기준) ----

function legacyFit(head: Object3D, url: string, scene: Object3D, hairline: unknown) {
  let skin: Mesh | null = null
  head.traverse((object) => {
    if (!skin && object instanceof Mesh && object.name === 'skin') skin = object
  })
  head.updateMatrixWorld(true)
  const pointOf = skin ? legacyTemplatePoints(skin) : () => null
  const landmarkFit = skin ? fitHairToLandmarks(pointOf) : null
  const box = new Box3().setFromObject(skin ?? head, true)
  const fit =
    landmarkFit ??
    fitHairToHead(
      { min: box.min.toArray(), max: box.max.toArray() },
      undefined,
      expectedScale(pointOf),
    )
  const points = readHairline(hairline)
  const asset = hairAssetOfUrl(url)
  const edge = asset?.hairline ?? null
  const curve = points ? hairlineCurve(points, pointOf) : []
  const anchors = edge && curve.length ? hairlineAnchors(fit, curve, edge, pointOf) : []
  const surface = skin ? legacySkinSurface(skin) : null
  const ears = skin ? earAnchors(fit, pointOf) : []
  const field = skin ? skinShiftField(templateSkin, skinShifts(templateSkin, fit, pointOf)) : null
  const byRoot = asset?.skinFollow === 'root'
  return legacyFittedCopy(
    scene,
    fit,
    anchors,
    byRoot ? [] : ears,
    field,
    surface,
    byRoot,
    templateSkin,
  )
}

function legacyFittedCopy(
  scene: Object3D,
  fit: HairFit,
  anchors: readonly HairlineAnchor[],
  ears: readonly HairlineAnchor[],
  field: SkinShiftField | null,
  surface: SkinSurface | null,
  byRoot: boolean,
  templateSkin: TemplateSkin | null,
) {
  const copy = scene.clone(true)
  copy.position.set(0, 0, 0)
  copy.rotation.set(0, 0, 0)
  copy.scale.setScalar(1)
  copy.updateMatrixWorld(true)
  const geometries: BufferGeometry[] = []
  const toHead = legacyHeadMatrix(fit)
  const fromHead = toHead.clone().invert()
  const settle = templateSkin && surface ? { template: backProfile(), person: backProfile() } : null
  if (settle && templateSkin && surface) {
    backBody(settle.template, templateSkin.points)
    const body = surface.points.slice()
    legacyApplyAffine(body, fromHead)
    backBody(settle.person, body)
  }
  const parts: { mesh: Mesh; geometry: BufferGeometry; xyz: Float32Array; toMesh: Matrix4 }[] = []
  copy.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const geometry = new BufferGeometry()
    geometry.setIndex(object.geometry.getIndex())
    for (const [name, attribute] of Object.entries((object.geometry as BufferGeometry).attributes))
      geometry.setAttribute(name, attribute)
    const position = geometry.getAttribute('position')
    const toHair = object.matrixWorld.clone()
    const xyz = legacyHairPositions(position, toHair)
    if (settle) backHair(settle.template, xyz)
    bendFront(xyz, anchors)
    followEars(xyz, ears)
    const index = geometry.getIndex()
    if (field && byRoot && index) followSkinByStrand(xyz, index.array, field)
    else if (field) followSkin(xyz, field)
    if (settle) backHair(settle.person, xyz)
    parts.push({ mesh: object, geometry, xyz, toMesh: toHair.invert() })
  })
  const shift = settle ? backSettleShift(settle.template, settle.person) : null
  for (const { mesh, geometry, xyz, toMesh } of parts) {
    if (shift) settleOnBack(xyz, shift)
    if (surface) {
      legacyApplyAffine(xyz, toHead)
      // 가닥 방식은 피부 밖 밀기 뒤 고리(점 4개)째 옮긴다(S15P31B204-919)
      const index = geometry.getIndex()
      const before = byRoot && index ? xyz.slice() : null
      pushOutOfSkin(xyz, surface, SKIN_CLEAR * fit.scale, SKIN_REACH * fit.scale)
      if (before && index) {
        const labels = strandLabels(index.array, xyz.length / 3)
        pushRings(before, xyz, labels, strandStarts(labels))
      }
      legacyApplyAffine(xyz, toMesh.multiply(fromHead))
    } else legacyApplyAffine(xyz, toMesh)
    geometry.setAttribute('position', new BufferAttribute(xyz, 3))
    geometry.computeBoundingSphere()
    mesh.geometry = geometry
    geometries.push(geometry)
  }
  return { scene: copy, geometries }
}

function legacyHairPositions(
  position: BufferAttribute | InterleavedBufferAttribute,
  matrix: Matrix4,
) {
  const count = position.count
  const xyz = new Float32Array(count * 3)
  const source = (position as BufferAttribute).array
  const unit = position.normalized ? 1 / 32767 : 1
  const low = source instanceof Int16Array ? -1 : -Infinity
  const e = matrix.elements
  for (let i = 0; i < count * 3; i += 3) {
    const x = Math.max(source[i] * unit, low)
    const y = Math.max(source[i + 1] * unit, low)
    const z = Math.max(source[i + 2] * unit, low)
    xyz[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    xyz[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    xyz[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
  return xyz
}

function legacyApplyAffine(xyz: Float32Array, matrix: Matrix4) {
  const e = matrix.elements
  for (let i = 0; i < xyz.length; i += 3) {
    const x = xyz[i]
    const y = xyz[i + 1]
    const z = xyz[i + 2]
    xyz[i] = e[0] * x + e[4] * y + e[8] * z + e[12]
    xyz[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
    xyz[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
  }
}

function legacyHeadMatrix(fit: HairFit): Matrix4 {
  const c = Math.cos(fit.rotationX)
  const s = Math.sin(fit.rotationX)
  const k = fit.scale
  const [px, py, pz] = fit.position
  return new Matrix4().set(k, 0, 0, px, 0, k * c, -k * s, py, 0, k * s, k * c, pz, 0, 0, 0, 1)
}

function legacySkinSurface(skin: Mesh): SkinSurface {
  const geometry = skin.geometry as BufferGeometry
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const world = skin.matrixWorld
  const toWorldNormal = new Matrix3().getNormalMatrix(world)
  const points = new Float32Array(position.count * 3)
  const normals = new Float32Array(position.count * 3)
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
      .applyMatrix4(world)
      .toArray(points, i * 3)
    v.fromBufferAttribute(normal, i)
      .applyMatrix3(toWorldNormal)
      .normalize()
      .toArray(normals, i * 3)
  }
  return { points, normals }
}

function legacyTemplatePoints(skin: Mesh) {
  const geometry = skin.geometry as BufferGeometry
  const ids = geometry.getAttribute('_TEMPLATE_INDEX')
  const position = geometry.getAttribute('position')
  const index = new Map<number, number>()
  for (let i = 0; i < ids.count; i++) {
    const id = ids.getX(i)
    if (!index.has(id)) index.set(id, i)
  }
  const world: Matrix4 = skin.matrixWorld
  return (vertex: number): [number, number, number] | null => {
    const i = index.get(vertex)
    if (i === undefined) return null
    return new Vector3().fromBufferAttribute(position, i).applyMatrix4(world).toArray()
  }
}

// ---- 가짜 Worker(structuredClone + transfer, 비동기) ----

const sent: HairFitRequest[] = []

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  private handle = createHairFitHandler()
  postMessage(message: HairFitRequest, transfer: Transferable[] = []) {
    const cloned = structuredClone(message, { transfer: transfer as Transferable[] })
    sent.push(cloned)
    setTimeout(() => {
      const out = this.handle(cloned)
      if (!out) return
      this.onmessage?.({ data: structuredClone(out.response, { transfer: out.transfer }) })
    })
  }
  terminate() {}
}

beforeEach(() => {
  sent.length = 0
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  releaseHairFits()
  vi.unstubAllGlobals()
})

function positionsOf(scene: Object3D) {
  const out: { xyz: Float32Array; center: number[]; radius: number }[] = []
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const geometry = object.geometry as BufferGeometry
    out.push({
      xyz: geometry.getAttribute('position').array as Float32Array,
      center: geometry.boundingSphere!.center.toArray(),
      radius: geometry.boundingSphere!.radius,
    })
  })
  return out
}

describe('Worker 헤어 맞춤', () => {
  const layered = hairUrlOf('layered')!
  const dandy = hairUrlOf('dandy')!

  it.each([
    ['가닥 방식(레이어드컷)', layered],
    ['점 방식(댄디컷)', dandy],
  ])('%s: 화면 스레드에서 하던 맞춤과 같은 점·경계 구를 낸다', async (_, url) => {
    const head = makeHead('base-female', 0.01, 1.03)
    const hair = makeHair()
    const hairline = makeHairline(url)
    const expected = positionsOf(legacyFit(head, url, hair, hairline).scene)
    const entry = await fitHairFor({ head, hairline, url, scene: hair, templateSkin, urgent: true })
    const actual = positionsOf(entry.scene)
    expect(actual).toHaveLength(1)
    // 맞춤으로 실제로 옮겨졌는지(원본 그대로가 아닌지)도 본다
    const original = legacyHairPositions(
      (hair.children[0] as Mesh).geometry.getAttribute('position') as BufferAttribute,
      new Matrix4(),
    )
    // 가짜 Worker의 structuredClone은 다른 realm의 Float32Array를 돌려줘 값만 비교한다
    expect(Array.from(actual[0].xyz)).not.toEqual(Array.from(original))
    expect(Array.from(actual[0].xyz)).toEqual(Array.from(expected[0].xyz))
    expect(actual[0].center).toEqual(expected[0].center)
    expect(actual[0].radius).toBe(expected[0].radius)
    // 원본 헤어 지오메트리는 그대로 둔다(옮겨 보낸 것은 사본)
    expect((hair.children[0] as Mesh).geometry.getAttribute('position').array).toBeInstanceOf(
      Int16Array,
    )
  })

  it('같은 머리의 두 번째 헤어는 머리 정보를 다시 보내지 않고, 가닥 번호는 헤어마다 한 번만 보낸다', async () => {
    const headA = makeHead('base-female')
    const headB = makeHead('base-male')
    const hair = makeHair()
    await fitHairFor({ head: headA, hairline: null, url: layered, scene: hair, templateSkin })
    await fitHairFor({ head: headA, hairline: null, url: dandy, scene: hair, templateSkin })
    await fitHairFor({ head: headB, hairline: null, url: layered, scene: hair, templateSkin })
    expect(sent.filter((m) => m.type === 'head')).toHaveLength(2)
    const fits = sent.filter((m) => m.type === 'fit')
    expect(fits).toHaveLength(3)
    expect(fits.map((m) => m.parts[0].index !== undefined)).toEqual([true, false, false])
    // 남긴 사본은 다시 맞추지 않고 바로 돌려준다
    const again = await fitHairFor({
      head: headA,
      hairline: null,
      url: dandy,
      scene: hair,
      templateSkin,
    })
    expect(sent.filter((m) => m.type === 'fit')).toHaveLength(3)
    expect(again).toBe(takeFit(headA, hairFitKey(dandy, templateSkin)))
  })

  it('사본은 지금 머리와 바로 전 머리까지만 남긴다', async () => {
    const heads = [makeHead('base-female'), makeHead('base-male'), makeHead('base-female', 0.02)]
    const hair = makeHair()
    for (const head of heads)
      await fitHairFor({ head, hairline: null, url: dandy, scene: hair, templateSkin })
    const key = hairFitKey(dandy, templateSkin)
    expect(takeFit(heads[0], key)).toBeUndefined()
    expect(takeFit(heads[1], key)).toBeDefined()
    expect(takeFit(heads[2], key)).toBeDefined()
  })

  it('사용자가 고른 헤어는 기다리는 미리 맞추기보다 먼저 한다', async () => {
    const head = makeHead('base-female')
    const hair = makeHair()
    const owner = {}
    const order: string[] = []
    const leaf = hairUrlOf('male-leaf')!
    const p1 = fitHairFor({ head, hairline: null, url: leaf, scene: hair, templateSkin, owner })
    const p2 = fitHairFor({ head, hairline: null, url: layered, scene: hair, templateSkin, owner })
    const p3 = fitHairFor({
      head,
      hairline: null,
      url: dandy,
      scene: hair,
      templateSkin,
      urgent: true,
    })
    await Promise.all([
      p1.then(() => order.push('leaf')),
      p2.then(() => order.push('layered')),
      p3.then(() => order.push('dandy')),
    ])
    // 리프컷은 이미 시작했고, 그다음 댄디컷이 레이어드컷을 앞선다
    expect(order).toEqual(['leaf', 'dandy', 'layered'])
  })
})

describe('헤어 미리 받기 조건', () => {
  it('가벼운 헤어부터, 무거운 헤어는 허락될 때만', () => {
    expect(hairPrefetchList(true).map((a) => a.id)).toEqual([
      'male-leaf',
      'dandy',
      'layered',
      'wolf',
    ])
    expect(hairPrefetchList(false).map((a) => a.id)).toEqual(['male-leaf', 'dandy'])
  })

  it('데이터 절약·2g/3g·작은 터치 화면이면 레이어드컷을 미리 받지 않는다', () => {
    const never = () => false
    expect(heavyHairPrefetchAllowed({ connection: {} }, never)).toBe(true)
    expect(heavyHairPrefetchAllowed(undefined, never)).toBe(true)
    expect(heavyHairPrefetchAllowed({ connection: { saveData: true } }, never)).toBe(false)
    expect(heavyHairPrefetchAllowed({ connection: { effectiveType: '3g' } }, never)).toBe(false)
    expect(heavyHairPrefetchAllowed({ connection: { effectiveType: 'slow-2g' } }, never)).toBe(
      false,
    )
    expect(heavyHairPrefetchAllowed({ connection: { effectiveType: '4g' } }, never)).toBe(true)
    expect(heavyHairPrefetchAllowed({ connection: {} }, () => true)).toBe(false)
    expect(heavyHairPrefetchAllowed({ connection: {} }, (q) => q === '(pointer: coarse)')).toBe(
      true,
    )
  })
})
