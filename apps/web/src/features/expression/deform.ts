/**
 * 표정 한 프레임을 부품 정점에 얹는 계산(ExpressionLayer가 부품마다 차례로 부른다). 모두 `out`(정점 위치)을 고친다.
 *
 * 변위의 합에는 "부드러운 살이 단단한 것 위에 얹혀 있다"는 사실이 없다. 그래서 두 가지 접촉을 지킨다:
 * 눈꺼풀은 눈알 표면을 타고 넘고(`lidsOverEyeballs`), 입술은 치아 안으로 들어가지 않는다(`lipsOnTeeth`).
 */
import { Matrix4, Vector3 } from 'three'
import type { ExpressionRig } from './rig'
import type { Part, Scene } from './scene'

/** 템플릿 변위를 부품 정점에 더한다(`moved`가 없으면 표정 없는 위치) */
export function addDisplacement(part: Part, out: Float32Array, moved: Float32Array | null) {
  const { template, base } = part
  if (!moved) {
    out.set(base)
    return
  }
  for (let i = 0; i < template.length; i++) {
    const v = 3 * template[i]
    out[3 * i] = base[3 * i] + moved[v]
    out[3 * i + 1] = base[3 * i + 1] + moved[v + 1]
    out[3 * i + 2] = base[3 * i + 2] + moved[v + 2]
  }
}

/** 눈꺼풀: 움직인 정점이 눈알 껍질(각막 쪽은 조금 더 두껍게) 안으로 들어오면 껍질까지 민다 */
export function lidsOverEyeballs(
  scene: Scene,
  fwd: number[],
  out: Float32Array,
  base: Float32Array,
) {
  for (const { center, radius, lids, rest } of scene.eyeballs)
    for (let j = 0; j < lids.length; j++) {
      const i = lids[j]
      if (
        Math.abs(out[3 * i] - base[3 * i]) +
          Math.abs(out[3 * i + 1] - base[3 * i + 1]) +
          Math.abs(out[3 * i + 2] - base[3 * i + 2]) <
        0.02 * radius
      )
        continue
      const x = out[3 * i] - center[0]
      const y = out[3 * i + 1] - center[1]
      const z = out[3 * i + 2] - center[2]
      const d = Math.hypot(x, y, z)
      const facing = (x * fwd[0] + y * fwd[1] + z * fwd[2]) / (d + 1e-9)
      const shell = radius * (1.05 + 0.12 * Math.min(1, Math.max(0, (facing - 0.75) / 0.25)))
      // 무표정에서 이미 더 가까웠던 정점은 그 거리까지만 지킨다(가만히 있는 얼굴을 바꾸지 않는다)
      const limit = Math.min(shell, rest[j])
      if (d >= limit) continue
      const k = limit / (d + 1e-9)
      out[3 * i] = center[0] + x * k
      out[3 * i + 1] = center[1] + y * k
      out[3 * i + 2] = center[2] + z * k
    }
}

/** 입술: 치아(이 프레임의 자세)에 지켜야 할 거리보다 가까워진 정점을 치아 법선 방향으로 내보낸다 */
export function lipsOnTeeth(
  scene: Scene,
  contact: NonNullable<ExpressionRig['contact']>,
  out: Float32Array,
  moved: Float32Array,
) {
  const now = scene.hardNow
  scene.hard.forEach((entry, h) => {
    if (!entry) return
    const [part, i] = entry
    const v = 3 * part.template[i]
    now[3 * h] = part.base[3 * i] + moved[v]
    now[3 * h + 1] = part.base[3 * i + 1] + moved[v + 1]
    now[3 * h + 2] = part.base[3 * i + 2] + moved[v + 2]
  })
  const reach2 = contact.reach * contact.reach
  const count = contact.v.length
  const push = scene.push
  push.fill(0)
  let touched = false
  for (let k = 0; k < count; k++) {
    const ids = scene.lipVertices[k]
    if (!ids.length) continue
    const i0 = ids[0]
    const x = out[3 * i0]
    const y = out[3 * i0 + 1]
    const z = out[3 * i0 + 2]
    let best = Infinity
    let h = -1
    for (let c = 0; c < contact.ncand; c++) {
      const candidate = contact.cand[k * contact.ncand + c]
      if (candidate < 0 || !scene.hard[candidate]) continue
      const d =
        (x - now[3 * candidate]) ** 2 +
        (y - now[3 * candidate + 1]) ** 2 +
        (z - now[3 * candidate + 2]) ** 2
      if (d < best) {
        best = d
        h = candidate
      }
    }
    if (h < 0 || best > reach2) continue
    const nx = contact.normal[3 * h]
    const ny = contact.normal[3 * h + 1]
    const nz = contact.normal[3 * h + 2]
    const depth =
      contact.c[k] - ((x - now[3 * h]) * nx + (y - now[3 * h + 1]) * ny + (z - now[3 * h + 2]) * nz)
    if (depth <= 0) continue
    push.set([depth * nx, depth * ny, depth * nz], 3 * k)
    touched = true
  }
  if (!touched) return
  // 밀려난 정점이 이웃을 함께 데려간다(이웃 평균의 0.6배가 자기 값보다 크면 그 값, 3번):
  // 치아 모서리 위의 정점 하나만 튀어나와 입술에 각이 지지 않게
  const { neighborStart, neighbors } = contact
  const before = scene.pushBefore
  for (let round = 0; round < 3; round++) {
    before.set(push)
    for (let k = 0; k < count; k++) {
      const from = neighborStart[k]
      const to = neighborStart[k + 1]
      if (to === from) continue
      let x = 0
      let y = 0
      let z = 0
      for (let q = from; q < to; q++) {
        const j = neighbors[q]
        x += before[3 * j]
        y += before[3 * j + 1]
        z += before[3 * j + 2]
      }
      const f = 0.6 / (to - from)
      x *= f
      y *= f
      z *= f
      if (
        x * x + y * y + z * z >
        before[3 * k] ** 2 + before[3 * k + 1] ** 2 + before[3 * k + 2] ** 2
      )
        push.set([x, y, z], 3 * k)
    }
  }
  for (let k = 0; k < count; k++) {
    if (!push[3 * k] && !push[3 * k + 1] && !push[3 * k + 2]) continue
    for (const i of scene.lipVertices[k]) {
      out[3 * i] += push[3 * k]
      out[3 * i + 1] += push[3 * k + 1]
      out[3 * i + 2] += push[3 * k + 2]
    }
  }
}

