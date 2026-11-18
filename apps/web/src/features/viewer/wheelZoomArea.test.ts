import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateWheelToModel, insideRect, projectedBounds, type ScreenRect } from './wheelZoomArea'

const CANVAS = { left: 100, top: 50, width: 800, height: 600 }

function scene(width = 1, height = 2) {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(width, height, 0.01), new MeshBasicMaterial()))
  const camera = new PerspectiveCamera(30, CANVAS.width / CANVAS.height, 0.1, 100)
  camera.position.set(0, 0, 6)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return { root, camera }
}

describe('projectedBounds', () => {
  it('보이는 메시를 화면에 투영한 사각형을 캔버스 위치 기준 CSS px로 돌려준다', () => {
    const { root, camera } = scene()
    const rect = projectedBounds(root, camera, CANVAS)!
    // 가운데에 있는 물체라 사각형도 캔버스 가운데(500, 350)를 감싼다
    expect((rect.left + rect.right) / 2).toBeCloseTo(500, 0)
    expect((rect.top + rect.bottom) / 2).toBeCloseTo(350, 0)
    // 세로 2 · 가로 1이라 높이가 폭의 두 배다
    expect((rect.bottom - rect.top) / (rect.right - rect.left)).toBeCloseTo(2, 1)
    // 거리 6, 화각 30°: 화면 높이 600px에 3.215 단위가 보인다 → 높이 2는 약 373px
    expect(rect.bottom - rect.top).toBeCloseTo((2 / (2 * 6 * Math.tan(Math.PI / 12))) * 600, -1)
  })

  it('가까이 당기면 사각형이 커진다', () => {
    const { root, camera } = scene()
    const far = projectedBounds(root, camera, CANVAS)!
    camera.position.set(0, 0, 3)
    const near = projectedBounds(root, camera, CANVAS)!
    expect(near.bottom - near.top).toBeGreaterThan((far.bottom - far.top) * 1.8)
  })

  it('숨긴 메시와 카메라 뒤의 점은 넣지 않는다', () => {
    const { root, camera } = scene()
    const hidden = new Mesh(new BoxGeometry(10, 10, 0.01), new MeshBasicMaterial())
    hidden.visible = false
    root.add(hidden)
    const behind = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial())
    behind.position.set(0, 0, 20)
    root.add(behind)
    const rect = projectedBounds(root, camera, CANVAS)!
    expect(rect.bottom - rect.top).toBeLessThan(400)
  })

  it('정점이 많은 헤어 카드도 가닥 끝까지 넣는다(일정 간격으로 뽑으면 뿌리만 걸린다)', () => {
    const { camera } = scene()
    // 가닥 1만 개 × 정점 4개(뿌리 y=0.5 → 끝 y=-1). 4의 배수 간격으로 뽑으면 모두 뿌리다
    const strands = 10000
    const xyz = new Float32Array(strands * 4 * 3)
    for (let s = 0; s < strands; s++)
      for (let v = 0; v < 4; v++) {
        const i = (s * 4 + v) * 3
        xyz[i] = (s / strands - 0.5) * 0.5
        xyz[i + 1] = 0.5 - v * 0.5
      }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(xyz, 3))
    const hair = new Group()
    hair.add(new Mesh(geometry, new MeshBasicMaterial()))
    const rect = projectedBounds(hair, camera, CANVAS, 1000)!
    const full = projectedBounds(hair, camera, CANVAS, Infinity)!
    expect(rect.bottom).toBeCloseTo(full.bottom, 0)
    expect(rect.top).toBeCloseTo(full.top, 0)
  })

  it('그릴 메시가 없으면 null', () => {
    const { camera } = scene()
    expect(projectedBounds(new Group(), camera, CANVAS)).toBeNull()
  })
})

describe('insideRect', () => {
  const rect: ScreenRect = { left: 10, top: 20, right: 30, bottom: 40 }
  it('경계와 여유(padding)까지 안으로 본다', () => {
    expect(insideRect(rect, 20, 30)).toBe(true)
    expect(insideRect(rect, 9, 30)).toBe(false)
    expect(insideRect(rect, 9, 30, 2)).toBe(true)
    expect(insideRect(null, 20, 30)).toBe(false)
  })
})

describe('gateWheelToModel', () => {
  let release: (() => void) | undefined
  afterEach(() => {
    release?.()
    release = undefined
    document.body.innerHTML = ''
  })

  function setup() {
    const area = document.createElement('div')
    const canvas = document.createElement('canvas')
    area.append(canvas)
    const outside = document.createElement('aside')
    document.body.append(area, outside)
    const zoom = vi.fn()
    // OrbitControls처럼 캔버스 쪽에서 휠을 받는다
    canvas.addEventListener('wheel', zoom)
    const onPage = vi.fn()
    outside.addEventListener('wheel', onPage)
    release = gateWheelToModel(area, () => ({ left: 100, top: 100, right: 200, bottom: 300 }), 0)
    return { canvas, outside, zoom, onPage }
  }
  const wheel = (x: number, y: number) =>
    new WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaY: 100,
      bubbles: true,
      cancelable: true,
    })

  it('머리 사각형 안의 휠은 캔버스까지 보내 확대한다', () => {
    const { canvas, zoom } = setup()
    const event = wheel(150, 200)
    canvas.dispatchEvent(event)
    expect(zoom).toHaveBeenCalledTimes(1)
  })

  it('사각형 밖의 휠은 캔버스에 보내지 않고, 막지도 않아 페이지가 넘어간다', () => {
    const { canvas, zoom } = setup()
    const event = wheel(50, 200)
    canvas.dispatchEvent(event)
    expect(zoom).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('캔버스 밖(조절 패널 등)의 휠은 건드리지 않는다', () => {
    const { outside, onPage } = setup()
    outside.dispatchEvent(wheel(50, 200))
    expect(onPage).toHaveBeenCalledTimes(1)
  })

  it('떼면 다시 모든 휠이 캔버스로 간다', () => {
    const { canvas, zoom } = setup()
    release?.()
    release = undefined
    canvas.dispatchEvent(wheel(50, 200))
    expect(zoom).toHaveBeenCalledTimes(1)
  })
})
