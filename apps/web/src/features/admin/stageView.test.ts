import { describe, expect, it } from 'vitest'
import {
  angleCheckOf,
  defaultStage,
  failedStageOf,
  jobStages,
  reconstructSubStage,
  type StageKey,
  type StageStatus,
} from './stageView'
import type { AdminJobDetail, JobSegment, QualityReport } from './types'

// 합성 값만 쓴다(실제 작업·사용자 값 아님)
const at = (s: number) => new Date(Date.UTC(2026, 10, 9, 1, 0, s)).toISOString()
const seg = (
  key: string,
  from: number,
  to: number | null,
  status: string | null = 'SUCCEEDED',
  attempt: number | null = 1,
): JobSegment => ({
  key,
  startedAt: at(from),
  finishedAt: to === null ? null : at(to),
  durationMs: to === null ? null : (to - from) * 1000,
  attempt,
  status,
})

function job(
  over: Partial<AdminJobDetail> = {},
  quality: QualityReport | null = null,
): AdminJobDetail {
  return {
    jobId: 'job-synthetic',
    userId: 'user-synthetic',
    status: 'SUCCEEDED',
    stage: 'FINALIZE',
    createdAt: at(0),
    extractClaimedAt: at(2),
    framesReadyAt: at(20),
    startedAt: at(25),
    finishedAt: at(260),
    durationMs: 260000,
    extractAttempts: 1,
    segments: [
      { key: 'EXTRACT_WAIT', startedAt: at(0), finishedAt: at(2), durationMs: 2000 },
      seg('EXTRACT', 2, 20),
      { key: 'GPU_WAIT', startedAt: at(20), finishedAt: at(25), durationMs: 5000 },
      seg('QUALITY_CHECK', 25, 27),
      seg('RECONSTRUCT', 27, 250),
      seg('FINALIZE', 250, 260),
    ],
    slowestSegment: 'RECONSTRUCT',
    failure: null,
    previousFailures: [],
    input: {
      videoDurationMs: 15000,
      captureMethod: 'WEB_RECORD',
      deviceModel: 'synthetic-phone',
      frameCount: 90,
      quality,
    },
    faceModelId: null,
    ...over,
  }
}

const statuses = (detail: AdminJobDetail) =>
  Object.fromEntries(jobStages(detail).stages.map((s) => [s.key, s.status])) as Record<
    StageKey,
    StageStatus
  >

const QUALITY: QualityReport = {
  frames: 90,
  registered: 80,
  stageSec: { prepare: 20, sfm: 60, lens: 10, model: 130, viewer: 5 },
  modelSec: { fit: 80, hairline: 30 },
}

