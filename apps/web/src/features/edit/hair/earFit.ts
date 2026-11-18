/**
 * 가닥 헤어를 그 사람 귀에 맞춘다(S15P31B204-919).
 *
 * 헤어는 평균 머리 귀 둘레를 비워 두고 만들지만, 사람 귀는 통째 맞춤 뒤에도 평균 머리 귀와 어긋난다(민서는 8~13mm 앞).
 * 가닥 방식(`skinFollow: 'root'`)은 가닥 모양을 그대로 옮겨 귀를 따라가지 않으니, 그 사람 귀 면을 가닥이 그대로 지나갔다
 * (채원 오른쪽 귀에서 약 500가닥). 그래서 맞춘 뒤 그 사람 귀 삼각형을 지나는 가닥만 고른다.
 * 1. 얼굴 쪽(앞)으로 옮겨 귀를 비키게 한다. 귀를 지나는 곳에서 가까울수록 많이 옮기고(가우시안), 뿌리 근처는 옮기지
 *    않는다. 옮기는 양은 더는 귀를 지나지 않는 가장 작은 값이다(1mm씩, 35mm까지).
 * 2. 귀 바로 앞이 볼이라 앞으로 못 비키는 가닥은 `keep` 비율만 바깥(옆)으로 꺼내 귀 위에 남기고, 나머지는 귀를 처음
 *    지나는 고리부터 잘라 낸다(다 꺼내면 귀 위에 선이 수십 겹 얹혀 지저분했고, 다 자르면 어색했다).
 * 3. 옆에서 볼 때 귀 윤곽 안에 드는 머리(귀 위에 얹히거나 귀와 머리 사이를 지나는 머리)도 같은 비율만 남기고 자른다.
 *
 * 가닥 튜브는 가닥마다 가장 작은 정점 번호부터 4개씩이 한 고리다(뿌리 고리가 먼저, 가닥 튜브 GLB의 정점 순서).
 * 위치는 머리 좌표, `unit`은 머리 좌표의 1mm다.
 *
 * `pushRings`는 피부 밖 밀기(`pushOutWithGrid`) 뒤 고리마다 가장 크게 민 만큼 고리 전체를 옮긴다. 점마다 따로 밀면 고리의
 * 한 점만 9~16mm 밀려 나가 가닥이 넓적한 검은 삼각형으로 보였다(레이어드컷 뒤통수 약 400개, 울프컷 귀 옆).
 */

/** 가닥마다 첫(가장 작은) 정점 번호. `labels`는 `strandLabels` 결과 */
export function strandStarts(labels: Int32Array): Int32Array {
  const starts = new Int32Array(labels.length).fill(-1)
  for (let i = 0; i < labels.length; i++) if (starts[labels[i]] < 0) starts[labels[i]] = i
  return starts
}

/** 가닥 번호 배열마다 한 번 구한 고리 판정(같은 헤어는 Worker가 가닥 번호를 남겨 두니 맞출 때마다 다시 구하지 않는다) */
const ringCache = new WeakMap<Int32Array, Uint8Array>()

/** 가닥 점 수가 4의 배수이고 번호가 이어져 있으면 고리 단위로 다룰 수 있다 */
function ringStrands(labels: Int32Array, starts: Int32Array): Uint8Array {
  const known = ringCache.get(labels)
  if (known) return known
  const count = labels.length
  const size = new Int32Array(count)
  for (let i = 0; i < count; i++) size[labels[i]]++
  const ok = new Uint8Array(count)
  for (let s = 0; s < count; s++) {
    if (!size[s]) continue
    const first = starts[s]
    let contiguous = size[s] % 4 === 0
    for (let i = first; contiguous && i < first + size[s]; i++)
      if (labels[i] !== s) contiguous = false
    ok[s] = contiguous ? 1 : 0
  }
  ringCache.set(labels, ok)
  return ok
}

/**
 * 피부 밖 밀기 뒤 고리(점 4개)마다 그 고리에서 가장 크게 민 변위로 고리 전체를 옮긴다(제자리). `before`는 밀기 전 위치.
 * 고리로 나눌 수 없는 가닥은 그대로 둔다. 옮긴 고리 수를 돌려준다.
 */
