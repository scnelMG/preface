import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import * as recApi from '@/features/reconstruction/api'
import { useReconstructionStore } from '@/features/reconstruction/store'
import { fakeJob } from '@/features/reconstruction/testing'
import * as api from './api'
import type { CaptureLinkState, CreatedCaptureLink } from './types'
import { POLL_INTERVAL_MS, useCaptureLink } from './useCaptureLink'

vi.mock('./api', () => ({
  createCaptureLink: vi.fn(),
  getCaptureLink: vi.fn(),
  deleteCaptureLink: vi.fn(),
}))

vi.mock('@/features/reconstruction/api', () => ({
  getCurrentReconstruction: vi.fn(),
  getReconstruction: vi.fn(),
}))

const currentJobMock = vi.mocked(recApi.getCurrentReconstruction)
const jobMock = vi.mocked(recApi.getReconstruction)
const createMock = vi.mocked(api.createCaptureLink)
const getMock = vi.mocked(api.getCaptureLink)
const deleteMock = vi.mocked(api.deleteCaptureLink)

const START = new Date('2026-10-25T10:00:00Z').getTime()

// 합성 값이다. 실제 토큰이 아니다
function link(id = 'lk-1', ttlMs = 180_000): CreatedCaptureLink {
  return {
    linkId: id,
    qrUrl: `https://example.test/m/capture#t=fake-${id}`,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  }
}

function state(status: CaptureLinkState['status'], jobId: string | null = null): CaptureLinkState {
  return { linkId: 'lk-1', status, expiresAt: '', jobId }
}

/** 마이크로태스크(응답 처리)까지 흘려보낸다 */
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers({ now: START })
  createMock.mockReset()
  getMock.mockReset()
  deleteMock.mockReset().mockResolvedValue({})
  currentJobMock.mockReset().mockResolvedValue(null)
  jobMock.mockReset().mockImplementation(async (jobId) => fakeJob({ jobId, status: 'QUEUED' }))
  useReconstructionStore.getState().clear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useCaptureLink', () => {
  it('켜지면 QR을 발급하고 남은 시간을 1초씩 센다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValue(state('WAITING'))
    const { result } = renderHook(() => useCaptureLink())

    expect(result.current.view.kind).toBe('issuing')
    await flush()

    const view = result.current.view
    expect(view.kind).toBe('ready')
    if (view.kind !== 'ready') return
    expect(view.status).toBe('WAITING')
    expect(view.remainingMs).toBe(180_000)

    await advance(1000)
    const later = result.current.view
    expect(later.kind === 'ready' && later.remainingMs).toBe(179_000)
  })

  it('enabled가 false면 발급하지 않는다', async () => {
    renderHook(() => useCaptureLink({ enabled: false }))
    await flush()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('3초마다 상태를 묻고, 연결되면 CONNECTED, 업로드되면 jobId로 알린다', async () => {
    createMock.mockResolvedValue(link())
    getMock
      .mockResolvedValueOnce(state('WAITING'))
      .mockResolvedValueOnce(state('CONNECTED'))
      .mockResolvedValueOnce(state('UPLOADED', 'job-9'))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS - 1)
    expect(getMock).not.toHaveBeenCalled()
    await advance(1)
    expect(getMock).toHaveBeenCalledTimes(1)

    await advance(POLL_INTERVAL_MS)
    expect(result.current.view.kind === 'ready' && result.current.view.status).toBe('CONNECTED')

    await advance(POLL_INTERVAL_MS)
    expect(onUploaded).toHaveBeenCalledWith('job-9')
    expect(result.current.view.kind === 'ready' && result.current.view.status).toBe('UPLOADED')

    // 끝난 링크는 더 묻지 않는다
    await advance(POLL_INTERVAL_MS * 3)
    expect(getMock).toHaveBeenCalledTimes(3)
  })

  it('시간이 다 되면 서버 응답 전이라도 만료로 보여 준다', async () => {
    createMock.mockResolvedValue(link('lk-1', 5000))
    getMock.mockResolvedValue(state('WAITING'))
    const { result } = renderHook(() => useCaptureLink())
    await flush()

    await advance(5000)
    const view = result.current.view
    expect(view.kind === 'ready' && view.status).toBe('EXPIRED')
    expect(view.kind === 'ready' && view.remainingMs).toBe(0)
  })

  it('서버가 끝까지 WAITING이라고 해도 만료 뒤 잠시 지나면 묻기를 멈춘다', async () => {
    createMock.mockResolvedValue(link('lk-1', 3000))
    getMock.mockResolvedValue(state('WAITING'))
    renderHook(() => useCaptureLink())
    await flush()

    await advance(30_000)
    const calls = getMock.mock.calls.length
    await advance(30_000)
    expect(getMock.mock.calls.length).toBe(calls)
  })

  it('링크가 없다(404·QR_001)는 응답은 만료로 다룬다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockRejectedValue(
      new ApiError(410, { code: 'QR_001', message: '만료됐어요', details: [] }),
    )
    const { result } = renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS)
    expect(result.current.view.kind === 'ready' && result.current.view.status).toBe('EXPIRED')
    await advance(POLL_INTERVAL_MS * 2)
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('일시적 실패면 한 주기 뒤 다시 묻는다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockRejectedValueOnce(new Error('network')).mockResolvedValue(state('WAITING'))
    renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS * 2)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('탭이 숨겨지면 묻지 않고, 다시 보이면 바로 묻는다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValue(state('WAITING'))
    renderHook(() => useCaptureLink())
    await flush()

    act(() => setHidden(true))
    await advance(POLL_INTERVAL_MS * 5)
    expect(getMock).not.toHaveBeenCalled()

    act(() => setHidden(false))
    await flush()
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('언마운트하면 폴링을 멈춘다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValue(state('WAITING'))
    const { unmount } = renderHook(() => useCaptureLink())
    await flush()
    unmount()
    await advance(POLL_INTERVAL_MS * 3)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('발급 실패는 failed로 알린다', async () => {
    const error = new ApiError(409, { code: 'REC_002', message: '진행 중', details: [] })
    createMock.mockRejectedValue(error)
    const { result } = renderHook(() => useCaptureLink())
    await flush()
    expect(result.current.view).toEqual({ kind: 'failed', error })
  })

  it('새로 만들면 살아 있는 링크를 끊고 다시 발급한다', async () => {
    createMock.mockResolvedValueOnce(link('lk-1')).mockResolvedValueOnce(link('lk-2'))
    getMock.mockResolvedValue(state('WAITING'))
    const { result } = renderHook(() => useCaptureLink())
    await flush()

    act(() => result.current.regenerate())
    expect(deleteMock).toHaveBeenCalledWith('lk-1')
    expect(result.current.view.kind).toBe('issuing')
    await flush()
    const view = result.current.view
    expect(view.kind === 'ready' && view.link.linkId).toBe('lk-2')
  })

  it('만료된 링크를 새로 만들 때는 끊지 않는다', async () => {
    createMock.mockResolvedValueOnce(link('lk-1', 1000)).mockResolvedValueOnce(link('lk-2'))
    getMock.mockRejectedValue(new ApiError(404, { code: 'COMMON_002', message: '', details: [] }))
    const { result } = renderHook(() => useCaptureLink({ intervalMs: 500 }))
    await flush()
    await advance(500)
    act(() => result.current.regenerate())
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('연결 끊기는 QR-04를 부르고 CANCELED가 된다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValue(state('CONNECTED'))
    const { result } = renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS)

    await act(() => result.current.disconnect())
    expect(deleteMock).toHaveBeenCalledWith('lk-1')
    expect(result.current.view.kind === 'ready' && result.current.view.status).toBe('CANCELED')
  })

  it('release는 WAITING인 링크만 끊는다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValue(state('CONNECTED'))
    const { result } = renderHook(() => useCaptureLink())
    await flush()

    act(() => result.current.release())
    expect(deleteMock).toHaveBeenCalledTimes(1)

    await advance(POLL_INTERVAL_MS)
    act(() => result.current.release())
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })
})

