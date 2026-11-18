import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import { showBrowserNotification } from '@/features/notifications/browser'
import {
  FakeNotification,
  installFakeNotification,
  setVisibility,
} from '@/features/notifications/testing'
import { refreshUnread } from '@/features/notifications/unread'
import { __resetToaster, toast } from '@/shared/ui/Toast'
import { getCurrentReconstruction, getReconstruction } from './api'
import { announceFinished, ProgressDock } from './ProgressDock'
import { ProgressDockCard } from './ProgressDockCard'
import { isFailureSeen, markFailureSeen, resetSeenFailures } from './seenFailures'
import { useReconstructionStore } from './store'
import { fakeJob } from './testing'

const nav = vi.hoisted(() => ({ pathname: '/studio', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}))

vi.mock('./api', () => ({
  getCurrentReconstruction: vi.fn(),
  getReconstruction: vi.fn(),
}))

// 브라우저 알림 helper는 그대로 돌리되 불렸는지 본다
vi.mock('@/features/notifications/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notifications/browser')>()
  return { ...actual, showBrowserNotification: vi.fn(actual.showBrowserNotification) }
})

// 헤더 알림 점 재조회. 실제로는 API-NOTI-01을 부른다
vi.mock('@/features/notifications/unread', () => ({ refreshUnread: vi.fn(async () => {}) }))

// 성공 토스트를 다시 띄우지 않는지 본다(완성 카드로 바꿨다, -909)
vi.mock('@/shared/ui/Toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/Toast')>()
  return { ...actual, toast: vi.fn(actual.toast) }
})

const SUCCEEDED = {
  status: 'SUCCEEDED',
  stageIndex: 4,
  stage: 'FINALIZE',
  faceModelId: 'fm-1',
} as const

const fetchCurrent = vi.mocked(getCurrentReconstruction)
const fetchJob = vi.mocked(getReconstruction)

beforeEach(() => {
  nav.pathname = '/studio'
  nav.push.mockReset()
  fetchCurrent.mockReset()
  fetchJob.mockReset()
  useReconstructionStore.setState({ job: null, failed: null, succeeded: null })
  resetSeenFailures()
  useAuthStore.setState({ status: 'member', me: null })
})

