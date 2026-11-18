import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type Material,
  type Object3D,
} from 'three'
import {
  buildEyeBasis,
  fitEyeSpheres,
  lidSkin,
  refineEyeMesh,
  transferRefined,
  type EyeBasis,
  type LidSkin,
  type RefineSources,
} from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import type { EyeReview, EyeState } from '../edit/eyes/state'
import { deformEyeSkins, type EyeDeformResult } from './eyeDeform'

interface Skin {
  mesh: Mesh
  base: Float32Array
  normals: Float32Array
  flat: Float32Array
  indices: Uint32Array
  sources: RefineSources
  /** lid 쌍꺼풀 입력(눈꺼풀 앞면 피부 무게·단 방향, 세분화 정점) */
  lid: LidSkin
  sideBases: { L: Float32Array; R: Float32Array }
  /** 마지막 눈 변형 결과(세분화 정점). 코 변형 차이와 합쳐 그린다 */
  eye: Float32Array
  /** 원본 정점에서 옮겨 온 코 rig 변형 차이(세분화 정점) */
  offset: Float32Array
  mask: Uint8Array
  /** 눈 변형 가운데 쌍꺼풀 접힘만의 변위(없으면 null). 표정 레이어가 눈 뜬 정도에 맞춰 편다 */
  fold: Float32Array | null
}
export interface EyeRig {
  eyes: EyeBasis[]
  spheres: object[]
  skins: Skin[]
  /** 안전 한계 워커로 보낼 원본 기준점과 안구 점 */
  landmarks: number[][]
  balls: number[][]
}
export interface EyeGeometryStatus {
  ready: boolean
  changed: number
  message: string
}

export function prepareEyeRig(root: Object3D, landmarkIds?: number[]): EyeRig {
  if (!landmarkIds || landmarkIds.length < 468) throw Error('눈 기준점이 없는 모델이다.')
  const points = new Map<number, number[]>(),
    balls: number[][] = [],
    skins: Mesh[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const geometry = object.geometry
    const template =
      geometry.getAttribute('_template_index') ?? geometry.getAttribute('_TEMPLATE_INDEX')
    if (!template) return
    object.updateMatrix()
    if (!object.matrix.equals(new Matrix4()))
      throw Error('노드 변환이 있는 모델은 지원하지 않는다.')
    const positions = geometry.getAttribute('position')
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (let i = 0; i < positions.count; i++) {
      const point = [positions.getX(i), positions.getY(i), positions.getZ(i)]
      points.set(template.getX(i), point)
      if (materials.every((material) => ['eye', 'sclera'].includes(material.name)))
        balls.push(point)
    }
    if (materials.every((material) => ['skin', 'skin_photo'].includes(material.name)))
      skins.push(object)
  })
  const landmarks = landmarkIds.map((id) => points.get(id))
  const eyes = buildEyeBasis(landmarks)
  if (!skins.length || eyes.length !== 2) throw Error('눈 편집에 필요한 피부가 없다.')
  const refined = skins.map((mesh) => {
    const old = mesh.geometry
    const positions = Float32Array.from(old.getAttribute('position').array)
    const indices =
      old.index?.array ??
      Uint32Array.from({ length: old.getAttribute('position').count }, (_, i) => i)
    const template = (old.getAttribute('_template_index') ?? old.getAttribute('_TEMPLATE_INDEX'))
      .array
    const data = refineEyeMesh(
      {
        positions,
        normals: Float32Array.from(old.getAttribute('normal').array),
        uv: old.getAttribute('uv')?.array,
        indices,
      },
      eyes,
      2,
    )
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.positions.slice(), 3))
    geometry.setAttribute('normal', new BufferAttribute(data.normals.slice(), 3))
    if (data.uv.length) geometry.setAttribute('uv', new BufferAttribute(data.uv, 2))
    geometry.setIndex(new BufferAttribute(data.indices, 1))
    // 코 morph target도 같은 평균으로 옮긴다. 세분화한 피부에서도 코 조절이 그대로 동작한다.
    for (const name of ['position', 'normal', 'color'] as const)
      geometry.morphAttributes[name] = old.morphAttributes[name]?.map((attribute) => {
        const moved = new BufferAttribute(
          transferRefined(data.sources, attribute.array, attribute.itemSize),
          attribute.itemSize,
        )
        moved.name = attribute.name
        return moved
      })
    for (const name of ['position', 'normal', 'color'] as const)
      if (!geometry.morphAttributes[name]) delete geometry.morphAttributes[name]
    geometry.morphTargetsRelative = old.morphTargetsRelative
    geometry.computeVertexNormals()
    const flat = Float32Array.from(geometry.getAttribute('normal').array)
    geometry.getAttribute('normal').array.set(data.normals)
    mesh.geometry = geometry
    return {
      mesh,
      base: data.positions,
      normals: data.normals,
      flat,
      indices: data.indices,
      sources: data.sources,
      lid: lidSkin({ positions, indices, template }, data.sources),
      sideBases: { L: data.positions.slice(), R: data.positions.slice() },
      eye: data.positions.slice(),
      offset: new Float32Array(data.positions.length),
      mask: new Uint8Array(data.positions.length / 3),
      fold: null,
    }
  })
  return {
    eyes,
    spheres: fitEyeSpheres(balls, eyes),
    skins: refined,
    landmarks: landmarks as number[][],
    balls,
  }
}