describe('jobStages', () => {
  it('성공 작업은 6단계 모두 통과, 단계 시간은 구간 + 워커 단계 초', () => {
    const view = jobStages(job({}, QUALITY))
    expect(view.failed).toBeNull()
    expect(Object.values(statuses(job({}, QUALITY)))).toEqual(Array(6).fill('passed'))
    const time = Object.fromEntries(view.stages.map((s) => [s.key, s.durationMs]))
    expect(time).toEqual({
      capture: 15000,
      extract: 18000,
      sfm: 2000 + 20000 + 60000,
      lens: 10000,
      model: 130000,
      finalize: 5000 + 10000,
    })
    expect(view.waits.map((w) => [w.key, w.after, w.durationMs])).toEqual([
      ['EXTRACT_WAIT', 'capture', 2000],
      ['GPU_WAIT', 'extract', 5000],
    ])
  })

  it('poseCheck·두상 범위 밖·noseCheck는 기록 판정이라 passed_with_notes', () => {
    const detail = job(
      {},
      {
        ...QUALITY,
        poseCheck: 'FAIL',
        poseNote: '합성 메모',
        head: { ratios: { a: 1 }, outOfRange: ['a'] },
        noseCheck: { eligible: false, tried: [], reason: '합성 이유' },
      },
    )
    const view = jobStages(detail)
    const model = view.stages.find((s) => s.key === 'model')!
    expect(model.status).toBe('passed_with_notes')
    expect(model.verdicts.map((v) => [v.kind, v.code])).toEqual([
      ['record', 'POSE_CHECK'],
      ['record', 'HEAD_RATIO'],
    ])
    const finalize = view.stages.find((s) => s.key === 'finalize')!
    expect(finalize.status).toBe('passed_with_notes')
    expect(finalize.verdicts[0].message).toContain('합성 이유')
    expect(defaultStage(view.stages)).toBe('model')
  })

  it('실패는 한 단계뿐이고 뒤 단계는 모두 skipped', () => {
    const detail = job(
      {
        status: 'FAILED',
        stage: 'RECONSTRUCT',
        failure: {
          stage: 'RECONSTRUCT',
          codes: ['FIT_FAILED'],
          userMessage: null,
          detail:
            'lens: 카메라 위치 복원 실패: 왼쪽 측면 1/9장만 등록(기준 50% 이상) → 재촬영 | exit 1: tail',
        },
        segments: [seg('QUALITY_CHECK', 25, 27), seg('RECONSTRUCT', 27, 120, 'FAILED')],
      },
      { frames: 90, registered: 70, stageSec: { prepare: 20, sfm: 60, lens: 9 } },
    )
    expect(statuses(detail)).toEqual({
      capture: 'passed',
      extract: 'passed',
      sfm: 'passed',
      lens: 'failed',
      model: 'skipped',
      finalize: 'skipped',
    })
    const lens = jobStages(detail).stages.find((s) => s.key === 'lens')!
    expect(lens.verdicts).toEqual([
      expect.objectContaining({
        kind: 'fail',
        code: 'FIT_FAILED',
        check: '측면 등록 부족',
        measured: '왼쪽 1/9장',
        threshold: '측면 프레임 50% 이상 · 2장 이상',
      }),
    ])
    // 출력 끝(경로가 섞일 수 있음)은 버린다
    expect(lens.verdicts[0].message).not.toContain('tail')
    expect(jobStages(detail).stages.find((s) => s.key === 'model')!.parts).toEqual([])
  })

  it('등록 60% 미만 실패는 등록 비율을 측정값으로 둔다', () => {
    const detail = job(
      {
        status: 'FAILED',
        failure: {
          stage: 'RECONSTRUCT',
          codes: ['FIT_FAILED'],
          userMessage: null,
          detail: 'lens: 카메라 위치 복원 실패(등록 프레임 60% 미만) | exit 1: x',
        },
      },
      { frames: 90, registered: 45 },
    )
    const lens = jobStages(detail).stages.find((s) => s.key === 'lens')!
    expect(lens.verdicts[0]).toMatchObject({
      check: '등록 비율 부족',
      measured: '등록 45/90장 (50%)',
      threshold: '등록 60% 이상',
    })
  })

  it('진행 중인 작업: RECONSTRUCT 진행 중이면 ③–⑤ 진행 중, ⑥은 시작 전', () => {
    const detail = job({
      status: 'RUNNING',
      stage: 'RECONSTRUCT',
      finishedAt: null,
      segments: [
        seg('EXTRACT', 2, 20),
        seg('QUALITY_CHECK', 25, 27),
        seg('RECONSTRUCT', 27, null, 'RUNNING'),
      ],
    })
    expect(statuses(detail)).toEqual({
      capture: 'passed',
      extract: 'passed',
      sfm: 'running',
      lens: 'running',
      model: 'running',
      finalize: 'pending',
    })
  })

  it('다시 시도한 추출은 시도마다 시간 조각을 두고, 앞 시도 실패는 기록 판정', () => {
    const detail = job({
      segments: [seg('EXTRACT', 2, 10, 'FAILED', 1), seg('EXTRACT', 12, 30, 'SUCCEEDED', 2)],
    })
    const extract = jobStages(detail).stages.find((s) => s.key === 'extract')!
    expect(extract.parts.map((p) => p.label)).toEqual(['프레임 추출', '프레임 추출 (2번째 시도)'])
    expect(extract.durationMs).toBe(8000 + 18000)
    expect(extract.status).toBe('passed_with_notes')
    expect(extract.verdicts[0].code).toBe('RETRY')
  })

  it('quality가 객체가 아니면 없는 것으로 본다', () => {
    expect(jobStages(job({}, 'oops' as unknown as QualityReport)).quality).toBeNull()
  })
})

