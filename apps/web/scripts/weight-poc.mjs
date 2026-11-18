import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSyntheticHead } from '../src/features/viewer/syntheticHead.ts'

const root = createSyntheticHead()
const head = root.getObjectByName('synthetic_head').geometry
const neck = root.getObjectByName('synthetic_neck').geometry
const headBase = Float32Array.from(head.attributes.position.array)
const neckBase = Float32Array.from(neck.attributes.position.array)
const bell = (n, width) => Math.exp(-((n / width) ** 2))

function deform(weight) {
  const h = Float32Array.from(headBase)
  const n = Float32Array.from(neckBase)
  for (let i = 0; i < h.length; i += 3) {
    const [x, y, z] = headBase.slice(i, i + 3)
    const side = Math.min(1, Math.max(0, (Math.abs(x) - 0.15) / 0.2))
    const cheek = bell(y + 0.27, 0.31) * side * Math.min(1, Math.max(0, (z + 0.15) / 0.5))
    const jaw = bell(y + 0.7, 0.23) * side
    h[i] += weight * Math.sign(x) * (0.045 * cheek + 0.055 * jaw)
    h[i + 2] += weight * 0.035 * cheek
  }
  for (let i = 0; i < n.length; i += 3) {
    n[i] *= 1 + weight * 0.06
    n[i + 2] *= 1 + weight * 0.06
  }
  return { head: h, neck: n }
}

const original = deform(0)
assert.ok(original.head.every((value, i) => value === headBase[i]))
assert.ok(original.neck.every((value, i) => value === neckBase[i]))

// shortcut: 뒤집힌 삼각형만 검사한다. 실제 모델 적용 전에는 자기교차·목 경계도 검사해야 한다.
function invertedTriangles(points) {
  let count = 0
  const index = head.index.array
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3
    const b = index[i + 1] * 3
    const c = index[i + 2] * 3
    const cross = (p) => {
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    }
    const before = cross(headBase)
    const after = cross(points)
    if (before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < -1e-10) count++
  }
  return count
}

function outline(mesh, axis) {
  const rows = []
  const neckScale =
    Math.max(
      ...Array.from(mesh.neck)
        .filter((_, i) => i % 3 === 0)
        .map(Math.abs),
    ) / 0.5
  for (let y = -1.69; y <= 0.99; y += 0.025) {
    const values = []
    for (let i = 0; i < mesh.head.length; i += 3) {
      if (Math.abs(mesh.head[i + 1] - y) < 0.013) values.push(mesh.head[i + axis])
    }
    if (y <= -0.6) {
      const t = (y + 1.7) / 1.1
      const radius = (0.5 + (0.42 - 0.5) * t) * neckScale
      const depth = radius - 0.08
      values.push(axis === 0 ? -radius : -depth - 0.16, axis === 0 ? radius : depth)
    }
    if (values.length) rows.push({ y, low: Math.min(...values), high: Math.max(...values) })
  }
  return rows
}

function svg(axis) {
  const colors = ['#89929e', '#397caa', '#a65c79']
  const curves = [-1, 0, 1].map((weight, idx) => {
    const rows = outline(deform(weight), axis)
    const coord = (x, y) => `${(230 + x * 170).toFixed(1)},${(210 - y * 170).toFixed(1)}`
    const path = [
      ...rows.map((r) => coord(r.low, r.y)),
      ...rows.reverse().map((r) => coord(r.high, r.y)),
    ]
    return `<path d="M${path.join(' L')} Z" fill="none" stroke="${colors[idx]}" stroke-width="2"/>`
  })
  const title = axis === 0 ? '정면 윤곽' : '측면 윤곽'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="520" viewBox="0 0 460 520"><rect width="460" height="520" fill="#fff"/><text x="24" y="32" font-family="sans-serif" font-size="18">${title} — 합성 모델</text>${curves.join('')}<text x="24" y="480" font-family="sans-serif" font-size="13" fill="#89929e">축소 -1</text><text x="145" y="480" font-family="sans-serif" font-size="13" fill="#397caa">원본 0</text><text x="255" y="480" font-family="sans-serif" font-size="13" fill="#a65c79">확대 +1</text></svg>`
}

for (const weight of [0, -1, 1]) {
  const result = deform(weight)
  const maxHeadShift = Math.max(
    ...Array.from({ length: headBase.length / 3 }, (_, i) => {
      const j = i * 3
      return Math.hypot(
        result.head[j] - headBase[j],
        result.head[j + 1] - headBase[j + 1],
        result.head[j + 2] - headBase[j + 2],
      )
    }),
  )
  const inverted = invertedTriangles(result.head)
  assert.equal(inverted, 0, `weight ${weight}: triangle inversion`)
  const widthAt = (points, y) => {
    const xs = []
    for (let i = 0; i < points.length; i += 3) {
      if (Math.abs(points[i + 1] - y) < 0.02) xs.push(points[i])
    }
    return Math.max(...xs) - Math.min(...xs)
  }
  console.log(
    JSON.stringify({
      weight,
      cheekWidth: widthAt(result.head, -0.27),
      jawWidth: widthAt(result.head, -0.7),
      neckWidth: widthAt(result.neck, 0.55),
      maxHeadShift,
      invertedTriangles: inverted,
    }),
  )
}

const output = fileURLToPath(new URL('../../../docs/ai/', import.meta.url))
writeFileSync(`${output}weight-poc-front.svg`, svg(0))
writeFileSync(`${output}weight-poc-side.svg`, svg(2))
