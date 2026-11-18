import { describe, expect, it } from 'vitest'
import {
  aheadText,
  elapsedText,
  etaNote,
  formatElapsed,
  stageCaption,
  stageFraction,
  stepState,
  waitingCaption,
  waitingStageIndex,
  waitingStepText,
} from './stage'
import { fakeJob } from './testing'

describe('stageFraction', () => {
  it('2/4 단계면 Figma처럼 40%를 채운다(마지막 칸은 완료 몫)', () => {
    expect(stageFraction({ status: 'RUNNING', stageIndex: 2 })).toBeCloseTo(0.4)
    expect(stageFraction({ status: 'RUNNING', stageIndex: 4 })).toBeCloseTo(0.8)
  })

  it('대기 중(stageIndex null)이면 비어 있고, 완료면 가득 찬다', () => {
    expect(stageFraction({ status: 'QUEUED', stageIndex: null })).toBe(0)
    expect(stageFraction({ status: 'SUCCEEDED', stageIndex: 4 })).toBe(1)
  })

  it('QUEUED에도 단계가 오면 stageIndex대로 채운다', () => {
    expect(stageFraction({ status: 'QUEUED', stageIndex: 1 })).toBeCloseTo(0.2)
    expect(stageFraction({ status: 'QUEUED', stageIndex: 2 })).toBeCloseTo(0.4)
  })

  it('범위를 벗어난 값은 잘라 낸다', () => {
    expect(stageFraction({ status: 'RUNNING', stageIndex: 9 })).toBeCloseTo(0.8)
  })
})

describe('stageCaption', () => {
  it('단계 이름과 순번을 보여 준다', () => {
    expect(
      stageCaption({
        status: 'RUNNING',
        stage: 'QUALITY_CHECK',
        stageIndex: 2,
        queuePosition: null,
      }),
    ).toBe('입력 품질 확인 · 2/4 단계')
  })

  it('BE가 waiting을 주면 기다리는 단계 이름과 자기 대기열 순번을 보여 준다', () => {
    const queued = { status: 'QUEUED', waiting: true } as const
    expect(stageCaption({ ...queued, stage: null, stageIndex: null, queuePosition: 3 })).toBe(
      '프레임 고르기 · 앞에 2명',
    )
    // 추출 lease가 끝나 다시 기다림: FRAME_SELECT로 와도 1단계 대기
    expect(
      stageCaption({ ...queued, stage: 'FRAME_SELECT', stageIndex: 1, queuePosition: 1 }),
    ).toBe('프레임 고르기 · 다음 차례')
    expect(
      stageCaption({ ...queued, stage: 'QUALITY_CHECK', stageIndex: 2, queuePosition: 1 }),
    ).toBe('입력 품질 확인 · 다음 차례')
  })

  it('추출 중(waiting false)이면 1단계 진행으로 보여 준다', () => {
    expect(
      stageCaption({
        status: 'QUEUED',
        stage: 'FRAME_SELECT',
        stageIndex: 1,
        queuePosition: null,
        waiting: false,
      }),
    ).toBe('프레임 고르기 · 1/4 단계')
  })

  it('waiting이 없는 이전 BE는 상태로 기다리는 단계를 추정한다', () => {
    expect(
      stageCaption({ status: 'QUEUED', stage: null, stageIndex: null, queuePosition: 3 }),
    ).toBe('프레임 고르기 · 앞에 2명')
    expect(
      stageCaption({ status: 'QUEUED', stage: null, stageIndex: null, queuePosition: null }),
    ).toBe('프레임 고르기 · 순서를 기다리는 중')
    expect(
      stageCaption({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1, queuePosition: 2 }),
    ).toBe('프레임 고르기 · 1/4 단계')
    expect(
      stageCaption({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2, queuePosition: 2 }),
    ).toBe('입력 품질 확인 · 앞에 1명')
  })

  it('실행 중인데 단계 보고 전이면 "대기 중"', () => {
    expect(
      stageCaption({ status: 'RUNNING', stage: null, stageIndex: null, queuePosition: null }),
    ).toBe('대기 중')
  })
})

describe('waitingStageIndex · waitingCaption', () => {
  it('waiting이면 stageIndex에서, 단계가 없으면 1단계에서 기다린다', () => {
    const queued = { status: 'QUEUED', waiting: true } as const
    expect(waitingStageIndex({ ...queued, stage: null, stageIndex: null })).toBe(1)
    expect(waitingStageIndex({ ...queued, stage: 'FRAME_SELECT', stageIndex: 1 })).toBe(1)
    expect(waitingStageIndex({ ...queued, stage: 'QUALITY_CHECK', stageIndex: 2 })).toBe(2)
    expect(
      waitingStageIndex({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1, waiting: false }),
    ).toBeNull()
    expect(
      waitingStageIndex({ status: 'RUNNING', stage: 'RECONSTRUCT', stageIndex: 3, waiting: false }),
    ).toBeNull()
  })

  it('waiting이 없으면 QUEUED+단계 없음은 1단계, QUEUED+QUALITY_CHECK는 2단계 대기다', () => {
    expect(waitingStageIndex({ status: 'QUEUED', stage: null, stageIndex: null })).toBe(1)
    expect(waitingStageIndex({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2 })).toBe(2)
    expect(waitingStageIndex({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1 })).toBeNull()
    expect(
      waitingStageIndex({ status: 'RUNNING', stage: 'QUALITY_CHECK', stageIndex: 2 }),
    ).toBeNull()
  })

  it('기다리지 않으면 대기 문구가 없다', () => {
    expect(
      waitingCaption({
        status: 'RUNNING',
        stage: 'RECONSTRUCT',
        stageIndex: 3,
        queuePosition: null,
        waiting: false,
      }),
    ).toBeNull()
  })
})