describe('failedStageOf · reconstructSubStage', () => {
  const failure = (stage: string | null, codes: string[], detail: string | null) => ({
    status: 'FAILED',
    stage,
    failure: { stage, codes, userMessage: null, detail },
    input: null,
  })

  it('BE 구간으로 ②·③·⑥을 정한다', () => {
    expect(failedStageOf(failure('EXTRACT', ['QUALITY_ANGLE'], '{}')).stage).toBe('extract')
    expect(
      failedStageOf(failure('QUALITY_CHECK', ['INTERNAL'], 'bundle checksum mismatch')).stage,
    ).toBe('sfm')
    expect(
      failedStageOf(failure('FINALIZE', ['INTERNAL'], 'nose edit mesh validation failed: x')).stage,
    ).toBe('finalize')
  })

  it('RECONSTRUCT는 detail 앞머리로 세부 단계를 정한다', () => {
    const sub = (detail: string) => reconstructSubStage({ detail }, null)
    expect(sub('prepare: prepare_capture exit 1')).toEqual({ stage: 'sfm', guessed: false })
    expect(sub('sfm: sfm exit 3')).toEqual({ stage: 'sfm', guessed: false })
    expect(sub('lens: lens_anchor exit 2')).toEqual({ stage: 'lens', guessed: false })
    expect(sub('model: scan_to_model exit 1')).toEqual({ stage: 'model', guessed: false })
    expect(sub('viewer: build_viewer exit 1')).toEqual({ stage: 'finalize', guessed: false })
  })

  it('TIMEOUT은 timeoutStage를 먼저, 없으면 detail의 during을 쓴다', () => {
    expect(
      reconstructSubStage(
        { detail: '3d build exceeded 1800s during sfm' },
        { timeoutStage: 'model' },
      ),
    ).toEqual({ stage: 'model', guessed: false })
    expect(
      reconstructSubStage({ detail: '3d build exceeded 1800s during lens (done: x)' }, null),
    ).toEqual({
      stage: 'lens',
      guessed: false,
    })
    expect(reconstructSubStage({ detail: null }, { timeoutStage: 'after viewer' }).stage).toBe(
      'finalize',
    )
  })

  it('단서가 없으면 stageSec 마지막 단계로 추정한다', () => {
    expect(
      reconstructSubStage(
        { detail: '3d build killed by signal 9' },
        { stageSec: { prepare: 1, sfm: 2, lens: 3 } },
      ),
    ).toEqual({ stage: 'lens', guessed: true })
    expect(reconstructSubStage({ detail: null }, null)).toEqual({ stage: 'sfm', guessed: true })
  })

  it('실패 작업이 아니면 null', () => {
    expect(
      failedStageOf({ status: 'SUCCEEDED', stage: null, failure: null, input: null }).stage,
    ).toBeNull()
  })
})

describe('angleCheckOf', () => {
  it('각도 판정 JSON을 읽고, 잘렸거나 JSON이 아니면 null', () => {
    expect(angleCheckOf('{"short":["LEFT"],"yawMin":-20.5}')).toEqual({
      short: ['LEFT'],
      yawMin: -20.5,
    })
    expect(angleCheckOf('{"short":["LEF')).toBeNull()
    expect(angleCheckOf('extract exit 1')).toBeNull()
  })
})
