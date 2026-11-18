import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSyntheticHead } from '../src/features/viewer/syntheticHead.ts'

const mesh = createSyntheticHead().getObjectByName('synthetic_head').geometry
const base = mesh.attributes.position.array
const codes = ['nose.bridge_height', 'nose.tip_height', 'nose.alar_width']
const deltas = mesh.morphAttributes.position.map((attribute) => attribute.array)
const weights = [0.4, -0.3, -0.25]

function position(index, values) {
  const offset = index * 3
  return [0, 1, 2].map((axis) =>
    values.reduce(
      (value, weight, effect) => value + weight * deltas[effect][offset + axis],
      base[offset + axis],
    ),
  )
}

function anchor(x, y) {
  let best = -1
  let score = Infinity
  for (let i = 0; i < base.length / 3; i += 1) {
    const [px, py, pz] = position(i, [0, 0, 0])
    if (pz < 0.8) continue
    const next = Math.hypot(px - x, py - y) + 0.1 * Math.max(0, 1 - pz)
    if (next < score) {
      score = next
      best = i
    }
  }
  assert.ok(best >= 0)
  return best
}

const bridge = anchor(0, 0.05)
const tip = anchor(0, -0.18)
const leftAlar = anchor(-0.14, -0.21)
const rightAlar = anchor(0.14, -0.21)
const zero = [0, 0, 0]

// shortcut: 정점 대응을 알고 역산한다. 실제 사진에는 카메라 정렬·랜드마크 검출이 필요하다.
function features(values) {
  return [
    position(bridge, values)[2] - position(bridge, zero)[2],
    position(tip, values)[1] - position(tip, zero)[1],
    position(rightAlar, values)[0] -
      position(leftAlar, values)[0] -
      (position(rightAlar, zero)[0] - position(leftAlar, zero)[0]),
  ]
}

const gains = codes.map((_, i) => features(codes.map((__, j) => Number(i === j)))[i])
assert.ok(gains.every((gain) => Math.abs(gain) > 0.01))
const observed = features(weights)
const recovered = observed.map((value, i) => value / gains[i])
recovered.forEach((value, i) => assert.ok(Math.abs(value - weights[i]) < 1e-6))
const bridgeBefore = position(bridge, zero)
const bridgeAfter = position(bridge, [1, 0, 0])
const frontBridgeShift = Math.hypot(
  bridgeAfter[0] - bridgeBefore[0],
  bridgeAfter[1] - bridgeBefore[1],
)
assert.equal(frontBridgeShift, 0)

function svg(view) {
  const front = view === 'front'
  const xOf = (p) => (front ? p[0] : p[2] - 0.85)
  const map = (p) =>
    `${(front ? 230 + xOf(p) * 550 : 150 + xOf(p) * 550).toFixed(1)},${(270 - p[1] * 550).toFixed(1)}`
  const points = (values, color) => {
    const dots = []
    for (let i = 0; i < base.length / 3; i += 2) {
      const p = position(i, values)
      if (p[1] < -0.43 || p[1] > 0.32 || Math.abs(p[0]) > 0.24 || p[2] < 0.77) continue
      const [x, y] = map(p).split(',')
      dots.push(`<circle cx="${x}" cy="${y}" r="1.1" fill="${color}"/>`)
    }
    return dots.join('')
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="520" viewBox="0 0 460 520"><rect width="460" height="520" fill="white"/><text x="20" y="32" font-family="sans-serif" font-size="18">합성 코 ${front ? '정면' : '측면'} 투영</text>${points(zero, '#397caa')}${points(weights, '#bd596d')}<text x="20" y="480" font-family="sans-serif" font-size="13" fill="#397caa">기준</text><text x="100" y="480" font-family="sans-serif" font-size="13" fill="#bd596d">참고 목표</text></svg>`
}

const output = fileURLToPath(new URL('../../../docs/ai/', import.meta.url))
writeFileSync(`${output}nose-reference-front.svg`, svg('front'))
writeFileSync(`${output}nose-reference-side.svg`, svg('side'))
console.log(
  JSON.stringify({
    codes,
    target: weights,
    observed,
    recovered,
    frontBridgeShift,
    unavailable: ['nose.tip_projection', 'nose.tip_rotation'],
  }),
)
