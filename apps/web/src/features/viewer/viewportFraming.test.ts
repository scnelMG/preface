import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { applyComparisonFrame, applyViewportFrame } from './viewportFraming'

function camera(width: number, height: number, distance = 6.2) {
  const cam = new PerspectiveCamera(30, width / height, 0.1, 100)
  cam.position.set(0, 0, distance)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}
function screen(
  cam: PerspectiveCamera,
  point: Vector3,
  rect: { x: number; y: number; width: number; height: number },
) {
  const projected = point.clone().project(cam)
  return {
    x: rect.x + ((projected.x + 1) * rect.width) / 2,
    y: rect.y + ((1 - projected.y) * rect.height) / 2,
  }
}
const slot = { x: 40, y: 260, width: 800, height: 500 }
const expanded = { x: -600, y: -100, width: 2080, height: 920 }
const frame = { height: 500, offsetX: 0, offsetY: -150 }

describe('확장 캔버스의 투영', () => {
  it('비교 모델은 같은 배율로 각 절반의 중심에 놓인다', () => {
    const cam = camera(expanded.width, expanded.height)
    const comparison = { ...frame, width: slot.width }
    applyComparisonFrame(cam, expanded, comparison, 'before')
    const before = screen(cam, new Vector3(), expanded)
    applyComparisonFrame(cam, expanded, comparison, 'after')
    const after = screen(cam, new Vector3(), expanded)
    expect(before.x).toBeCloseTo(slot.x + slot.width / 4)
    expect(after.x).toBeCloseTo(slot.x + (slot.width * 3) / 4)
    expect(before.y).toBeCloseTo(after.y)
  })
  it('확대한 원본의 오른쪽은 내부 중앙선을 넘어도 확장 캔버스 안에 남는다', () => {
    const cam = camera(expanded.width, expanded.height, 3)
    applyComparisonFrame(cam, expanded, { ...frame, width: slot.width }, 'before')
    const edge = screen(cam, new Vector3(1, 0, 0), expanded)
    expect(edge.x).toBeGreaterThan(slot.x + slot.width / 2)
    expect(edge.x).toBeLessThan(expanded.x + expanded.width)
  })
  it('기본 모델의 중심과 크기는 원래 조작 영역과 동일하다', () => {
    const before = camera(slot.width, slot.height)
    const after = camera(expanded.width, expanded.height)
    applyViewportFrame(after, expanded, frame)
    for (const point of [new Vector3(), new Vector3(0.5, 0.6, 0)]) {
      const expected = screen(before, point, slot)
      const actual = screen(after, point, expanded)
      expect(actual.x).toBeCloseTo(expected.x, 5)
      expect(actual.y).toBeCloseTo(expected.y, 5)
    }
  })
  it('확대한 얼굴은 기존 위쪽 경계 밖에서도 캔버스 안에 남는다', () => {
    const cam = camera(expanded.width, expanded.height, 3)
    applyViewportFrame(cam, expanded, frame)
    const head = screen(cam, new Vector3(0, 1.2, 0), expanded)
    expect(head.y).toBeLessThan(slot.y)
    expect(head.y).toBeGreaterThan(expanded.y)
  })
  it('기본 비교처럼 보정을 생략하면 확장 투영을 해제한다', () => {
    const cam = camera(expanded.width, expanded.height)
    applyViewportFrame(cam, expanded, frame)
    applyViewportFrame(cam, slot)
    expect(cam.zoom).toBe(1)
    expect(cam.view?.enabled).toBe(false)
  })
})