// 합성 값이다
const GONE = new ApiError(410, { code: 'QR_001', message: '만료됐어요', details: [] })

describe('useCaptureLink — 업로드 완료 감지 경계 (S15P31B204-191)', () => {
  function statusOf(view: ReturnType<typeof useCaptureLink>['view']) {
    return view.kind === 'ready' ? view.status : null
  }

  it('UPLOADED인데 jobId가 아직 없으면 멈추지 않고 jobId가 올 때까지 묻는다', async () => {
    createMock.mockResolvedValue(link())
    getMock
      .mockResolvedValueOnce(state('CONNECTED'))
      .mockResolvedValueOnce(state('UPLOADED', null))
      .mockResolvedValueOnce(state('UPLOADED', 'job-9'))
    const onUploaded = vi.fn()
    renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS * 2)
    expect(onUploaded).not.toHaveBeenCalled()

    await advance(POLL_INTERVAL_MS)
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith('job-9')

    await advance(POLL_INTERVAL_MS * 3)
    expect(getMock).toHaveBeenCalledTimes(3)
  })

  it('연결된 뒤에는 QR 3분이 지나도 계속 묻고, 업로드되면 넘어간다', async () => {
    createMock.mockResolvedValue(link('lk-1', 6000))
    getMock.mockResolvedValueOnce(state('CONNECTED'))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useCaptureLink({ onUploaded }))
    await flush()
    await advance(POLL_INTERVAL_MS)
    expect(statusOf(result.current.view)).toBe('CONNECTED')

    // 촬영·업로드에 몇 분이 걸린다
    getMock.mockResolvedValue(state('CONNECTED'))
    await advance(60_000)
    expect(statusOf(result.current.view)).toBe('CONNECTED')

    getMock.mockResolvedValue(state('UPLOADED', 'job-9'))
    await advance(POLL_INTERVAL_MS)
    expect(onUploaded).toHaveBeenCalledWith('job-9')
  })

  it('연결된 뒤 링크가 사라지면 진행 중 작업(REC-03)을 확인해 그 작업으로 넘어간다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED')).mockRejectedValueOnce(GONE)
    currentJobMock.mockResolvedValue(fakeJob({ jobId: 'job-7', status: 'QUEUED' }))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS * 2)
    expect(currentJobMock).toHaveBeenCalledTimes(1)
    expect(onUploaded).toHaveBeenCalledWith('job-7')
    const view = result.current.view
    expect(view.kind === 'ready' && view.jobId).toBe('job-7')
    expect(statusOf(view)).toBe('UPLOADED')

    await advance(POLL_INTERVAL_MS * 3)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('연결된 뒤 서버가 EXPIRED라고 해도 진행 중 작업이 있으면 그 작업으로 넘어간다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED')).mockResolvedValueOnce(state('EXPIRED'))
    currentJobMock.mockResolvedValue(fakeJob({ jobId: 'job-7', status: 'RUNNING' }))
    const onUploaded = vi.fn()
    renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS * 2)
    expect(onUploaded).toHaveBeenCalledWith('job-7')
  })

  it('연결된 뒤 링크가 사라졌는데 진행 중 작업이 없으면 만료로 보여 준다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED')).mockRejectedValueOnce(GONE)
    currentJobMock.mockResolvedValue(fakeJob({ status: 'FAILED' }))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS * 2)
    expect(onUploaded).not.toHaveBeenCalled()
    expect(statusOf(result.current.view)).toBe('EXPIRED')
  })

  it('REC-03 확인이 실패해도 만료로 보여 주고 멈춘다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED')).mockRejectedValueOnce(GONE)
    currentJobMock.mockRejectedValue(new Error('network'))
    const onUploaded = vi.fn()
    const { result } = renderHook(() => useCaptureLink({ onUploaded }))
    await flush()

    await advance(POLL_INTERVAL_MS * 2)
    expect(onUploaded).not.toHaveBeenCalled()
    expect(statusOf(result.current.view)).toBe('EXPIRED')
  })

  it('연결된 적 없이 링크가 사라지면 REC-03을 부르지 않는다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockRejectedValueOnce(GONE)
    renderHook(() => useCaptureLink())
    await flush()

    await advance(POLL_INTERVAL_MS)
    expect(currentJobMock).not.toHaveBeenCalled()
  })

  it('탭을 숨긴 사이 업로드가 끝나도 다시 보이는 즉시 넘어간다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED'))
    const onUploaded = vi.fn()
    renderHook(() => useCaptureLink({ onUploaded }))
    await flush()
    await advance(POLL_INTERVAL_MS)

    act(() => setHidden(true))
    getMock.mockResolvedValue(state('UPLOADED', 'job-9'))
    await advance(POLL_INTERVAL_MS * 10)
    expect(onUploaded).not.toHaveBeenCalled()

    act(() => setHidden(false))
    await flush()
    expect(onUploaded).toHaveBeenCalledWith('job-9')
  })
})

