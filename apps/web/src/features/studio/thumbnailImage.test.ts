import { describe, expect, it } from 'vitest'
import { alphaBounds } from './thumbnailImage'

function rgba(width: number, height: number, opaque: [number, number][]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255
  return data
}

describe('alphaBounds (-436 썸네일 자르기)', () => {
  it('알파가 있는 픽셀을 모두 담는 가장 작은 범위를 준다(끝은 포함하지 않는 값)', () => {
    expect(
      alphaBounds(
        rgba(10, 8, [
          [2, 3],
          [6, 1],
          [4, 6],
        ]),
        10,
        8,
      ),
    ).toEqual({ x0: 2, y0: 1, x1: 7, y1: 7 })
  })

  it('거의 투명한 가장자리(알파 8 이하)는 무시하고, 아무것도 없으면 null이다', () => {
    const faint = new Uint8ClampedArray(4 * 4 * 4).fill(0)
    faint[3] = 8
    expect(alphaBounds(faint, 4, 4)).toBeNull()
  })
})
