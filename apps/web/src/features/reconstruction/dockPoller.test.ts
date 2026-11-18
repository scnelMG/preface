import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDockPoller, type DockPollerDeps } from './dockPoller'
import { fakeJob } from './testing'
import type { ReconstructionJob } from './types'

function setup(overrides: Partial<DockPollerDeps> = {}) {
  let tracked: ReconstructionJob | null = null
  let hidden = false
  const deps = {
    fetchCurrent: vi.fn<DockPollerDeps['fetchCurrent']>().mockResolvedValue(null),
    fetchJob: vi.fn<DockPollerDeps['fetchJob']>(),
    getTracked: () => tracked,
    setTracked: vi.fn((job: ReconstructionJob | null) => {
      tracked = job
    }),
    onFinished: vi.fn<DockPollerDeps['onFinished']>(),
    isHidden: () => hidden,
  }
  const poller = createDockPoller({ ...deps, ...overrides })
  return {
    deps,
    poller,
    get tracked() {
      return tracked
    },
    setTracked: (job: ReconstructionJob | null) => {
      tracked = job
    },
    hide: (value: boolean) => {
      hidden = value
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createDockPoller', () => {
  it('처음 한 번 REC-03으로 진행 중 작업을 되찾고, 10초마다 다시 묻는다', async () => {
    const t = setup()
    t.deps.fetchCurrent.mockResolvedValue(fakeJob({ stageIndex: 1, stage: 'FRAME_SELECT' }))

    await t.poller.pollNow()
    expect(t.tracked?.stageIndex).toBe(1)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)

    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await vi.advanceTimersByTimeAsync(9_999)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    expect(t.tracked?.stageIndex).toBe(2)
    t.poller.stop()
  })

  it('진행 중 작업이 없어도 보이는 탭에서는 30초마다 물어, 다른 탭·기기에서 시작한 작업을 잡는다(-790)', async () => {
    const t = setup()
    await t.poller.pollNow()
    expect(t.tracked).toBeNull()

    // 다른 탭(또는 휴대폰)에서 3D 생성을 시작했다
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await vi.advanceTimersByTimeAsync(29_999)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    expect(t.tracked?.jobId).toBe('job-test-1')

    // 잡은 뒤에는 10초 간격으로 돌아간다
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(3)
    t.poller.stop()
  })

  it('작업이 없을 때 첫 조회가 실패해도 다음 주기(30초)에 다시 묻는다(-790)', async () => {
    const t = setup()
    t.deps.fetchCurrent.mockRejectedValueOnce(new Error('network'))
    await t.poller.pollNow()
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    expect(t.tracked?.jobId).toBe('job-test-1')
    t.poller.stop()
  })

  it('숨긴 탭에서 작업이 없으면 묻지 않고, 다시 보일 때 refresh()로 바로 묻는다(-790)', async () => {
    const t = setup()
    t.hide(true)
    await t.poller.pollNow()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)

    t.hide(false)
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await t.poller.refresh()
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    expect(t.tracked?.jobId).toBe('job-test-1')
    t.poller.stop()
  })

  it('refresh()는 방금(5초 안) 물었으면 건너뛴다. 보이기·포커스가 겹쳐 와도 한 번만 묻는다(-790)', async () => {
    const t = setup()
    await t.poller.pollNow()
    await t.poller.refresh()
    await t.poller.refresh()
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    await t.poller.refresh()
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    t.poller.stop()
  })

  it('REC-03이 null이 되면 추적하던 작업을 REC-02로 한 번 확인해 완료를 알린다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    const done = fakeJob({
      status: 'SUCCEEDED',
      stage: 'FINALIZE',
      stageIndex: 4,
      faceModelId: 'fm-1',
    })
    t.deps.fetchJob.mockResolvedValue(done)

    await t.poller.pollNow()

    expect(t.deps.fetchJob).toHaveBeenCalledTimes(1)
    expect(t.deps.fetchJob.mock.calls[0]?.[0]).toBe('job-test-1')
    expect(t.deps.onFinished).toHaveBeenCalledWith(done)
    expect(t.tracked).toBeNull()

    // 끝난 작업은 다시 확인하지 않는다. 이후로는 작업이 없을 때의 간격(30초)으로만 묻는다
    await vi.advanceTimersByTimeAsync(29_999)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    expect(t.deps.fetchJob).toHaveBeenCalledTimes(1)
    t.poller.stop()
  })

  it('실패도 알린다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    t.deps.fetchJob.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['QUALITY_LIGHT'] }))
    await t.poller.pollNow()
    expect(t.deps.onFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }))
  })

  it('취소됐거나 REC-02가 실패(404)하면 알리지 않고 놓는다', async () => {
    const canceled = setup()
    canceled.setTracked(fakeJob())
    canceled.deps.fetchJob.mockResolvedValue(fakeJob({ status: 'CANCELED' }))
    await canceled.poller.pollNow()
    expect(canceled.deps.onFinished).not.toHaveBeenCalled()
    expect(canceled.tracked).toBeNull()

    const missing = setup()
    missing.setTracked(fakeJob())
    missing.deps.fetchJob.mockRejectedValue(new Error('404'))
    await missing.poller.pollNow()
    expect(missing.deps.onFinished).not.toHaveBeenCalled()
    expect(missing.tracked).toBeNull()
  })

  it('REC-03은 null인데 REC-02가 아직 진행 중이면 계속 추적한다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    t.deps.fetchJob.mockResolvedValue(fakeJob({ stage: 'FINALIZE', stageIndex: 4 }))
    await t.poller.pollNow()
    expect(t.tracked?.stageIndex).toBe(4)
    expect(t.deps.onFinished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    t.poller.stop()
  })

  it('다른 작업이 진행 중으로 오면 이전 작업을 마무리하고 새 작업을 잡는다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    t.deps.fetchJob.mockResolvedValue(fakeJob({ status: 'SUCCEEDED' }))
    t.deps.fetchCurrent.mockResolvedValue(fakeJob({ jobId: 'job-test-2', status: 'QUEUED' }))
    await t.poller.pollNow()
    expect(t.deps.onFinished).toHaveBeenCalledTimes(1)
    expect(t.tracked?.jobId).toBe('job-test-2')
    t.poller.stop()
  })

  it('REC-03이 끝난 작업을 돌려주면 바로 마무리한다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    t.deps.fetchCurrent.mockResolvedValue(fakeJob({ status: 'FAILED' }))
    await t.poller.pollNow()
    expect(t.deps.fetchJob).not.toHaveBeenCalled()
    expect(t.deps.onFinished).toHaveBeenCalledTimes(1)
    expect(t.tracked).toBeNull()
  })

  it('탭이 숨겨져 있으면 60초로 늦춘다', async () => {
    const t = setup()
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    t.hide(true)
    await t.poller.pollNow()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    t.poller.stop()
  })

  it('일시 오류가 나도 다음 주기에 다시 묻는다', async () => {
    const t = setup()
    t.setTracked(fakeJob())
    t.deps.fetchCurrent.mockRejectedValueOnce(new Error('network'))
    await t.poller.pollNow()
    expect(t.tracked?.jobId).toBe('job-test-1')
    t.deps.fetchCurrent.mockResolvedValue(fakeJob({ stageIndex: 3, stage: 'RECONSTRUCT' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.tracked?.stageIndex).toBe(3)
    t.poller.stop()
  })

  it('pollNow를 겹쳐 불러도 요청은 하나다', async () => {
    const t = setup()
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await Promise.all([t.poller.pollNow(), t.poller.pollNow()])
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(1)
    t.poller.stop()
  })

  it('밖에서 작업을 알려 주면(ensureScheduled) 폴링을 잇는다', async () => {
    const t = setup()
    await t.poller.pollNow()
    t.setTracked(fakeJob())
    t.poller.ensureScheduled()
    t.deps.fetchCurrent.mockResolvedValue(fakeJob())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.deps.fetchCurrent).toHaveBeenCalledTimes(2)
    t.poller.stop()
  })

  it('stop 뒤에는 응답이 와도 상태를 바꾸지 않고 더 묻지 않는다', async () => {
    let resolve: (job: ReconstructionJob | null) => void = () => {}
    const t = setup({
      fetchCurrent: vi.fn(() => new Promise<ReconstructionJob | null>((r) => (resolve = r))),
    })
    const pending = t.poller.pollNow()
    t.poller.stop()
    resolve(fakeJob())
    await pending
    expect(t.tracked).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.deps.setTracked).not.toHaveBeenCalled()
    await t.poller.pollNow()
  })
})