describe('useCaptureLink — 진행 팝업 연결 (S15P31B204-196 스토어)', () => {
  it('UPLOADED·jobId를 받으면 REC-02로 작업을 받아 진행 팝업에 알린다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('UPLOADED', 'job-9'))
    renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS)

    expect(jobMock).toHaveBeenCalledWith('job-9')
    expect(useReconstructionStore.getState().job?.jobId).toBe('job-9')
  })

  it('REC-03으로 찾은 작업은 다시 묻지 않고 그대로 알린다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('CONNECTED')).mockRejectedValueOnce(GONE)
    currentJobMock.mockResolvedValue(fakeJob({ jobId: 'job-7', status: 'RUNNING' }))
    renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS * 2)

    expect(jobMock).not.toHaveBeenCalled()
    expect(useReconstructionStore.getState().job?.jobId).toBe('job-7')
  })

  it('REC-02가 실패해도 화면은 넘어간다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('UPLOADED', 'job-9'))
    jobMock.mockRejectedValue(new Error('network'))
    const onUploaded = vi.fn()
    renderHook(() => useCaptureLink({ onUploaded }))
    await flush()
    await advance(POLL_INTERVAL_MS)

    expect(onUploaded).toHaveBeenCalledWith('job-9')
    expect(useReconstructionStore.getState().job).toBeNull()
  })

  it('이미 끝난 작업(FAILED)은 진행 팝업에 올리지 않는다', async () => {
    createMock.mockResolvedValue(link())
    getMock.mockResolvedValueOnce(state('UPLOADED', 'job-9'))
    jobMock.mockResolvedValue(fakeJob({ jobId: 'job-9', status: 'FAILED' }))
    renderHook(() => useCaptureLink())
    await flush()
    await advance(POLL_INTERVAL_MS)

    expect(useReconstructionStore.getState().job).toBeNull()
  })
})