export function pushRings(
  before: Float32Array,
  xyz: Float32Array,
  labels: Int32Array,
  starts: Int32Array,
): number {
  const ok = ringStrands(labels, starts)
  let rings = 0
  for (let i = 0; i + 3 < labels.length;) {
    const s = labels[i]
    if (!ok[s] || (i - starts[s]) % 4 !== 0) {
      i++
      continue
    }
    let best = i
    let bestSize = 0
    for (let j = i; j < i + 4; j++) {
      const d =
        (xyz[j * 3] - before[j * 3]) ** 2 +
        (xyz[j * 3 + 1] - before[j * 3 + 1]) ** 2 +
        (xyz[j * 3 + 2] - before[j * 3 + 2]) ** 2
      if (d > bestSize) {
        bestSize = d
        best = j
      }
    }
    if (bestSize > 0) {
      const dx = xyz[best * 3] - before[best * 3]
      const dy = xyz[best * 3 + 1] - before[best * 3 + 1]
      const dz = xyz[best * 3 + 2] - before[best * 3 + 2]
      for (let j = i; j < i + 4; j++) {
        xyz[j * 3] = before[j * 3] + dx
        xyz[j * 3 + 1] = before[j * 3 + 1] + dy
        xyz[j * 3 + 2] = before[j * 3 + 2] + dz
      }
      rings++
    }
    i += 4
  }
  return rings
}

/** 귀 위에 남길 가닥인지. 가닥 첫 번호로 정해 같은 헤어면 늘 같은 가닥이 남는다 */
export function keepStrand(start: number, keep: number): boolean {
  let h = Math.imul(start ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) % 1000 < keep * 1000
}

/**
 * 귀 삼각형(xyz 9개씩) 칸 격자. 귀 상자(+ 한 칸)만 덮는 칸에 삼각형 번호를 모아 둔다(칸마다 시작 위치 + 번호 배열).
 * 문자열 키 Map은 귀 근처 마디마다 키를 만들어 느렸다(채원 1.1초)
 */
interface EarGrid {
  tris: Float32Array
  cell: number
  lo: [number, number, number]
  dims: [number, number, number]
  start: Int32Array
  items: Int32Array
  /** 한 번 찾는 동안 이미 본 삼각형 표시(찾을 때마다 1씩 늘리는 번호) */
  seen: Int32Array
  stamp: number
}

function earGrid(tris: Float32Array, cell: number): EarGrid {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], tris[i + k])
      hi[k] = Math.max(hi[k], tris[i + k])
    }
  for (let k = 0; k < 3; k++) lo[k] -= cell
  const dims = [0, 1, 2].map((k) => Math.floor((hi[k] + cell - lo[k]) / cell) + 1) as [
    number,
    number,
    number,
  ]
  const range = (t: number, k: number) => [
    Math.floor((Math.min(tris[t + k], tris[t + 3 + k], tris[t + 6 + k]) - lo[k]) / cell),
    Math.floor((Math.max(tris[t + k], tris[t + 3 + k], tris[t + 6 + k]) - lo[k]) / cell),
  ]
  const visit = (t: number, f: (c: number) => void) => {
    const [x0, x1] = range(t, 0)
    const [y0, y1] = range(t, 1)
    const [z0, z1] = range(t, 2)
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) f((x * dims[1] + y) * dims[2] + z)
  }
  const size = new Int32Array(dims[0] * dims[1] * dims[2] + 1)
  for (let t = 0; t < tris.length; t += 9) visit(t, (c) => size[c + 1]++)
  for (let c = 1; c < size.length; c++) size[c] += size[c - 1]
  const start = size.slice()
  const items = new Int32Array(start[start.length - 1])
  const fill = size.slice()
  for (let t = 0; t < tris.length; t += 9) visit(t, (c) => (items[fill[c]++] = t))
  return { tris, cell, lo, dims, start, items, seen: new Int32Array(tris.length / 9), stamp: 0 }
}

