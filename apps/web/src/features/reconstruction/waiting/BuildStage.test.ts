import { describe, expect, it } from 'vitest'
import { fakeJob } from '../testing'
import { stageProgress } from './BuildStage'

describe('생성 대기 무대 단계', () => {
  it('서버 단계를 점 → 회색 형상 → 피부 순서의 장면 값으로 바꾼다(%는 만들지 않는다)', () => {
    const at = (
      stageIndex: number | null,
      status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' = 'RUNNING',
    ) => stageProgress(fakeJob({ status, stageIndex }))
    expect(stageProgress(null)).toBe(at(1))
    expect(at(1)).toBeLessThan(at(2))
    expect(at(2)).toBeLessThan(at(3))
    expect(at(3)).toBeLessThan(at(4))
    expect(at(4)).toBeLessThan(at(4, 'SUCCEEDED'))
    expect(at(null, 'QUEUED')).toBe(at(1))
  })
})