/** 시선 [yaw, pitch] → 눈알 회전 행렬(열 우선 16개) */
export function gazeMatrices(
  rig: ExpressionRig,
  gaze: { L: [number, number]; R: [number, number] },
) {
  const up = new Vector3(...rig.axes.up)
  const right = new Vector3(...rig.axes.right)
  const turn = (angles: [number, number]) =>
    new Matrix4()
      .makeRotationAxis(up, angles[0])
      .multiply(new Matrix4().makeRotationAxis(right, -angles[1])).elements
  return [turn(gaze.L), turn(gaze.R)]
}

/** 눈알·홍채 정점을 그 눈의 중심에서 시선만큼 돌린다 */
export function turnEyes(part: Part, out: Float32Array, turns: number[][], centers: number[][]) {
  const sides = part.eyeSide
  if (!sides) return
  for (let i = 0; i < sides.length; i++) {
    const e = turns[sides[i]]
    const o = centers[sides[i]]
    const x = out[3 * i] - o[0]
    const y = out[3 * i + 1] - o[1]
    const z = out[3 * i + 2] - o[2]
    out[3 * i] = o[0] + e[0] * x + e[4] * y + e[8] * z
    out[3 * i + 1] = o[1] + e[1] * x + e[5] * y + e[9] * z
    out[3 * i + 2] = o[2] + e[2] * x + e[6] * y + e[10] * z
  }
}

/** 머리 관절 가중치만큼만 돈다: 상체는 그대로, 목에서 부드럽게 이어진다 */
export function turnHead(
  part: Part,
  out: Float32Array,
  head: number[],
  joint: NonNullable<ExpressionRig['head']>,
) {
  const { w, pivot } = joint
  const { template } = part
  for (let i = 0; i < template.length; i++) {
    const k = w[template[i]]
    if (k <= 0) continue
    const x = out[3 * i] - pivot[0]
    const y = out[3 * i + 1] - pivot[1]
    const z = out[3 * i + 2] - pivot[2]
    out[3 * i] += k * (pivot[0] + head[0] * x + head[4] * y + head[8] * z - out[3 * i])
    out[3 * i + 1] += k * (pivot[1] + head[1] * x + head[5] * y + head[9] * z - out[3 * i + 1])
    out[3 * i + 2] += k * (pivot[2] + head[2] * x + head[6] * y + head[10] * z - out[3 * i + 2])
  }
}

/** 위치를 고친 부품의 법선을 다시 구한다. UV 이음새의 갈라진 정점은 한 법선을 나눠 쓴다 */
export function refreshNormals(part: Part) {
  const geometry = part.mesh.geometry
  geometry.getAttribute('position').needsUpdate = true
  geometry.computeVertexNormals()
  if (part.seams.length) {
    const normal = geometry.getAttribute('normal')
    const n = normal.array as Float32Array
    for (const list of part.seams) {
      let x = 0
      let y = 0
      let z = 0
      for (const i of list) {
        x += n[3 * i]
        y += n[3 * i + 1]
        z += n[3 * i + 2]
      }
      const len = Math.hypot(x, y, z) || 1
      for (const i of list) n.set([x / len, y / len, z / len], 3 * i)
    }
    normal.needsUpdate = true
  }
  geometry.computeBoundingSphere()
}