/** 선분 a→b가 귀 삼각형을 지나면 지나는 곳의 비율(0~1), 아니면 -1 */
function crossing(
  grid: EarGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const { tris, cell, lo, dims, start, items, seen } = grid
  const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - lo[0]) / cell))
  const x1 = Math.min(dims[0] - 1, Math.floor((Math.max(ax, bx) - lo[0]) / cell))
  const y0 = Math.max(0, Math.floor((Math.min(ay, by) - lo[1]) / cell))
  const y1 = Math.min(dims[1] - 1, Math.floor((Math.max(ay, by) - lo[1]) / cell))
  const z0 = Math.max(0, Math.floor((Math.min(az, bz) - lo[2]) / cell))
  const z1 = Math.min(dims[2] - 1, Math.floor((Math.max(az, bz) - lo[2]) / cell))
  if (x0 > x1 || y0 > y1 || z0 > z1) return -1
  const stamp = ++grid.stamp
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const c = (x * dims[1] + y) * dims[2] + z
        for (let j = start[c]; j < start[c + 1]; j++) {
          const t = items[j]
          if (seen[t / 9] === stamp) continue
          seen[t / 9] = stamp
          const e1x = tris[t + 3] - tris[t]
          const e1y = tris[t + 4] - tris[t + 1]
          const e1z = tris[t + 5] - tris[t + 2]
          const e2x = tris[t + 6] - tris[t]
          const e2y = tris[t + 7] - tris[t + 1]
          const e2z = tris[t + 8] - tris[t + 2]
          const px = dy * e2z - dz * e2y
          const py = dz * e2x - dx * e2z
          const pz = dx * e2y - dy * e2x
          const det = e1x * px + e1y * py + e1z * pz
          if (Math.abs(det) < 1e-18) continue
          const inv = 1 / det
          const sx = ax - tris[t]
          const sy = ay - tris[t + 1]
          const sz = az - tris[t + 2]
          const u = (sx * px + sy * py + sz * pz) * inv
          if (u < 0 || u > 1) continue
          const qx = sy * e1z - sz * e1y
          const qy = sz * e1x - sx * e1z
          const qz = sx * e1y - sy * e1x
          const v = (dx * qx + dy * qy + dz * qz) * inv
          if (v < 0 || u + v > 1) continue
          const w = (e2x * qx + e2y * qy + e2z * qz) * inv
          if (w >= 0 && w <= 1) return w
        }
      }
  return -1
}

/** 귀를 지나는 가닥을 옮긴 수와 자른 수(`fitOffEars`) */
export interface EarFitStats {
  /** 귀를 지나던 가닥 */
  crossing: number
  /** 앞으로 옮겨 비킨 가닥 */
  front: number
  /** 바깥으로 꺼내 남긴 가닥 */
  out: number
  /** 잘라 낸 가닥(귀를 지나던 것과 귀 윤곽 안에 들던 것) */
  cut: number
}

/** 옮겨 볼 가장 큰 거리(mm). 이만큼 옮겨도 귀를 지나면 못 비킨다고 본다 */
const MAX_MOVE_MM = 36

/**
 * 그 사람 귀에서 가닥을 비키게 한다(위치는 제자리에서 바꾼다). 잘라 낸 가닥이 있으면 그 고리부터 뒤를 뺀 새 삼각형
 * 번호를 돌려준다(원본 번호는 GPU 지오메트리가 같이 쓰니 건드리지 않는다).
 */
