import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FAIL_MESSAGES } from '@/features/reconstruction/failMessages'
import { FailureBlock, JobDetailView, SegmentTable } from './JobDetail'
import type { AdminJobDetail, QualityReport } from './types'

const detail: AdminJobDetail = {
  jobId: 'job-1',
  userId: 'user-1',
  status: 'FAILED',
  stage: 'RECONSTRUCT',
  createdAt: '2026-11-07T03:00:00.000Z',
  extractClaimedAt: null,
  framesReadyAt: null,
  startedAt: '2026-11-07T03:00:05.000Z',
  finishedAt: '2026-11-07T03:03:02.000Z',
  durationMs: 182000,
  extractAttempts: 1,
  segments: [
    {
      key: 'GPU_WAIT',
      startedAt: '2026-11-07T03:00:00.000Z',
      finishedAt: '2026-11-07T03:00:03.000Z',
      durationMs: 3000,
    },
    {
      key: 'RECONSTRUCT',
      startedAt: '2026-11-07T03:00:03.000Z',
      finishedAt: '2026-11-07T03:03:00.000Z',
      durationMs: 177000,
      status: 'FAILED',
    },
  ],
  slowestSegment: 'RECONSTRUCT',
  failure: { stage: 'RECONSTRUCT', codes: ['FIT_FAILED'], userMessage: null, detail: 'trace' },
  previousFailures: [{ jobId: 'job-0', createdAt: '2026-11-06T03:00:00.000Z', codes: ['TIMEOUT'] }],
  input: {
    videoDurationMs: 12000,
    captureMethod: 'VIDEO',
    deviceModel: 'iPhone15,2',
    frameCount: 48,
    quality: { score: 0.9 },
  },
  faceModelId: null,
}

describe('SegmentTable', () => {
  it('가장 오래 걸린 구간을 강조하고, 기록 없는 구간은 기록 없음으로 보인다', () => {
    render(<SegmentTable detail={detail} />)
    const table = screen.getByRole('region', { name: '구간별 시간' })
    const rows = within(table).getAllByRole('row').slice(1)
    // FRAME_SELECT는 GPU 워커가 보고하지 않아 기록이 없으면 줄을 만들지 않는다
    expect(rows).toHaveLength(6)
    expect(within(table).queryByRole('rowheader', { name: '프레임 고르기' })).toBeNull()

    const slowest = rows.filter((row) => row.hasAttribute('data-slowest'))
    expect(slowest).toHaveLength(1)
    expect(slowest[0]).toHaveTextContent('3D 만들기')
    expect(slowest[0]).toHaveTextContent('가장 오래 걸림')
    expect(slowest[0]).toHaveTextContent('2분 57초')

    const extractWait = within(table).getByRole('rowheader', { name: '추출 대기' }).closest('tr')!
    expect(extractWait).toHaveAttribute('data-missing', 'true')
    expect(extractWait).toHaveTextContent('기록 없음')
    expect(rows.filter((row) => row.hasAttribute('data-missing'))).toHaveLength(4)
  })
})

describe('FailureBlock', () => {
  it('userMessage가 없으면 사용자 화면의 문구 사전으로 만든다', () => {
    render(<FailureBlock failure={detail.failure!} />)
    expect(screen.getByText(new RegExp(FAIL_MESSAGES.FIT_FAILED.reason))).toBeInTheDocument()
    expect(screen.getByText('trace')).toBeInTheDocument()
  })

  it('userMessage가 있으면 그것을 쓴다', () => {
    render(
      <FailureBlock
        failure={{ stage: null, codes: ['X'], userMessage: '서버 문구', detail: null }}
      />,
    )
    expect(screen.getByText('서버 문구')).toBeInTheDocument()
    expect(screen.getByText('기록 없음')).toBeInTheDocument()
  })
})

