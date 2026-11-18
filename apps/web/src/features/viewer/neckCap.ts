/**
 * 목 아래 구멍 마개 (S15P31B204-713).
 *
 * 생성 모델(head.glb)의 피부(`skin`)는 목 아래가 뚫려 있어 아래에서 보면 눈알·잇몸·혀가 보인다.
 * 피부의 열린 테두리 중 가장 긴 고리(목)를 찾아 가운데 점 하나로 부채꼴 마개를 만든다.
 * 마개의 테두리 점은 피부 정점과 같은 morph target 값을 갖고, 가운데 점은 그 평균을 가져서
 * 체중·윤곽 슬라이더를 움직여도 피부와 함께 움직인다(틈이 생기지 않는다).
 * 기본 모델에 들어 있던 `neck-cap`(morph 없음)은 이 마개로 바꾼다.
 */
import { BufferAttribute, BufferGeometry, Mesh, Vector3, type Object3D } from 'three'

export const NECK_CAP_NAME = 'neck-cap'

/** 같은 위치의 정점(UV 이음매에서 나뉜 정점)을 하나로 본다. 1µm 격자 */
function weldKey(x: number, y: number, z: number) {
  return `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`
}

/**
 * 피부 정점 위치와 삼각형으로 가장 긴 열린 고리를 찾는다.
 * 반환값은 고리를 따라 순서대로 놓인 원래 정점 번호다. 열린 테두리가 없으면 null.
 */
export function findLongestBoundaryLoop(
  positions: ArrayLike<number>,
  index: ArrayLike<number>,
): number[] | null {
  const count = positions.length / 3
  const welded = new Int32Array(count)
  const representative: number[] = []
  const ids = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const key = weldKey(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    let id = ids.get(key)
    if (id === undefined) {
      id = representative.length
      ids.set(key, id)
      representative.push(i)
    }
    welded[i] = id
  }

  // 한 삼각형에만 속한 변이 테두리다. 방향은 삼각형 감김 순서를 그대로 둔다
  const edges = new Map<string, [number, number]>()
  const edgeCount = new Map<string, number>()
  for (let t = 0; t + 2 < index.length; t += 3) {
    const corners = [welded[index[t]], welded[index[t + 1]], welded[index[t + 2]]]
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[2] === corners[0])
      continue
    for (let k = 0; k < 3; k++) {
      const a = corners[k]
      const b = corners[(k + 1) % 3]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      edges.set(key, [a, b])
    }
  }
  const next = new Map<number, number>()
  for (const [key, n] of edgeCount) {
    if (n !== 1) continue
    const [a, b] = edges.get(key)!
    next.set(a, b)
  }

  let best: number[] | null = null
  let bestLength = 0
  const seen = new Set<number>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let current = start
    while (!seen.has(current)) {
      seen.add(current)
      loop.push(current)
      const following = next.get(current)
      if (following === undefined) break
      current = following
    }
    // 고리가 닫히지 않으면(비다양체 테두리) 마개를 만들지 않는다
    if (current !== start || loop.length < 3) continue
    let length = 0
    for (let k = 0; k < loop.length; k++) {
      const a = representative[loop[k]] * 3
      const b = representative[loop[(k + 1) % loop.length]] * 3
      length += Math.hypot(
        positions[a] - positions[b],
        positions[a + 1] - positions[b + 1],
        positions[a + 2] - positions[b + 2],
      )
    }
    if (length > bestLength) {
      bestLength = length
      best = loop
    }
  }
  return best ? best.map((id) => representative[id]) : null
}

/**
 * 피부 메시의 목 구멍을 막는 마개 지오메트리를 만든다. 정점은 [테두리..., 가운데] 순서다.
 * 법선이 머리 바깥(아래)을 보도록 감김 방향을 맞춘다.
 */