describe('stepState', () => {
  const states = (job: Parameters<typeof stepState>[0]) =>
    [1, 2, 3, 4].map((index) => stepState(job, index))

  it('작업을 받기 전에는 모두 아직 오지 않은 단계다', () => {
    expect(states(null)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('접수 직후(추출 대기)는 1단계가 대기, 나머지는 아직 오지 않았다', () => {
    expect(
      states(fakeJob({ status: 'QUEUED', stage: null, stageIndex: null, waiting: true })),
    ).toEqual(['queued', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('추출 중이면 1단계 진행 중이다', () => {
    expect(
      states(fakeJob({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1, waiting: false })),
    ).toEqual(['current', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('추출 lease가 끝나 다시 기다리면 1단계 대기다', () => {
    expect(
      states(fakeJob({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1, waiting: true })),
    ).toEqual(['queued', 'upcoming', 'upcoming', 'upcoming'])
  })

  it('GPU를 기다리면 1단계 완료, 2단계 대기다', () => {
    expect(
      states(fakeJob({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2, waiting: true })),
    ).toEqual(['done', 'queued', 'upcoming', 'upcoming'])
  })

  it('실행 중이면 지난 단계 완료, 지금 단계 진행 중이다', () => {
    expect(
      states(fakeJob({ status: 'RUNNING', stage: 'RECONSTRUCT', stageIndex: 3, waiting: false })),
    ).toEqual(['done', 'done', 'current', 'upcoming'])
  })

  it('성공하면 모두 완료, 실패하면 실패한 단계부터 진행 표시가 없다', () => {
    expect(states(fakeJob({ status: 'SUCCEEDED', stage: 'FINALIZE', stageIndex: 4 }))).toEqual([
      'done',
      'done',
      'done',
      'done',
    ])
    expect(
      states(fakeJob({ status: 'FAILED', stage: 'RECONSTRUCT', stageIndex: 3, waiting: false })),
    ).toEqual(['done', 'done', 'upcoming', 'upcoming'])
  })

  it('waiting이 없는 이전 BE도 같은 칸을 보인다', () => {
    expect(states(fakeJob({ status: 'QUEUED', stage: null, stageIndex: null }))).toEqual([
      'queued',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
    expect(states(fakeJob({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2 }))).toEqual([
      'done',
      'queued',
      'upcoming',
      'upcoming',
    ])
  })
})

describe('etaNote · elapsedText', () => {
  it('RUNNING이면 "3분에서 5분 정도 걸려요"를 붙인다', () => {
    expect(etaNote({ status: 'RUNNING', stage: 'RECONSTRUCT' })).toBe('3분에서 5분 정도 걸려요')
    expect(elapsedText({ status: 'RUNNING', stage: 'RECONSTRUCT' }, 130_000)).toBe(
      '2분 10초 지났어요 · 3분에서 5분 정도 걸려요',
    )
  })

  it('QUEUED이면 걸리는 시간을 말하지 않는다', () => {
    expect(elapsedText({ status: 'QUEUED', stage: null }, 130_000)).toBe(
      '2분 10초 지났어요 · 순서가 되면 바로 시작해요',
    )
    expect(elapsedText({ status: 'QUEUED', stage: 'QUALITY_CHECK' }, 130_000)).toBe(
      '2분 10초 지났어요 · 순서가 되면 바로 시작해요',
    )
    expect(etaNote({ status: 'QUEUED', stage: 'FRAME_SELECT' })).toBeNull()
    // 추출 lease가 끝나 다시 기다리면 순서 안내를 붙인다
    expect(etaNote({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1, waiting: true })).toBe(
      '순서가 되면 바로 시작해요',
    )
    expect(elapsedText({ status: 'QUEUED', stage: 'FRAME_SELECT' }, 130_000)).toBe(
      '2분 10초 지났어요',
    )
  })
})

describe('aheadText · waitingStepText', () => {
  it('앞에 기다리는 수는 순번 − 1이고, 맨 앞(순번 1)이면 "다음 차례"다(-794)', () => {
    expect(aheadText(3)).toBe('앞에 2명')
    expect(aheadText(2)).toBe('앞에 1명')
    expect(aheadText(1)).toBe('다음 차례')
    expect(aheadText(null)).toBeNull()
    expect(waitingStepText(2)).toBe('순서를 기다리는 중 · 앞에 1명')
    // 맨 앞이면 '순서를 기다리는 중 · 다음 차례'로 말이 겹치지 않게 '다음 차례'만
    expect(waitingStepText(1)).toBe('다음 차례')
    expect(waitingStepText(null)).toBe('순서를 기다리는 중')
  })
})

describe('formatElapsed', () => {
  it.each([
    [0, '0초'],
    [59_900, '59초'],
    [120_000, '2분'],
    [130_000, '2분 10초'],
    [3_600_000, '1시간'],
    [3_720_000, '1시간 2분'],
    [-5_000, '0초'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text)
  })
})