describe('JobDetailView', () => {
  it('사용자 모델 화면과 이전 실패 작업으로 가는 링크를 둔다', () => {
    render(<JobDetailView detail={detail} />)
    expect(screen.getByRole('link', { name: '이 사용자의 모델 보기' })).toHaveAttribute(
      'href',
      '/admin/users/user-1',
    )
    expect(screen.getByRole('link', { name: 'job-0' })).toHaveAttribute('href', '/admin/jobs/job-0')
    expect(screen.getByRole('region', { name: '실패' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// 생성 단계 6칸 진행 바와 단계 패널(S15P31B204-709). 합성 값만 쓴다

const at = (s: number) => new Date(Date.UTC(2026, 10, 9, 1, 0, s)).toISOString()
const part = (key: string, from: number, to: number, status = 'SUCCEEDED', attempt = 1) => ({
  key,
  startedAt: at(from),
  finishedAt: at(to),
  durationMs: (to - from) * 1000,
  attempt,
  status,
})

function makeJob(over: Partial<AdminJobDetail>, quality: QualityReport | null): AdminJobDetail {
  return {
    ...detail,
    jobId: 'job-synthetic',
    status: 'SUCCEEDED',
    stage: 'FINALIZE',
    failure: null,
    previousFailures: [],
    segments: [
      { key: 'EXTRACT_WAIT', startedAt: at(0), finishedAt: at(2), durationMs: 2000 },
      part('EXTRACT', 2, 20),
      { key: 'GPU_WAIT', startedAt: at(20), finishedAt: at(25), durationMs: 5000 },
      part('QUALITY_CHECK', 25, 27),
      part('RECONSTRUCT', 27, 250),
      part('FINALIZE', 250, 260),
    ],
    slowestSegment: 'RECONSTRUCT',
    input: { ...detail.input!, quality },
    ...over,
  }
}

const SUCCESS_QUALITY: QualityReport = {
  frames: 90,
  registered: 84,
  focalPx: 1450.5,
  focalSource: 'device',
  chosen: 'gnm',
  overall: 'PASS',
  holdoutPctIod: { inner: 1.2, outer: 2.4 },
  stageSec: { prepare: 20, sfm: 58, lens: 9, model: 140, viewer: 5 },
  modelSec: { fit: 90, hairline: 30 },
  gnmFitSec: { sil_frames: 11, ears: 5 },
  eyePartsSec: { solve_sec: 3.2, total_sec: 9.8 },
  bakeSec: { bake: 12 },
  finalizeSec: { contour: 3, noseCheck: 20, eyeLimits: 4, upload: 2 },
  captureViews: {
    FRONT: { yaw: 1.2, pitch: -2, by: 'sfm' },
    LEFT: { yaw: -80, pitch: 0, by: 'mediapipe' },
  },
}

const cell = (name: RegExp) => screen.getByRole('button', { name })
const panel = () => screen.getByRole('region', { name: / 패널$/ })

describe('생성 단계', () => {
  it('성공: 6칸이 모두 통과이고, 단계 사이에 대기 띠를 두며, 칸을 누르면 그 패널로 바뀐다', () => {
    render(<JobDetailView detail={makeJob({ faceModelId: 'model-synthetic' }, SUCCESS_QUALITY)} />)
    const bar = screen.getByRole('group', { name: '생성 단계' })
    const cells = within(bar).getAllByRole('button')
    expect(cells).toHaveLength(6)
    expect(cells.map((c) => c.getAttribute('data-status'))).toEqual(Array(6).fill('passed'))
    expect(bar.querySelectorAll('[data-wait]')).toHaveLength(2)
    expect(bar).toHaveTextContent('추출 대기 2.0초')
    expect(bar).toHaveTextContent('GPU 대기 5.0초')

    // 실패·진행·기록이 없으면 ⑥이 열린다
    expect(cell(/⑥ 뷰어·마무리/)).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(panel()).getByRole('group', { name: '마무리 하위 단계(finalizeSec)' }),
    ).toHaveTextContent('noseCheck')
    expect(within(panel()).getByRole('region', { name: '5방향 사진 각도' })).toHaveTextContent(
      'mediapipe',
    )
    expect(within(panel()).getByText('model-synthetic')).toBeInTheDocument()

    fireEvent.click(cell(/⑤ 형상 모델/))
    expect(cell(/⑤ 형상 모델/)).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(panel()).getByRole('group', { name: '형상 모델 하위 단계(modelSec)' }),
    ).toHaveTextContent('hairline')
    expect(
      within(panel()).getByRole('group', { name: 'gnm_fit 구간(gnmFitSec)' }),
    ).toHaveTextContent('ears')
    expect(
      within(panel()).getByRole('group', { name: '눈 부위 맞춤(eyePartsSec)' }),
    ).toHaveTextContent('solve_sec')
    expect(panel()).toHaveTextContent('판정 기록 없음 · 통과')

    fireEvent.click(cell(/④ 렌즈·자세 검사/))
    expect(panel()).toHaveTextContent('84/90장 (93%)')

    // 원본 JSON은 접힌 영역에 남는다
    expect(screen.getByText('품질 확인 결과(원본)').closest('details')).not.toHaveAttribute('open')
  })

  it('④ 실패: ④가 실패로 열리고 측정값·기준값을 나란히 보이며, 뒤 단계는 건너뜀이다', () => {
    const quality: QualityReport = {
      frames: 90,
      registered: 70,
      stageSec: { prepare: 20, sfm: 60, lens: 9 },
      diag: {
        cols: ['tMs', 'mpYaw', 'mpPitch', 'face', 'sfmYaw', 'sfmPitch'],
        frames: [
          [0, -40, 0, 1, -38, 0],
          [500, 0, 0, 1, 1, 0],
          [1000, 45, 0, 1, null, null],
        ],
        lensTrials: [{ f: 1400, slope: 0.9, sec: 4 }],
        notes: ['합성 메모'],
      },
    }
    render(
      <JobDetailView
        detail={makeJob(
          {
            status: 'FAILED',
            stage: 'RECONSTRUCT',
            segments: [part('QUALITY_CHECK', 25, 27), part('RECONSTRUCT', 27, 120, 'FAILED')],
            failure: {
              stage: 'RECONSTRUCT',
              codes: ['FIT_FAILED'],
              userMessage: null,
              detail:
                'lens: 카메라 위치 복원 실패: 오른쪽 측면 1/8장만 등록(기준 50% 이상) | exit 1: x',
            },
          },
          quality,
        )}
      />,
    )
    const bar = screen.getByRole('group', { name: '생성 단계' })
    expect(
      within(bar)
        .getAllByRole('button')
        .map((c) => c.getAttribute('data-status')),
    ).toEqual(['passed', 'passed', 'passed', 'failed', 'skipped', 'skipped'])
    expect(cell(/④ 렌즈·자세 검사/)).toHaveAttribute('aria-pressed', 'true')
    const verdict = panel().querySelector('[data-verdict="fail"]') as HTMLElement
    expect(verdict).toHaveTextContent('측면 등록 부족')
    expect(within(verdict).getByText('측정값').nextSibling).toHaveTextContent('오른쪽 1/8장')
    expect(within(verdict).getByText('기준값').nextSibling).toHaveTextContent(
      '측면 프레임 50% 이상 · 2장 이상',
    )

    // 실패 진단: 각도 그래프(미등록은 빈 점)와 초점 후보
    const chart = within(panel()).getByRole('img', { name: /3장 중 SfM 등록 2장/ })
    expect(chart.querySelectorAll('[data-point="unregistered"]')).toHaveLength(1)
    expect(chart.querySelectorAll('[data-point="sfm"]')).toHaveLength(2)
    expect(within(panel()).getByRole('region', { name: '초점 후보 시도' })).toHaveTextContent(
      '1400',
    )

    fireEvent.click(cell(/⑤ 형상 모델/))
    expect(panel()).toHaveTextContent('앞 단계에서 멈춰 실행되지 않았어요.')
    expect(within(panel()).queryByRole('group', { name: '판정' })).toBeNull()
  })

  it('TIMEOUT: timeoutStage의 단계가 실패이고 초과 당시 단계를 보인다', () => {
    render(
      <JobDetailView
        detail={makeJob(
          {
            status: 'FAILED',
            stage: 'RECONSTRUCT',
            segments: [part('RECONSTRUCT', 27, 1827, 'FAILED')],
            failure: {
              stage: 'RECONSTRUCT',
              codes: ['TIMEOUT'],
              userMessage: null,
              detail: '3d build exceeded 1800s during model (done: prepare 20s, sfm 60s, lens 9s)',
            },
          },
          { stageSec: { prepare: 20, sfm: 60, lens: 9 }, timeoutStage: 'model' },
        )}
      />,
    )
    expect(cell(/⑤ 형상 모델/)).toHaveAttribute('data-status', 'failed')
    expect(cell(/⑤ 형상 모델/)).toHaveAttribute('aria-pressed', 'true')
    expect(cell(/⑥ 뷰어·마무리/)).toHaveAttribute('data-status', 'skipped')
    const verdict = panel().querySelector('[data-verdict="fail"]') as HTMLElement
    expect(verdict).toHaveTextContent('TIMEOUT')
    expect(verdict).toHaveTextContent('시간 초과')
    expect(verdict).toHaveTextContent('초과 당시 단계: model')
    // modelSec이 없으면 미측정
    expect(
      within(panel()).getByRole('group', { name: '형상 모델 하위 단계(modelSec)' }),
    ).toHaveTextContent('미측정')
  })

  it('코 검사 실패: ⑥이 실패이고 코 검사 이유와 시도 표를 보인다', () => {
    render(
      <JobDetailView
        detail={makeJob(
          {
            status: 'FAILED',
            stage: 'FINALIZE',
            segments: [part('RECONSTRUCT', 27, 250), part('FINALIZE', 250, 270, 'FAILED')],
            failure: {
              stage: 'FINALIZE',
              codes: ['INTERNAL'],
              userMessage: null,
              detail: 'nose edit mesh validation failed: 합성 이유',
            },
          },
          {
            ...SUCCESS_QUALITY,
            finalizeSec: undefined,
            captureViews: undefined,
            noseCheck: {
              eligible: false,
              reason: '합성 이유',
              tried: [
                { limit: 0.5, at: 'neutral', valid: false, skinValid: false, selfIntersections: 3 },
              ],
            },
          },
        )}
      />,
    )
    expect(cell(/⑥ 뷰어·마무리/)).toHaveAttribute('data-status', 'failed')
    expect(cell(/⑤ 형상 모델/)).toHaveAttribute('data-status', 'passed')
    const verdict = panel().querySelector('[data-verdict="fail"]') as HTMLElement
    expect(verdict).toHaveTextContent('코 편집 검사 실패')
    expect(within(panel()).getByRole('region', { name: '코 편집 검사 시도' })).toHaveTextContent(
      'neutral',
    )
    // 실패 작업은 finalizeSec을 보내지 않는다
    expect(
      within(panel()).getByRole('group', { name: '마무리 하위 단계(finalizeSec)' }),
    ).toHaveTextContent('미측정')
  })

  it('quality 없음: 3D 단계 값은 기록 없음(배포 전 작업)이고 원본 JSON 영역이 없다', () => {
    render(<JobDetailView detail={makeJob({}, null)} />)
    expect(cell(/⑥ 뷰어·마무리/)).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel()).getByRole('group', { name: '진단값' })).toHaveTextContent(
      '기록 없음(배포 전 작업)',
    )
    fireEvent.click(cell(/④ 렌즈·자세 검사/))
    expect(panel()).toHaveTextContent('단계 시간: 기록 없음(배포 전 작업)')
    expect(panel()).toHaveTextContent('3D 만들기 구간(③–⑤ 공통)')
    expect(screen.queryByText('품질 확인 결과(원본)')).toBeNull()
  })
})