export function buildNeckCapGeometry(skin: BufferGeometry): BufferGeometry | null {
  const position = skin.getAttribute('position')
  if (!position) return null
  const positions = Float32Array.from({ length: position.count * 3 }, (_, i) =>
    position.getComponent(Math.floor(i / 3), i % 3),
  )
  const index = skin.index
    ? Array.from({ length: skin.index.count }, (_, i) => skin.index!.getX(i))
    : Array.from({ length: position.count }, (_, i) => i)
  const loop = findLongestBoundaryLoop(positions, index)
  if (!loop) return null

  const n = loop.length
  const center = new Vector3()
  for (const v of loop) center.add(new Vector3().fromBufferAttribute(position, v))
  center.divideScalar(n)

  // 감김 방향: 부채꼴 면적 벡터가 피부 중심에서 마개 중심 쪽을 보게 한다
  skin.computeBoundingBox()
  const outward = center.clone().sub(skin.boundingBox!.getCenter(new Vector3()))
  const area = new Vector3()
  const a = new Vector3()
  const b = new Vector3()
  for (let k = 0; k < n; k++) {
    a.fromBufferAttribute(position, loop[k]).sub(center)
    b.fromBufferAttribute(position, loop[(k + 1) % n]).sub(center)
    area.add(a.clone().cross(b))
  }
  const rim = area.dot(outward) < 0 ? [...loop].reverse() : loop

  const geometry = new BufferGeometry()
  const capPositions = new Float32Array((n + 1) * 3)
  rim.forEach((v, k) => {
    capPositions[k * 3] = position.getX(v)
    capPositions[k * 3 + 1] = position.getY(v)
    capPositions[k * 3 + 2] = position.getZ(v)
  })
  center.toArray(capPositions, n * 3)
  geometry.setAttribute('position', new BufferAttribute(capPositions, 3))

  // 텍스처는 목 앞쪽 테두리 한 점의 색을 그대로 쓴다(기본 모델 neck-cap과 같은 방식: 한 점 UV)
  const uv = skin.getAttribute('uv')
  if (uv) {
    let front = rim[0]
    for (const v of rim) if (position.getZ(v) > position.getZ(front)) front = v
    const u = uv.getX(front)
    const w = uv.getY(front)
    geometry.setAttribute(
      'uv',
      new BufferAttribute(
        Float32Array.from({ length: (n + 1) * 2 }, (_, i) => (i % 2 ? w : u)),
        2,
      ),
    )
  }

  const triangles = new Uint32Array(n * 3)
  for (let k = 0; k < n; k++) triangles.set([n, k, (k + 1) % n], k * 3)
  geometry.setIndex(new BufferAttribute(triangles, 1))

  // 피부 morph target을 그대로 옮긴다. 가운데 점은 테두리 값의 평균(상대·절대 target 모두 맞다)
  const targets = skin.morphAttributes.position
  if (targets?.length) {
    geometry.morphAttributes.position = targets.map((target) => {
      const values = new Float32Array((n + 1) * 3)
      rim.forEach((v, k) => {
        for (let c = 0; c < 3; c++) {
          const value = target.getComponent(v, c)
          values[k * 3 + c] = value
          values[n * 3 + c] += value / n
        }
      })
      const moved = new BufferAttribute(values, 3)
      moved.name = target.name
      return moved
    })
    geometry.morphTargetsRelative = skin.morphTargetsRelative
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * 장면 안의 `skin` 메시 옆에 목 마개를 붙인다. 이미 있던 `neck-cap`은 뺀다.
 * 복제한 장면(Before·After)마다 부른다. 붙인 마개를 돌려주고, 피부가 없거나 구멍이 없으면 null.
 */
export function attachNeckCap(root: Object3D): Mesh | null {
  let skin: Mesh | null = null
  const stale: Object3D[] = []
  root.traverse((object) => {
    if (object.name === NECK_CAP_NAME) stale.push(object)
    else if (!skin && object instanceof Mesh && object.name === 'skin') skin = object
  })
  const found = skin as Mesh | null
  if (!found?.parent) return null
  const geometry = buildNeckCapGeometry(found.geometry)
  if (!geometry) return null
  for (const object of stale) object.removeFromParent()

  const cap = new Mesh(geometry, found.material)
  cap.name = NECK_CAP_NAME
  cap.position.copy(found.position)
  cap.quaternion.copy(found.quaternion)
  cap.scale.copy(found.scale)
  cap.castShadow = found.castShadow
  cap.receiveShadow = found.receiveShadow
  if (geometry.morphAttributes.position && found.morphTargetDictionary) {
    cap.morphTargetDictionary = { ...found.morphTargetDictionary }
    cap.morphTargetInfluences = geometry.morphAttributes.position.map(
      (_, i) => found.morphTargetInfluences?.[i] ?? 0,
    )
  }
  found.parent.add(cap)
  return cap
}