export function fitOffEars(
  xyz: Float32Array,
  index: ArrayLike<number>,
  labels: Int32Array,
  starts: Int32Array,
  earTris: Float32Array,
  options: {
    /** 머리 좌표의 1mm */
    unit: number
    /** 머리 좌표의 얼굴 쪽(앞) 방향 */
    forward: readonly [number, number, number]
    /** 귀 위에 남길 가닥 비율(0~1) */
    keep: number
    /** 귀 바깥면에서 이 거리(mm)까지를 귀 윤곽 구역으로 본다 */
    reach?: number
  },
): { index: Uint32Array | null; stats: EarFitStats } {
  const stats: EarFitStats = { crossing: 0, front: 0, out: 0, cut: 0 }
  const { unit, forward, keep, reach = 12 } = options
  if (!earTris.length) return { index: null, stats }
  const ok = ringStrands(labels, starts)
  const grid = earGrid(earTris, 4 * unit)
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let t = 0; t < earTris.length; t += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], earTris[t + k])
      hi[k] = Math.max(hi[k], earTris[t + k])
    }
  // 선분의 상자가 귀 상자(margin 여유)와 겹치는지: 곧은 구간은 마디를 줄여 두 끝이 모두 귀 밖이어도 귀를 지날 수 있다
  const near = (a: number, b: number, margin: number) => {
    for (let k = 0; k < 3; k++) {
      const p = xyz[a * 3 + k]
      const q = xyz[b * 3 + k]
      if ((p > q ? p : q) < lo[k] - margin || (p < q ? p : q) > hi[k] + margin) return false
    }
    return true
  }
  const crosses = (a: number, b: number) =>
    crossing(
      grid,
      xyz[a * 3],
      xyz[a * 3 + 1],
      xyz[a * 3 + 2],
      xyz[b * 3],
      xyz[b * 3 + 1],
      xyz[b * 3 + 2],
    )
  // 고리로 나눌 수 없는 가닥(평균 머리 귀 둘레를 자른 가닥 등)은 그 점부터 자른다
  const ringOf = (s: number, v: number) =>
    ok[s] ? starts[s] + Math.floor((v - starts[s]) / 4) * 4 : v

  // 점마다 귀 상자(1mm 여유) 밖 방향 비트(x<, x>, y<, y>, z<, z>). 세 점이 모두 같은 쪽 밖인 삼각형은 귀에 닿지 않으니
  // 변을 보지 않는다(삼각형 약 500만 개를 다 훑던 것이 채원 0.3초였다)
  const outcode = new Uint8Array(labels.length)
  for (let v = 0; v < labels.length; v++) {
    let c = 0
    for (let k = 0; k < 3; k++) {
      const p = xyz[v * 3 + k]
      if (p < lo[k] - unit) c |= 1 << (k * 2)
      else if (p > hi[k] + unit) c |= 2 << (k * 2)
    }
    outcode[v] = c
  }

  // 1) 귀를 지나는 가닥, 지나는 곳, 처음 지나는 고리
  const hits = new Map<number, number[]>()
  const firstRing = new Map<number, number>()
  for (let t = 0; t + 2 < index.length; t += 3) {
    if (outcode[index[t]] & outcode[index[t + 1]] & outcode[index[t + 2]]) continue
    for (let e = 0; e < 3; e++) {
      const p = index[t + e]
      const q = index[t + (e === 2 ? 0 : e + 1)]
      const a = p < q ? p : q
      const b = p < q ? q : p
      if (!near(a, b, unit)) continue
      const w = crosses(a, b)
      if (w < 0) continue
      const s = labels[a]
      let at = hits.get(s)
      if (!at) hits.set(s, (at = []))
      for (let k = 0; k < 3; k++) at.push(xyz[a * 3 + k] + (xyz[b * 3 + k] - xyz[a * 3 + k]) * w)
      firstRing.set(s, Math.min(firstRing.get(s) ?? Infinity, ringOf(s, b)))
    }
  }

  // 옮긴 뒤 다시 볼 변: 가장 크게 옮겨도 귀 상자에 닿을 수 있는 변만(옮기면 귀에서 멀던 마디도 귀에 닿을 수 있다)
  const reachMove = (MAX_MOVE_MM + 1) * unit
  const edges = new Map<number, number[]>()
  for (let t = 0; t + 2 < index.length; t += 3) {
    const s = labels[index[t]]
    if (!hits.has(s)) continue
    let list = edges.get(s)
    for (let e = 0; e < 3; e++) {
      const a = index[t + e]
      const b = index[t + (e === 2 ? 0 : e + 1)]
      if (!near(a, b, reachMove)) continue
      if (!list) edges.set(s, (list = []))
      list.push(a, b)
    }
  }

  // 2) 앞으로 옮기기, 못 비키면 남길 가닥만 바깥으로, 나머지는 자를 고리 표시
  const cutFrom = new Map<number, number>()
  const sigma = 25 * unit
  const k2 = 1 / (2 * sigma * sigma)
  for (const [s, at] of hits) {
    stats.crossing++
    const first = starts[s]
    let last = first
    while (last + 1 < labels.length && labels[last + 1] === s) last++
    const rx = xyz[first * 3]
    const ry = xyz[first * 3 + 1]
    const rz = xyz[first * 3 + 2]
    const weight = new Float32Array(last - first + 1)
    const base = xyz.slice(first * 3, (last + 1) * 3)
    for (let i = first; i <= last; i++) {
      const x = xyz[i * 3]
      const y = xyz[i * 3 + 1]
      const z = xyz[i * 3 + 2]
      let d2 = Infinity
      for (let h = 0; h < at.length; h += 3)
        d2 = Math.min(d2, (x - at[h]) ** 2 + (y - at[h + 1]) ** 2 + (z - at[h + 2]) ** 2)
      const fromRoot = Math.hypot(x - rx, y - ry, z - rz) / unit
      const ramp = Math.min(1, Math.max(0, (fromRoot - 5) / 15))
      weight[i - first] = Math.exp(-d2 * k2) * ramp * ramp * (3 - 2 * ramp)
    }
    const segments = edges.get(s) ?? []
    const place = (dir: readonly number[], mm: number) => {
      const amount = mm * unit
      for (let i = first; i <= last; i++) {
        const w = weight[i - first] * amount
        const j = (i - first) * 3
        xyz[i * 3] = base[j] + dir[0] * w
        xyz[i * 3 + 1] = base[j + 1] + dir[1] * w
        xyz[i * 3 + 2] = base[j + 2] + dir[2] * w
      }
      for (let e = 0; e < segments.length; e += 2)
        if (near(segments[e], segments[e + 1], unit) && crosses(segments[e], segments[e + 1]) >= 0)
          return false
      return true
    }
    // 가장 크게 옮겨도 귀를 지나면 바로 못 비킨다고 본다(채원은 귀를 지나는 가닥의 87%가 그랬다). 비키면 2mm부터
    // 1mm씩 늘려 가장 작은 거리를 쓴다
    const clears = (dir: readonly number[]) => {
      if (!place(dir, MAX_MOVE_MM)) return false
      for (let mm = 2; mm < MAX_MOVE_MM; mm++) if (place(dir, mm)) return true
      return place(dir, MAX_MOVE_MM)
    }
    if (clears(forward)) stats.front++
    else if (keepStrand(first, keep) && clears([Math.sign(at[0]) || 1, 0, 0])) stats.out++
    else {
      xyz.set(base, first * 3)
      cutFrom.set(s, firstRing.get(s) ?? first)
    }
  }

  // 3) 옆에서 볼 때 귀 윤곽 안에 드는 머리: 귀 삼각형을 옆면(y, z) 칸에 칠하고, 귀가 붙은 안쪽(-2mm)부터 바깥면 + reach까지
  const flat = 1.5 * unit
  const cellKey = (y: number, z: number) => Math.floor(y / flat) * 1048576 + Math.floor(z / flat)
  const sides: { sign: number; cells: Set<number>; inner: number; outer: number }[] = []
  for (const sign of [1, -1]) {
    const cells = new Set<number>()
    let inner = Infinity
    let outer = -Infinity
    for (let t = 0; t < earTris.length; t += 9) {
      if (Math.sign(earTris[t]) !== sign) continue
      for (let k = 0; k < 9; k += 3) {
        inner = Math.min(inner, Math.abs(earTris[t + k]))
        outer = Math.max(outer, Math.abs(earTris[t + k]))
      }
      for (let i = 0; i <= 6; i++)
        for (let j = 0; i + j <= 6; j++) {
          const a = i / 6
          const b = j / 6
          const c = 1 - a - b
          cells.add(
            cellKey(
              a * earTris[t + 1] + b * earTris[t + 4] + c * earTris[t + 7],
              a * earTris[t + 2] + b * earTris[t + 5] + c * earTris[t + 8],
            ),
          )
        }
    }
    if (cells.size)
      sides.push({ sign, cells, inner: inner - 2 * unit, outer: outer + reach * unit })
  }
  // 귀 윤곽(옆면) 상자 밖은 칸을 찾지 않는다
  const ylo = lo[1] - flat
  const yhi = hi[1] + flat
  const zlo = lo[2] - flat
  const zhi = hi[2] + flat
  const left = sides.find((q) => q.sign === 1)
  const right = sides.find((q) => q.sign === -1)
  for (let i = 0; i < labels.length; i++) {
    const x = xyz[i * 3]
    const side = x >= 0 ? left : right
    if (!side) continue
    const ax = x >= 0 ? x : -x
    if (ax < side.inner || ax > side.outer) continue
    const y = xyz[i * 3 + 1]
    const z = xyz[i * 3 + 2]
    if (y < ylo || y > yhi || z < zlo || z > zhi) continue
    if (!side.cells.has(cellKey(xyz[i * 3 + 1], xyz[i * 3 + 2]))) continue
    const s = labels[i]
    if (keepStrand(starts[s], keep) && !cutFrom.has(s)) continue
    const ring = ringOf(s, i)
    if (ring < (cutFrom.get(s) ?? Infinity)) cutFrom.set(s, ring)
  }
  if (!cutFrom.size) return { index: null, stats }

  // 4) 자른 고리부터 뒤를 뺀 삼각형 번호. 고리가 둘도 안 남으면 가닥째 뺀다
  for (const [s, from] of cutFrom) if (from - starts[s] < 8) cutFrom.set(s, starts[s])
  stats.cut = cutFrom.size
  const kept = new Uint32Array(index.length)
  let n = 0
  for (let t = 0; t + 2 < index.length; t += 3) {
    const from = cutFrom.get(labels[index[t]])
    if (from !== undefined && (index[t] >= from || index[t + 1] >= from || index[t + 2] >= from))
      continue
    kept[n++] = index[t]
    kept[n++] = index[t + 1]
    kept[n++] = index[t + 2]
  }
  return { index: kept.slice(0, n), stats }
}
