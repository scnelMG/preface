import { POC_MORPH_KEYS } from './morphTargets'
import type { auditNoseSkinGeometry } from '../../../../../services/gpu-worker/reconstruction/engine/nose-skin-audit.mjs'
import { Vector3, type Mesh } from 'three'
import {
  buildRig,
  evaluate,
  supportsNoseEngine,
  validate,
  zeroParams,
} from '../../../../../services/gpu-worker/reconstruction/engine/nose-engine.mjs'

interface EditableJson {
  editable_sha256: string
  landmarks?: Record<string, number[]>
  buffers: { layout: Record<string, { byteOffset: number; byteLength: number }> }
}

interface RigJson {
  format: string
  version: number
  fit_sha: string
  nose?: {
    engine: string
    json: EditableJson
    bin: string
    limits: Record<string, [number, number]>
    nmap: string
    nw: string
    M: number[][]
  }
}

function parseEditable(json: EditableJson, bytes: ArrayBuffer) {
  const layout = json.buffers.layout
  const view = (name: string, Ctor: typeof Float32Array | typeof Uint32Array) => {
    const part = layout[name]
    return new Ctor(bytes.slice(part.byteOffset, part.byteOffset + part.byteLength))
  }
  return {
    model: { ...json },
    positions: view('position', Float32Array),
    normals: view('normal', Float32Array),
    index: view('index', Uint32Array),
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('')
}

function binary(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function numbers(
  base64: string,
  integer: boolean,
): Int32Array<ArrayBuffer> | Float32Array<ArrayBuffer> {
  const bytes = binary(base64)
  if (bytes.byteLength % 4) throw Error('invalid rig map')
  return integer ? new Int32Array(bytes.buffer) : new Float32Array(bytes.buffer)
}

export async function loadNoseRig(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error('rig fetch failed')
  const rig = (await response.json()) as RigJson
  if (
    rig.format !== 'live-mirror-rig' ||
    rig.version !== 1 ||
    !rig.fit_sha ||
    !rig.nose ||
    !supportsNoseEngine(rig.nose.engine)
  )
    throw Error('unsupported rig')
  const bytes = binary(rig.nose.bin)
  if ((await sha256Hex(bytes)) !== rig.nose.json.editable_sha256)
    throw Error('rig checksum mismatch')
  const editable = parseEditable(rig.nose.json, bytes.buffer)
  const editor = {
    rig: buildRig(
      editable.model,
      editable.positions,
      editable.normals,
      editable.index,
      rig.nose.engine,
    ),
  }
  const map = numbers(rig.nose.nmap, true) as Int32Array
  const weights = numbers(rig.nose.nw, false) as Float32Array
  const matrix = rig.nose.M
  if (
    map.length !== weights.length ||
    Object.values(rig.nose.limits).some(
      (bounds) =>
        !Array.isArray(bounds) ||
        bounds.length !== 2 ||
        !bounds.every(Number.isFinite) ||
        bounds[0] > 0 ||
        bounds[1] < 0,
    ) ||
    !Array.isArray(matrix) ||
    matrix.length !== 3 ||
    matrix.some(
      (row) => !Array.isArray(row) || row.length !== 3 || row.some((v) => !Number.isFinite(v)),
    )
  ) {
    throw Error('invalid rig mapping')
  }
  return { fitSha: rig.fit_sha, editable, editor, map, weights, matrix, limits: rig.nose.limits }
}

export type NoseRig = Awaited<ReturnType<typeof loadNoseRig>>

/** GLB의 중간 노드 변환까지 포함해 피부 정점 위에 제어점을 놓는다. */
export function noseHandleWorldPosition(mesh: Mesh, positions: Float32Array, skinIndex: number) {
  return mesh.localToWorld(new Vector3().fromArray(positions, 3 * skinIndex))
}

/** 리그 랜드마크에 가장 가까운 코 피부 정점을 제어점으로 고른다. */
export function nosePointHandles(rig: NoseRig, template: ArrayLike<number>) {
  const names = [
    ['nasion', '콧대'],
    ['pronasale', '코끝'],
    ['alar_crease_subject_left', '왼쪽 콧볼'],
    ['alar_crease_subject_right', '오른쪽 콧볼'],
  ] as const
  return names.flatMap(([id, label]) => {
    const target = rig.editable.model.landmarks?.[id]
    if (!target || target.length !== 3) return []
    let best = -1
    let distance = Infinity
    for (let i = 0; i < template.length; i++) {
      const vertex = template[i]
      const mapped = rig.map[vertex]
      if (rig.weights[vertex] < 0.2 || mapped < 0) continue
      const d = [0, 1, 2].reduce(
        (sum, k) => sum + (rig.editable.positions[3 * mapped + k] - target[k]) ** 2,
        0,
      )
      if (d < distance) {
        distance = d
        best = i
      }
    }
    return best < 0 ? [] : [{ id, label, vertex: template[best], skinIndex: best }]
  })
}

/** 상담 효과를 리그에서 찾은 실제 코 랜드마크에 연결한다. */
export function highlightedNoseHandles<T extends { id: string }>(
  handles: readonly T[],
  codes: readonly string[],
): T[] {
  return handles.filter((handle) =>
    codes.some(
      (code) =>
        (code === 'nose.bridge_height' && handle.id === 'nasion') ||
        (code === 'nose.alar_width' && handle.id.startsWith('alar_crease_')) ||
        (code.startsWith('nose.tip_') && handle.id === 'pronasale'),
    ),
  )
}

const lastNoseGeometry = new WeakMap<
  NoseRig,
  { key: string; positions: Float32Array; valid: boolean }
>()

/**
 * 서비스 상대 weight를 리그 내부 수치로 바꿔 원본 정점 기준으로 계산한다.
 * `valid`는 canonical 메시 검사(서버 검사기 `checkNoseEdit`의 `canonical.valid`와 같은 `validate`)다.
 */
export function evaluateNoseCanonical(
  rig: NoseRig,
  publicWeights: Readonly<Record<string, number>>,
) {
  const params: Record<string, number> = { ...zeroParams(), edge_blend: 50 }
  const unsupported: string[] = []
  for (const [code, weight] of Object.entries(publicWeights)) {
    if (!code.startsWith('nose.') || weight === 0) continue
    const key = POC_MORPH_KEYS[code]
    const limits = rig.limits[key]
    if (!key || !limits || !Number.isFinite(weight) || Math.abs(weight) > 1) {
      unsupported.push(code)
      continue
    }
    params[key] = weight < 0 ? -weight * limits[0] : weight * limits[1]
  }
  const key = JSON.stringify(params)
  const cached = lastNoseGeometry.get(rig)
  if (cached?.key === key) return { positions: cached.positions, unsupported, valid: cached.valid }

  const positions = evaluate(
    rig.editable.model,
    rig.editor.rig,
    rig.editable.positions,
    rig.editable.normals,
    params,
  )
  const valid = validate(
    rig.editor.rig,
    rig.editable.positions,
    positions,
    rig.editable.index,
  ).valid
  lastNoseGeometry.set(rig, { key, positions, valid })
  return { positions, unsupported, valid }
}

/** canonical 검사를 통과한 코 위치. 통과하지 못하면 null */
export function nosePositions(rig: NoseRig, publicWeights: Readonly<Record<string, number>>) {
  const nose = evaluateNoseCanonical(rig, publicWeights)
  return nose.valid ? { positions: nose.positions, unsupported: nose.unsupported } : null
}

/**
 * 코 편집 상태 하나가 서버 검사기를 통과하는지. 서버 `checkNoseEdit`
 * (services/gpu-worker/reconstruction/engine/glb-nose.mjs)의 `valid`와 같은 조건이다.
 * canonical 메시 검사, 최종 피부 검사, 보호 부위(눈·입술) 정보가 있는지, 코 값이나 점 편집을 요청했으면 실제로 바뀐 정점이 있는지.
 * 화면 미리보기가 이보다 느슨하면 서버가 거절할 값을 화면이 통과시켜, 저장 뒤 다시 읽을 때 값이 0으로 돌아간다.
 * `audit`이 null이면(피부 검사를 못 함) 통과하지 않는다.
 */
export function noseEditPasses(
  canonicalValid: boolean,
  audit: Pick<
    ReturnType<typeof auditNoseSkinGeometry>,
    'valid' | 'protectedRegionsPresent' | 'affectedVertices'
  > | null,
  weights: Readonly<Record<string, number>>,
  pointStrokes: readonly unknown[] = [],
): boolean {
  if (!canonicalValid || !audit || !audit.valid || !audit.protectedRegionsPresent) return false
  const requested =
    pointStrokes.length > 0 ||
    Object.entries(weights).some(([code, value]) => code.startsWith('nose.') && value !== 0)
  return !requested || audit.affectedVertices > 0
}

export function applyNoseToSkin(
  rig: NoseRig,
  template: ArrayLike<number>,
  base: ArrayLike<number>,
  canonical: ArrayLike<number>,
  target: Float32Array,
) {
  if (template.length * 3 !== base.length || target.length !== base.length)
    throw Error('skin size mismatch')
  for (let i = 0; i < template.length; i++) {
    const t = template[i],
      m = rig.map[t],
      weight = rig.weights[t]
    if (
      t < 0 ||
      t >= rig.map.length ||
      m < 0 ||
      m * 3 + 2 >= canonical.length ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 1
    ) {
      throw Error('invalid rig vertex')
    }
    const dx = canonical[3 * m] - rig.editable.positions[3 * m]
    const dy = canonical[3 * m + 1] - rig.editable.positions[3 * m + 1]
    const dz = canonical[3 * m + 2] - rig.editable.positions[3 * m + 2]
    for (let k = 0; k < 3; k++) {
      const row = rig.matrix[k]
      target[3 * i + k] = base[3 * i + k] + weight * (row[0] * dx + row[1] * dy + row[2] * dz)
    }
  }
}