/** 눈 변형 결과와 코 변형 차이를 합쳐 그리고 접힘 주변 법선을 다시 맞춘다. */
function writeSkin(skin: Skin) {
  const geometry = skin.mesh.geometry
  const position = geometry.getAttribute('position')
  const target = position.array as Float32Array
  let offset = false
  for (let i = 0; i < target.length; i++) {
    target[i] = skin.eye[i] + skin.offset[i]
    offset ||= skin.offset[i] !== 0
  }
  position.needsUpdate = true
  if (!offset && !skin.mask.some(Boolean)) geometry.getAttribute('normal').array.set(skin.normals)
  else {
    // 실제 형상의 법선에, 평면 세분화가 잃은 원본의 매끈함(원본 법선 - 세분화 면 법선)을 더한다. 면이 크게 돈 곳(쌍꺼풀 벽)은
    // 덜 더한다. 쌍꺼풀은 계산으로 만든 매끄러운 단이라 따로 평활하지 않는다(이전 tuck용 평활은 단을 뭉개거나 톱니로 보이게 했다).
    // 코만 바뀌었을 때도 같은 보정을 한다(빼면 눈 주변이 세분화 면처럼 각져 보였다).
    geometry.computeVertexNormals()
    const normal = geometry.getAttribute('normal')
    for (let i = 0; i < target.length; i += 3) {
      const rotation =
        normal.array[i] * skin.flat[i] +
        normal.array[i + 1] * skin.flat[i + 1] +
        normal.array[i + 2] * skin.flat[i + 2]
      const weight = Math.max(0, Math.min(1, (rotation - 0.1) / 0.8))
      const n = new Vector3(
        ...[0, 1, 2].map(
          (k) => normal.array[i + k] + weight * (skin.normals[i + k] - skin.flat[i + k]),
        ),
      ).normalize()
      normal.setXYZ(i / 3, n.x, n.y, n.z)
    }
  }
  geometry.getAttribute('normal').needsUpdate = true
  geometry.computeBoundingSphere()
}

/**
 * 코 rig가 원본 정점에 만든 변형 차이를 세분화 피부로 옮긴다. 눈 변형은 다시 계산하지 않고
 * 원본 기준 결과 위에 더한다(두 부위의 영향 영역은 거의 겹치지 않는다).
 */
export function setEyeBaseOffset(rig: EyeRig, mesh: Mesh, delta: ArrayLike<number> | null) {
  const skin = rig.skins.find((item) => item.mesh === mesh)
  if (!skin) return false
  skin.offset = delta ? transferRefined(skin.sources, delta, 3) : skin.offset.fill(0)
  writeSkin(skin)
  return true
}

/** 계산한 눈 변형을 메시에 그리고 화면 상태를 돌려준다. */
export function writeEyeResult(rig: EyeRig, result: EyeDeformResult): EyeGeometryStatus {
  rig.skins.forEach((skin, index) => {
    const item = result.skins[index]
    if (!item) return
    skin.eye = item.eye
    skin.mask = item.mask
    skin.fold = item.fold
    writeSkin(skin)
  })
  return {
    ready: true,
    changed: result.changed,
    message: result.reductions.length
      ? `조합에서 이동 일부 제한: ${[...new Set(result.reductions)].join(', ')}`
      : result.changed
        ? '현재 시안에 눈 변형 적용됨'
        : '원본 상태',
  }
}

/** 화면 스레드에서 바로 계산해 그린다(워커가 없는 환경). */
export function applyEyeState(rig: EyeRig, state: EyeState, review: EyeReview): EyeGeometryStatus {
  return writeEyeResult(rig, deformEyeSkins(rig.eyes, rig.spheres, rig.skins, state, review))
}

export function grayMaterials(root: Object3D) {
  const pairs: { mesh: Mesh; original: Material | Material[]; gray: Material | Material[] }[] = []
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const original = object.material
    const make = () => new MeshStandardMaterial({ color: '#b6b3b0', roughness: 0.8, metalness: 0 })
    pairs.push({
      mesh: object,
      original,
      gray: Array.isArray(original) ? original.map(make) : make(),
    })
  })
  return {
    apply(gray: boolean) {
      for (const pair of pairs) pair.mesh.material = gray ? pair.gray : pair.original
    },
    dispose() {
      for (const pair of pairs)
        for (const material of Array.isArray(pair.gray) ? pair.gray : [pair.gray])
          material.dispose()
    },
  }
}
