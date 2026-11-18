import { describe, it, expect } from 'vitest'
import { modelPositionIndexes } from './workspace-data'
describe('많은 모델의 위치 표시', () => {
  it('전체가 적으면 모두 표시한다', () =>
    expect(modelPositionIndexes(5, 0)).toEqual([0, 1, 2, 3, 4]))
  it('중간 선택은 앞뒤를 포함한 일곱 개만 표시한다', () =>
    expect(modelPositionIndexes(20, 10)).toEqual([7, 8, 9, 10, 11, 12, 13]))
  it('처음과 끝에서도 선택한 항목과 실제 인덱스를 유지한다', () => {
    expect(modelPositionIndexes(20, 0)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(modelPositionIndexes(20, 19)).toEqual([13, 14, 15, 16, 17, 18, 19])
  })
})