afterEach(() => {
  act(() => __resetToaster())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setVisibility('visible')
  vi.mocked(showBrowserNotification).mockClear()
  vi.mocked(refreshUnread).mockClear()
  vi.mocked(toast).mockClear()
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('ProgressDockCard', () => {
  it('단계 문구와 진행 바를 보여 주고 생성 대기 화면으로 연결한다', () => {
    render(<ProgressDockCard job={fakeJob()} />)
    expect(screen.getByText('내 모델을 만들고 있어요')).toBeInTheDocument()
    expect(screen.getByText('입력 품질 확인 · 2/4 단계')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/reconstructions/job-test-1')
    // %는 표시하지 않는다(명세서 결정)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('접수 직후(단계 없음)면 1단계 대기와 순번을 보여 준다', () => {
    render(
      <ProgressDockCard
        job={fakeJob({ status: 'QUEUED', stage: null, stageIndex: null, queuePosition: 2 })}
      />,
    )
    expect(screen.getByText('프레임 고르기 · 앞에 1명')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('추출이 끝나 GPU 순서를 기다리면 순서 대기와 순번을 보여 주고 "3분에서 5분 정도 걸려요"는 뺀다', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-25T06:32:10Z'))
    render(
      <ProgressDockCard
        job={fakeJob({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2, queuePosition: 3 })}
      />,
    )
    expect(screen.getByText('입력 품질 확인 · 앞에 2명')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByText('2분 10초 지났어요 · 순서가 되면 바로 시작해요')).toBeInTheDocument()
    expect(screen.queryByText(/3분에서 5분 정도 걸려요/)).not.toBeInTheDocument()
  })

  it('추출 lease가 끝나 다시 기다리면(waiting, FRAME_SELECT) 1단계 대기와 순번을 보여 준다', () => {
    render(
      <ProgressDockCard
        job={fakeJob({
          status: 'QUEUED',
          stage: 'FRAME_SELECT',
          stageIndex: 1,
          queuePosition: 1,
          waiting: true,
          startedAt: null,
        })}
      />,
    )
    expect(screen.getByText('프레임 고르기 · 다음 차례')).toBeInTheDocument()
  })

  it('QUEUED에서 프레임을 고르는 중이면 1단계로 보여 준다', () => {
    render(
      <ProgressDockCard
        job={fakeJob({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1 })}
      />,
    )
    expect(screen.getByText('프레임 고르기 · 1/4 단계')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('경과 시간을 센다', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-25T06:32:10Z'))
    render(<ProgressDockCard job={fakeJob()} />)
    expect(screen.getByText('2분 10초 지났어요 · 3분에서 5분 정도 걸려요')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('2분 11초 지났어요 · 3분에서 5분 정도 걸려요')).toBeInTheDocument()
  })
})

describe('ProgressDock', () => {
  it('회원이 아니면 조회하지 않고 아무것도 그리지 않는다', async () => {
    useAuthStore.setState({ status: 'anonymous' })
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await flush()
    expect(fetchCurrent).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    // 로그아웃 상태면 추적하던 작업도 비운다
    expect(useReconstructionStore.getState().job).toBeNull()
  })

  it('새로고침 뒤에도 REC-03으로 진행 중 작업을 되찾아 팝업을 띄운다', async () => {
    fetchCurrent.mockResolvedValue(fakeJob())
    render(<ProgressDock />)
    expect(await screen.findByText('입력 품질 확인 · 2/4 단계')).toBeInTheDocument()
    expect(fetchCurrent).toHaveBeenCalledTimes(1)
  })

  it('그 작업의 생성 대기 화면에서는 숨긴다', async () => {
    nav.pathname = '/reconstructions/job-test-1'
    fetchCurrent.mockResolvedValue(fakeJob())
    render(<ProgressDock />)
    await flush()
    expect(fetchCurrent).toHaveBeenCalled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('다른 작업의 생성 진행 화면에서도 카드를 숨기고, 그 작업은 계속 추적한다(-909)', async () => {
    nav.pathname = '/reconstructions/job-other'
    fetchCurrent.mockResolvedValue(fakeJob())
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await flush()
    // 그 작업의 화면이 아니라 폴링은 쉬지 않는다
    expect(fetchCurrent).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('내 모델을 만들고 있어요')).not.toBeInTheDocument()
  })

  it('끝나면 진행 카드 자리에 완성 카드를 남긴다. 토스트는 띄우지 않고, 누르면 작업실(새 모델)로 가며 내린다', async () => {
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob(SUCCEEDED))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)

    const card = await screen.findByRole('link', { name: /내 모델이 완성됐어요/ })
    expect(card).toHaveTextContent('눌러서 작업실에서 보기')
    expect(card).toHaveAttribute('href', '/studio?faceModelId=fm-1')
    expect(screen.queryByText('내 모델을 만들고 있어요')).not.toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
    expect(screen.queryByText('원본 3D가 생성됐어요')).not.toBeInTheDocument()

    await userEvent.click(card)
    expect(screen.queryByRole('link', { name: /내 모델이 완성됐어요/ })).not.toBeInTheDocument()
    expect(useReconstructionStore.getState().succeeded).toBeNull()
  })

  it('완성 카드는 닫기(✕)로 내린다', async () => {
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob(SUCCEEDED))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)

    await screen.findByRole('link', { name: /내 모델이 완성됐어요/ })
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('link', { name: /내 모델이 완성됐어요/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument()
  })

  it('모델 id가 없으면 완성 카드는 생성 대기 화면으로 간다', async () => {
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob({ ...SUCCEEDED, faceModelId: null }))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    const card = await screen.findByRole('link', { name: /내 모델이 완성됐어요/ })
    expect(card).toHaveAttribute('href', '/reconstructions/job-test-1')
  })

  it('생성 진행 화면에서는 완성 카드를 숨겼다가 떠나면 보인다', async () => {
    nav.pathname = '/reconstructions/job-other'
    fetchCurrent.mockResolvedValue(null)
    useReconstructionStore.setState({ succeeded: fakeJob(SUCCEEDED) })
    const { rerender } = render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    nav.pathname = '/studio'
    rerender(<ProgressDock />)
    expect(screen.getByRole('link', { name: /내 모델이 완성됐어요/ })).toBeInTheDocument()
  })

  it('결과 화면에서 끝을 알게 되면 완성 카드도 토스트도 띄우지 않는다', () => {
    announceFinished(fakeJob(SUCCEEDED), { isOnResultPage: true, open: () => undefined })
    expect(useReconstructionStore.getState().succeeded).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })

  it('새 작업을 추적하면 완성 카드를 비우고, 로그아웃하면 비운다', async () => {
    fetchCurrent.mockResolvedValue(null)
    useReconstructionStore.setState({ succeeded: fakeJob(SUCCEEDED) })
    const { rerender } = render(<ProgressDock />)
    expect(screen.getByRole('link', { name: /내 모델이 완성됐어요/ })).toBeInTheDocument()
    act(() => useReconstructionStore.getState().track(fakeJob({ jobId: 'job-test-2' })))
    expect(useReconstructionStore.getState().succeeded).toBeNull()
    expect(screen.getByText('내 모델을 만들고 있어요')).toBeInTheDocument()

    act(() => {
      useReconstructionStore.setState({ job: null, succeeded: fakeJob(SUCCEEDED) })
      useAuthStore.setState({ status: 'anonymous' })
    })
    rerender(<ProgressDock />)
    await flush()
    expect(useReconstructionStore.getState().succeeded).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('실패하면 토스트 대신 진행 팝업 자리에 실패 카드를 남긴다. 누르면 실패 안내로 간다', async () => {
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['QUALITY_NO_FACE'] }))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)

    const card = await screen.findByRole('link', { name: /3D 생성에 실패했어요/ })
    expect(card).toHaveAttribute('href', '/reconstructions/job-test-1')
    expect(card).toHaveTextContent('영상에서 얼굴을 찾지 못했어요')
    expect(screen.queryByText('내 모델을 만들고 있어요')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이유 보기' })).not.toBeInTheDocument()
  })

  it('실패 카드는 진행 카드처럼 닫기 없이 멈춘 단계까지 찬 링 가운데 X가 그려지며, 실패 안내를 보면 내려 이 기기에서 다시 띄우지 않는다', async () => {
    const failed = fakeJob({ status: 'FAILED', failCodes: ['QUALITY_NO_FACE'] })
    fetchCurrent.mockResolvedValue(failed)
    const first = render(<ProgressDock />)
    // 새로고침 뒤에도 REC-03 최근 실패(includeRecentFailed)로 확인 전 실패를 되찾는다
    expect(await screen.findByRole('link', { name: /3D 생성에 실패했어요/ })).toBeInTheDocument()
    expect(fetchCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ includeRecentFailed: true }),
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(document.querySelector('.pf-dock-failed .pf-dock-arc')).not.toBeNull()
    // '작업 중' 점 대신 X
    expect(document.querySelector('.pf-dock-failed .pf-dock-x')).not.toBeNull()
    expect(document.querySelector('.pf-dock-failed .pf-dock-dot')).toBeNull()

    // 실패 안내(ReconstructionFailed)가 열리면 확인으로 친다
    act(() => useReconstructionStore.getState().acknowledgeFailure('job-test-1'))
    expect(screen.queryByRole('link', { name: /3D 생성에 실패했어요/ })).not.toBeInTheDocument()
    expect(isFailureSeen('job-test-1')).toBe(true)
    first.unmount()

    render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link', { name: /3D 생성에 실패했어요/ })).not.toBeInTheDocument()
  })

  it('이미 확인한 실패나 그 실패의 안내 화면에서는 실패 카드를 띄우지 않는다', async () => {
    fetchCurrent.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['QUALITY_NO_FACE'] }))
    nav.pathname = '/reconstructions/job-test-1'
    const onPage = render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    onPage.unmount()

    markFailureSeen('job-test-1')
    useReconstructionStore.setState({ failed: null })
    nav.pathname = '/studio'
    render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('새로 찍기 시작하면 지난 실패 카드 대신 진행 팝업이 뜬다', async () => {
    fetchCurrent.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['QUALITY_NO_FACE'] }))
    render(<ProgressDock />)
    await screen.findByRole('link', { name: /3D 생성에 실패했어요/ })
    act(() => {
      useReconstructionStore.getState().track(fakeJob({ jobId: 'job-test-2' }))
    })
    expect(screen.getByText('내 모델을 만들고 있어요')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /3D 생성에 실패했어요/ })).not.toBeInTheDocument()
  })

  it('그 작업의 대기 화면에서는 폴링을 쉬고(화면이 REC-02로 묻는다), 떠나면 바로 다시 묻는다', async () => {
    nav.pathname = '/reconstructions/job-test-1'
    fetchCurrent.mockResolvedValue(fakeJob())
    useReconstructionStore.setState({ job: fakeJob() })
    const { rerender } = render(<ProgressDock />)
    await flush()
    expect(fetchCurrent).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    nav.pathname = '/studio'
    rerender(<ProgressDock />)
    await flush()
    expect(fetchCurrent).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link')).toBeInTheDocument()
  })

  it('탭이 다시 보이면 바로 한 번 묻는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fetchCurrent.mockResolvedValue(fakeJob())
    render(<ProgressDock />)
    await screen.findByRole('link')
    expect(fetchCurrent).toHaveBeenCalledTimes(1)

    // 방금 물었으면(5초 안) 건너뛰므로 시간을 넘긴다
    vi.setSystemTime(Date.now() + 6_000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(fetchCurrent).toHaveBeenCalledTimes(2)
  })

  it('진행 중 작업이 없던 탭도 창에 포커스가 오면 다시 물어, 다른 탭에서 시작한 작업의 팝업을 띄운다(-790)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    fetchCurrent.mockResolvedValue(null)
    render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    // 다른 탭에서 3D 생성을 시작하고 이 탭으로 돌아왔다
    fetchCurrent.mockResolvedValue(fakeJob())
    vi.setSystemTime(Date.now() + 6_000)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(fetchCurrent).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('link')).toBeInTheDocument()
  })

  it('다른 화면이 track()으로 새 작업을 알려 주면 바로 팝업이 뜬다', async () => {
    fetchCurrent.mockResolvedValue(null)
    render(<ProgressDock />)
    await flush()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    act(() => {
      useReconstructionStore
        .getState()
        .track(fakeJob({ status: 'QUEUED', stage: null, stageIndex: null }))
    })
    expect(screen.getByText('프레임 고르기 · 순서를 기다리는 중')).toBeInTheDocument()
  })

  it('끝나면 헤더 알림 점을 바로 다시 묻는다(refreshUnread force)', async () => {
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob(SUCCEEDED))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await screen.findByText('내 모델이 완성됐어요')
    expect(refreshUnread).toHaveBeenCalledTimes(1)
    expect(refreshUnread).toHaveBeenCalledWith({ force: true })
  })

  it('브라우저 알림은 공용 helper로 띄운다. 탭이 숨겨져 있고 권한이 있을 때만 뜬다', async () => {
    installFakeNotification('granted')
    setVisibility('hidden')
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob(SUCCEEDED))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await screen.findByText('내 모델이 완성됐어요')

    expect(showBrowserNotification).toHaveBeenCalledWith(
      '원본 3D가 생성됐어요',
      expect.objectContaining({ tag: 'preface-recon', onlyWhenHidden: true }),
    )
    expect(FakeNotification.instances).toHaveLength(1)
    expect(FakeNotification.instances[0]?.options?.tag).toBe('preface-recon')

    // 알림을 누르면 작업실(새 모델)로 간다(-909)
    FakeNotification.instances[0]?.onclick?.()
    expect(nav.push).toHaveBeenCalledWith('/studio?faceModelId=fm-1')
  })

  it('권한이 없으면 브라우저 알림을 띄우지 않고 묻지도 않는다(화면 안 카드만)', async () => {
    installFakeNotification('denied')
    setVisibility('hidden')
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['QUALITY_NO_FACE'] }))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await screen.findByText('3D 생성에 실패했어요')
    expect(showBrowserNotification).toHaveBeenCalledTimes(1)
    expect(FakeNotification.instances).toHaveLength(0)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('탭이 보이면 권한이 있어도 브라우저 알림을 띄우지 않는다(완성 카드가 있다)', async () => {
    installFakeNotification('granted')
    fetchCurrent.mockResolvedValue(null)
    fetchJob.mockResolvedValue(fakeJob(SUCCEEDED))
    useReconstructionStore.setState({ job: fakeJob() })
    render(<ProgressDock />)
    await screen.findByText('내 모델이 완성됐어요')
    expect(FakeNotification.instances).toHaveLength(0)
  })
})
