import { describe, expect, it } from 'vitest'
import {
  clampDrag,
  handoffCropWidth,
  nearestSlot,
  ringLoops,
  settleSlot,
  slotOffset,
} from './ringMath'

describe('머리 고리 칸 계산 (-527)', () => {
  it('둘 이하는 줄로 놓고, 셋 이상만 고리로 돈다', () => {
    expect([1, 2, 3, 5].map(ringLoops)).toEqual([false, false, true, true])
  })

  it('머리 둘: 옆 머리는 끝을 건너뛰지 않고 이어서 움직인다', () => {
    // 가운데가 0번이면 1번은 오른쪽(+1), 가운데가 1번이면 0번은 왼쪽(-1)
    expect(slotOffset(1, 0, 2)).toBe(1)
    expect(slotOffset(0, 1, 2)).toBe(-1)
    // 0번에서 살짝 오른쪽으로 돌려도 1번이 왼쪽 끝으로 건너뛰지 않는다(예전 고리는 -1 → +0.99로 튀었다)
    expect(slotOffset(1, -0.01, 2)).toBeCloseTo(1.01)
    expect(slotOffset(1, 0.01, 2)).toBeCloseTo(0.99)
  })

  it('머리 둘: 끝을 조금만 넘겨 끌 수 있고, 멈출 때는 두 칸 안으로 돌아온다', () => {
    expect(clampDrag(-3, 2)).toBe(-0.35)
    expect(clampDrag(4, 2)).toBe(1.35)
    expect(settleSlot(-0.9, 2)).toBe(0)
    expect(settleSlot(2.6, 2)).toBe(1)
    expect(nearestSlot(7.2, 1, 2)).toBe(1)
  })

  it('머리 셋 이상: 예전처럼 고리를 짧은 쪽으로 돈다', () => {
    expect(slotOffset(0, 3, 4)).toBe(-3 + 4)
    expect(slotOffset(3, 0, 4)).toBe(-1)
    expect(clampDrag(9.5, 4)).toBe(9.5)
    expect(settleSlot(-2.4, 4)).toBe(-2)
    expect(nearestSlot(5.2, 0, 4)).toBe(4)
  })

  it('머리 하나는 늘 가운데다', () => {
    expect(slotOffset(0, 0.7, 1)).toBe(0)
    expect(settleSlot(3, 1)).toBe(0)
  })
})

describe('이어주기 그림 자르기 폭 (-158)', () => {
  it('휴대폰에서는 가운데 머리 폭만 자른다(옆 머리 가운데는 폭의 약 37%만큼 떨어져 있다)', () => {
    const width = handoffCropWidth(390, 420)
    expect(width / 390).toBeGreaterThan(0.4)
    expect(width / 390).toBeLessThan(0.5)
    // 전에는 높이의 0.86배(361px, 폭의 93%)였다
    expect(width).toBeLessThan(420 * 0.86)
  })

  it('PC에서도 높이의 0.86배를 넘지 않고, 머리 폭(정규화 2.2)보다 좁게 자르지 않는다', () => {
    const width = handoffCropWidth(1200, 560)
    expect(width).toBeLessThanOrEqual(560 * 0.86)
    const pxPerWorld = 1200 / (2 * Math.tan((15 * Math.PI) / 180) * 7.4 * (1200 / 560))
    expect(width).toBeGreaterThanOrEqual(2.2 * pxPerWorld)
  })

  it('캔버스 폭을 넘지 않는다', () => {
    expect(handoffCropWidth(100, 1000)).toBeLessThanOrEqual(100)
  })
})
