import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import type { Me } from '@/features/auth/types'
import { requestFaceReading } from '@/features/face-reading/api'
import { ApiError } from '@/shared/api/ApiError'
import { __resetToaster } from '@/shared/ui/Toast'
import { getReconstruction } from '../api'
import { isFailureSeen } from '../seenFailures'
import { useReconstructionStore } from '../store'
import { fakeJob } from '../testing'
import {
  isPhotoReady,
  MM_SIGNUP,
  READING_WAIT_HINT,
  ReconstructionWaiting,
} from './ReconstructionWaiting'

// Mattermost 등록 칸(-476)이 부르는 API. 칸 자체는 features/account에서 따로 확인한다
const accountApi = vi.hoisted(() => ({
  mattermostRequestCode: vi.fn(),
  mattermostConfirm: vi.fn(),
  mattermostUnlink: vi.fn(),
}))
vi.mock('@/features/account/api', () => ({ accountApi }))

// MM 노출 기준(운영 주소면 숨김)은 mattermostAvailability.test.ts에서 따로 확인한다. 여기서는 켜고 끄기만 한다
const mmAvailable = vi.hoisted(() => ({ value: true }))
vi.mock('@/features/account/mattermostAvailability', () => ({
  useMattermostNotifyAvailable: () => mmAvailable.value,
}))

vi.mock('../api', () => ({
  getReconstruction: vi.fn(),
  getCurrentReconstruction: vi.fn(),
}))

// 헤더 알림 점 재조회. 실제로는 API-NOTI-01을 부른다
const unread = vi.hoisted(() => ({ refreshUnread: vi.fn(async () => {}) }))
vi.mock('@/features/notifications/unread', () => unread)

// 단계에 맞춰 바뀌는 머리 무대(WebGL)는 jsdom에서 그릴 수 없어 자리만 둔다
vi.mock('./BuildStageLoader', () => ({ BuildStage: () => <div data-testid="build-stage" /> }))

// AI 관상 카드(-440)는 features/face-reading에서 따로 확인한다. 여기서는 아직 요청한 적 없는 상태로 둔다
vi.mock('@/features/face-reading/api', () => ({
  requestFaceReading: vi.fn(),
  getFaceReadingByJob: vi.fn(async () => {
    throw new Error('not found')
  }),
  getFaceReading: vi.fn(),
  getFaceReadingPhoto: vi.fn(async () => {
    throw new Error('no photo')
  }),
}))

const fetchJob = vi.mocked(getReconstruction)

/**
 * 받은 작업(기본 fakeJob: 2단계 '입력 품질 확인' 진행 중)이 화면에 반영될 때까지 기다린다(S15P31B204-636).
 * 단계 이름은 작업을 받기 전 첫 화면(모든 단계 '대기')에도 있어서, 이름만 기다리면 느린 CI에서 받기 전 화면을 검사한다.
 */
async function waitForJobShown() {
  const steps = await screen.findByRole('list', { name: '진행 단계' })
  await waitFor(() =>
    expect(within(steps).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step'),
  )
  return steps
}

// 3D가 완성되면 설문 팝업(<dialog>)이 뜬다. jsdom에는 showModal·close가 없다(shared/ui/Modal.test.tsx와 같은 흉내)
beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  fetchJob.mockReset()
  useReconstructionStore.setState({ job: null })
  // 처음 쓰는 기기로 둔다(체험·튜토리얼은 메인에만 있어 여기서는 뜨지 않아야 한다)
  localStorage.clear()
})

afterEach(() => {
  act(() => __resetToaster())
  vi.useRealTimers()
  // 기록을 지우면 구독 중인 컴포넌트가 다시 그려진다. 먼저 내린다
  cleanup()
  useAuthStore.setState({ me: null })
  localStorage.clear()
  mmAvailable.value = true
})

describe('ReconstructionWaiting', () => {
  it('현재 단계를 4단계 목록과 진행 카드에 보여 준다(%는 쓰지 않는다)', async () => {
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)

    const steps = await waitForJobShown()
    expect(screen.getAllByText('입력 품질 확인')).not.toHaveLength(0)
    const items = within(steps).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('완료')
    expect(items[1]).toHaveTextContent('진행 중')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    // 아직 오지 않은 단계는 글 없이 흐리게만 둔다
    expect(items[2]).toHaveTextContent(/^3D 얼굴 만들기$/)
    expect(items[2]).toHaveAttribute('data-state', 'upcoming')
    expect(screen.queryByText(/단계마다 대기열이 따로 있어요/)).not.toBeInTheDocument()
    // 진행 표시는 단계로만(슬라이더의 %는 체험 조절값이라 별개다)
    for (const region of screen.getAllByRole('region', { name: '3D 생성 진행' })) {
      expect(region).not.toHaveTextContent('%')
    }
  })

  it('진행 중이면 경과 시간 뒤에 "3분에서 5분 정도 걸려요"를 붙인다(-884)', async () => {
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)
    await waitForJobShown()
    // 경과 시간 줄은 시계가 돈 뒤에 그려진다
    expect(await screen.findAllByText(/지났어요 · 3분에서 5분 정도 걸려요$/)).not.toHaveLength(0)
    expect(screen.queryByText(/십여 분/)).not.toBeInTheDocument()
  })

  it.each([
    ['waiting을 주는 BE', { waiting: true }],
    ['waiting이 없는 이전 BE', {}],
  ])(
    '접수 직후(%s)면 1단계를 순서 대기로 강조하고 앞에 기다리는 수를 보여 준다',
    async (_, extra) => {
      fetchJob.mockResolvedValue(
        fakeJob({
          status: 'QUEUED',
          stage: null,
          stageIndex: null,
          queuePosition: 3,
          startedAt: null,
          ...extra,
        }),
      )
      render(<ReconstructionWaiting jobId="job-test-1" />)
      expect(await screen.findByText('프레임 고르기 · 앞에 2명')).toBeInTheDocument()
      expect(screen.getByText('1/4 단계')).toBeInTheDocument()
      expect(
        screen.getByText('단계마다 대기열이 따로 있어요. 앞 작업이 끝나면 차례대로 넘어가요.'),
      ).toBeInTheDocument()
      const items = within(screen.getByRole('list', { name: '진행 단계' })).getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('순서를 기다리는 중 · 앞에 2명')
      expect(items[0]).toHaveAttribute('aria-current', 'step')
      expect(items[0]).toHaveAttribute('data-state', 'queued')
      for (const item of items.slice(1)) {
        expect(item).toHaveAttribute('data-state', 'upcoming')
        expect(item).not.toHaveTextContent('대기')
      }
      expect(screen.queryByText(/3분에서 5분 정도 걸려요/)).not.toBeInTheDocument()
    },
  )

  it('순번이 1이면 "앞에 0명" 대신 "다음 차례"로 보여 준다(-794)', async () => {
    fetchJob.mockResolvedValue(
      fakeJob({
        status: 'QUEUED',
        stage: null,
        stageIndex: null,
        queuePosition: 1,
        waiting: true,
        startedAt: null,
      }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(await screen.findByText('프레임 고르기 · 다음 차례')).toBeInTheDocument()
    expect(screen.getByText('다음 차례')).toBeInTheDocument()
    expect(screen.queryByText(/앞에 0명/)).not.toBeInTheDocument()
  })

  it('추출 lease가 끝나 다시 기다리면(waiting, FRAME_SELECT) 1단계를 순서 대기로 보여 준다', async () => {
    fetchJob.mockResolvedValue(
      fakeJob({
        status: 'QUEUED',
        stage: 'FRAME_SELECT',
        stageIndex: 1,
        queuePosition: 2,
        waiting: true,
        startedAt: null,
      }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(await screen.findByText('프레임 고르기 · 앞에 1명')).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: '진행 단계' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('순서를 기다리는 중 · 앞에 1명')
    expect(items[0]).not.toHaveTextContent('진행 중')
  })

  it('QUEUED에서 프레임을 고르는 중이면 1단계를 진행 중으로 보여 준다', async () => {
    fetchJob.mockResolvedValue(
      fakeJob({
        status: 'QUEUED',
        stage: 'FRAME_SELECT',
        stageIndex: 1,
        queuePosition: null,
        waiting: false,
      }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(await screen.findAllByText('1/4 단계')).not.toHaveLength(0)
    expect(screen.getAllByText('프레임 고르기')).not.toHaveLength(0)
    const items = within(screen.getByRole('list', { name: '진행 단계' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('진행 중')
    expect(items[0]).toHaveAttribute('aria-current', 'step')
    expect(items[1]).toHaveAttribute('data-state', 'upcoming')
    expect(screen.queryByText(/단계마다 대기열이 따로 있어요/)).not.toBeInTheDocument()
  })

  it('추출이 끝나 GPU 순서를 기다리면 2단계를 순서 대기로 보여 주고 걸리는 시간은 말하지 않는다', async () => {
    fetchJob.mockResolvedValue(
      fakeJob({
        status: 'QUEUED',
        stage: 'QUALITY_CHECK',
        stageIndex: 2,
        queuePosition: 3,
        waiting: true,
      }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(await screen.findByText('입력 품질 확인 · 앞에 2명')).toBeInTheDocument()
    expect(screen.getByText('2/4 단계')).toBeInTheDocument()
    for (const bar of screen.getAllByRole('progressbar', { name: '3D 생성 단계' })) {
      expect(bar).toHaveAttribute('aria-valuenow', '2')
    }

    const items = within(screen.getByRole('list', { name: '진행 단계' })).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('완료')
    expect(items[1]).toHaveTextContent('순서를 기다리는 중 · 앞에 2명')
    expect(items[1]).not.toHaveTextContent('진행 중')
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[2]).toHaveAttribute('data-state', 'upcoming')

    // 경과 시간 줄은 시계가 돈 뒤에 그려진다
    expect(await screen.findAllByText(/지났어요 · 순서가 되면 바로 시작해요$/)).not.toHaveLength(0)
    expect(screen.queryByText(/3분에서 5분 정도 걸려요/)).not.toBeInTheDocument()
  })

  it('받은 진행 상태를 하단 팝업 스토어에 넣는다(팝업이 이어받는다)', async () => {
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)
    await screen.findAllByText('입력 품질 확인')
    // 스토어에 넣는 것은 화면을 그린 뒤 effect에서 한다. 느린 CI에서 한 박자 늦을 수 있어 기다린다
    await waitFor(() => expect(useReconstructionStore.getState().job?.jobId).toBe('job-test-1'))
  })

  it('3초 간격으로 다시 묻고, 끝나면 멈추고 스토어를 비운다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchJob.mockResolvedValueOnce(fakeJob())
    fetchJob.mockResolvedValue(
      fakeJob({ status: 'SUCCEEDED', stage: 'FINALIZE', stageIndex: 4, faceModelId: 'fm-1' }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    await screen.findAllByText('입력 품질 확인')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(await screen.findByText('원본 3D가 생성됐어요')).toBeInTheDocument()
    // 완성된 모델을 고른 채 작업실 모델 탭을 연다(-806)
    expect(screen.getByRole('link', { name: /작업실에서 보기/ })).toHaveAttribute(
      'href',
      '/studio?faceModelId=fm-1',
    )
    expect(useReconstructionStore.getState().job).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchJob).toHaveBeenCalledTimes(2)
    // 이 화면이 결과를 보여 주므로 토스트는 띄우지 않는다
    expect(screen.queryByRole('button', { name: '결과 보기' })).not.toBeInTheDocument()
  })

  it('완성됐는데 모델 id가 없으면 작업실에서 보기는 작업실 첫 화면으로 간다(-806)', async () => {
    fetchJob.mockResolvedValue(fakeJob({ status: 'SUCCEEDED', stage: 'FINALIZE', stageIndex: 4 }))
    render(<ReconstructionWaiting jobId="job-test-1" />)
    await screen.findByText('원본 3D가 생성됐어요')
    expect(screen.getByRole('link', { name: /작업실에서 보기/ })).toHaveAttribute('href', '/studio')
  })

  it('끝난 것을 알게 되면 헤더 알림 점을 바로 다시 묻는다(한 번만)', async () => {
    unread.refreshUnread.mockClear()
    fetchJob.mockResolvedValue(fakeJob({ status: 'SUCCEEDED', stage: 'FINALIZE', stageIndex: 4 }))
    const { rerender } = render(<ReconstructionWaiting jobId="job-test-1" />)
    await screen.findByText('원본 3D가 생성됐어요')
    rerender(<ReconstructionWaiting jobId="job-test-1" />)
    expect(unread.refreshUnread).toHaveBeenCalledTimes(1)
    expect(unread.refreshUnread).toHaveBeenCalledWith({ force: true })
  })

  it('실패하면 SCR-09 모양으로 코드마다 이유와 고치는 방법을 모두 보여 주고 재촬영으로 보낸다', async () => {
    fetchJob.mockResolvedValue(
      fakeJob({ status: 'FAILED', failCodes: ['QUALITY_ANGLE', 'QUALITY_LIGHT'] }),
    )
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(await screen.findByRole('heading', { name: '3D를 만들지 못했어요' })).toBeInTheDocument()

    const reasons = within(screen.getByRole('list', { name: '실패 이유' })).getAllByRole('listitem')
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toHaveTextContent('옆모습이 충분히 담기지 않았어요')
    expect(reasons[0]).toHaveTextContent('휴대폰을 얼굴 옆쪽까지 조금 더 옮겨 주세요.')
    expect(reasons[1]).toHaveTextContent('너무 밝거나 어두워요')
    expect(reasons[1]).toHaveTextContent('창문을 등지지 말고 얼굴 앞쪽이 밝은 곳에서 찍어 주세요.')
    expect(screen.getByText('실패한 영상은 24시간 뒤 자동으로 삭제돼요.')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /다시 촬영하기/ })).toHaveAttribute(
      'href',
      '/studio/new',
    )
    expect(screen.getByRole('link', { name: /내 작업실로/ })).toHaveAttribute('href', '/studio')
    // 대기 화면 요소(기본 모델 체험)는 사라진다
    expect(screen.queryByTestId('build-stage')).not.toBeInTheDocument()
    // 이 안내를 봤으니 작업실의 "생성하지 못한 모델" 칸은 다시 뜨지 않는다.
    // 확인 기록은 그린 뒤 effect에서 남아서, 느린 CI에서는 제목이 보인 직후 아직 없을 수 있다(-542)
    await waitFor(() => expect(isFailureSeen('job-test-1')).toBe(true))
  })

  it('모르는 실패 코드는 일반 문구로 보여 준다', async () => {
    fetchJob.mockResolvedValue(fakeJob({ status: 'FAILED', failCodes: ['SOMETHING_NEW' as never] }))
    render(<ReconstructionWaiting jobId="job-test-1" />)
    const list = await screen.findByRole('list', { name: '실패 이유' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(list).toHaveTextContent('다시 찍어 주세요')
  })

  it('취소된 작업은 사유 카드 없이 취소 안내만 보여 준다', async () => {
    fetchJob.mockResolvedValue(fakeJob({ status: 'CANCELED' }))
    render(<ReconstructionWaiting jobId="job-test-1" />)
    expect(
      await screen.findByRole('heading', { name: '3D 만들기가 취소됐어요' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '실패 이유' })).not.toBeInTheDocument()
  })

  it('없는 작업(타인 작업 포함 404)이면 "없음"으로 보여 주고 더 묻지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fetchJob.mockRejectedValue(
      new ApiError(404, { code: 'COMMON_002', message: '없음', details: [] }),
    )
    render(<ReconstructionWaiting jobId="job-x" />)
    expect(await screen.findByText('작업을 찾을 수 없어요')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('무대는 단계에 맞춰 바뀌는 예시 머리 하나이고, 기본 모델 체험·튜토리얼은 없다', async () => {
    localStorage.clear()
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)
    await screen.findAllByText('입력 품질 확인')
    expect(screen.getByTestId('build-stage')).toBeInTheDocument()
    expect(screen.getByText(/진행 단계를 보여 주는 예시 인물이에요/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '기본 모델 체험' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})

describe('Mattermost 완료 알림 안내 (S15P31B204-476)', () => {
  const me = (mattermostUsername: string | null): Me => ({
    id: 'u-1',
    nickname: null,
    maskedEmail: null,
    providers: ['KAKAO'],
    createdAt: '2026-10-19T03:00:00Z',
    reconsentRequired: [],
    dataSummary: { faceModelCount: 0, simulationCount: 0 },
    mattermostUsername,
  })

  it('등록하지 않았으면 이 자리에서 아이디를 넣어 바로 등록한다(-524)', async () => {
    const user = userEvent.setup()
    accountApi.mattermostRequestCode.mockResolvedValue({
      username: 'hong',
      expiresAt: '2099-01-01T00:10:00Z',
      resendAvailableAt: '2000-01-01T00:00:00Z',
    })
    accountApi.mattermostConfirm.mockResolvedValue({
      username: 'hong',
      linkedAt: '2026-11-02T05:00:00Z',
    })
    useAuthStore.setState({ me: me(null) })
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)

    // 내 정보로 보내는 링크가 아니라 펼치는 버튼이다
    const toggle = await screen.findByRole('button', { name: MM_SIGNUP })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Mattermost 아이디')).toBeNull()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // 내 정보와 같은 등록 칸(아이디 → 고지 동의 → 확인 코드)을 쓴다
    await user.type(screen.getByLabelText('Mattermost 아이디'), 'hong')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '확인 코드 받기' }))
    expect(accountApi.mattermostRequestCode).toHaveBeenCalledWith('hong')
    await user.type(await screen.findByLabelText('@hong에게 보낸 6자리 코드'), '123456')
    await user.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(useAuthStore.getState().me?.mattermostUsername).toBe('hong'))
    // 등록하면 안내 줄이 사라진다
    expect(screen.queryByRole('button', { name: MM_SIGNUP })).toBeNull()
  })

  it('이미 등록했으면 안내하지 않는다', async () => {
    useAuthStore.setState({ me: me('hong') })
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)

    await waitForJobShown()
    expect(screen.queryByRole('button', { name: MM_SIGNUP })).toBeNull()
  })

  it('내 정보를 못 받았으면(비회원·업로드 전용 세션) 안내하지 않는다', async () => {
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)

    await waitForJobShown()
    expect(screen.queryByRole('button', { name: MM_SIGNUP })).toBeNull()
  })

  it('운영 주소에서는(처리방침 시행 전) 안내하지 않는다', async () => {
    mmAvailable.value = false
    useAuthStore.setState({ me: me(null) })
    fetchJob.mockResolvedValue(fakeJob())
    render(<ReconstructionWaiting jobId="job-test-1" />)

    await waitForJobShown()
    expect(screen.queryByRole('button', { name: MM_SIGNUP })).toBeNull()
    expect(screen.queryByText(/Mattermost/)).toBeNull()
  })
})

describe('AI 관상 버튼 (S15P31B204-523)', () => {
  it('"내 작업실로" 옆에 있고, 누르면 팝업에 진행을 보여 주고 닫았다가 다시 열 수 있다', async () => {
    vi.mocked(requestFaceReading).mockResolvedValue({
      readingId: 'reading-1',
      jobId: 'job-test-1',
      status: 'PENDING',
      result: null,
      createdAt: '2026-11-02T00:00:00Z',
    })
    fetchJob.mockResolvedValue(fakeJob())
    const user = userEvent.setup()
    render(<ReconstructionWaiting jobId="job-test-1" />)

    const button = await screen.findByRole('button', { name: 'AI 관상 보기' })
    const studio = screen.getByRole('link', { name: '내 작업실로' })
    expect(button.parentElement).toBe(studio.parentElement)
    const dialog = document.querySelector('dialog.pf-reading-modal') as HTMLDialogElement
    expect(dialog).not.toHaveAttribute('open')

    await user.click(button)
    expect(dialog).toHaveAttribute('open')
    expect(await within(dialog).findByRole('status')).toHaveTextContent('관상을 보는 중이에요')

    await user.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(dialog).not.toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: 'AI 관상 보는 중' }))
    expect(dialog).toHaveAttribute('open')
  })

  it('프레임 추출 전에는 "준비 중"으로 막고, 왜 못 누르는지 터치 기기는 아래 한 줄, PC는 말풍선으로 알린다(-793)', async () => {
    const user = userEvent.setup()
    fetchJob.mockResolvedValue(fakeJob({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1 }))
    render(<ReconstructionWaiting jobId="job-test-1" />)

    const button = await screen.findByRole('button', { name: 'AI 관상 준비 중' })
    expect(button).toBeDisabled()
    // 안내 한 줄과 버튼이 이어져 있다
    const hint = screen.getByText(READING_WAIT_HINT)
    expect(button).toHaveAttribute('aria-describedby', hint.id)
    // 한 줄은 터치 기기에만 보이고, PC(마우스)는 말풍선만 본다
    expect(hint).toHaveClass('hidden', 'pointer-coarse:block')

    // PC: 마우스를 올리면 같은 문구 말풍선
    await user.hover(button.parentElement as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent(READING_WAIT_HINT)
  })

  it('사진이 준비되는 2단계부터는 안내 한 줄 없이 누를 수 있다(-793)', async () => {
    fetchJob.mockResolvedValue(fakeJob({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2 }))
    render(<ReconstructionWaiting jobId="job-test-1" />)

    expect(await screen.findByRole('button', { name: 'AI 관상 보기' })).toBeEnabled()
    expect(screen.queryByText(READING_WAIT_HINT)).not.toBeInTheDocument()
  })
})

describe('isPhotoReady', () => {
  it('프레임 추출이 끝나야(QUALITY_CHECK 이후) 관상 사진이 있다', () => {
    expect(isPhotoReady(fakeJob({ status: 'QUEUED', stage: null, stageIndex: null }))).toBe(false)
    expect(isPhotoReady(fakeJob({ status: 'QUEUED', stage: 'FRAME_SELECT', stageIndex: 1 }))).toBe(
      false,
    )
    expect(isPhotoReady(fakeJob({ status: 'QUEUED', stage: 'QUALITY_CHECK', stageIndex: 2 }))).toBe(
      true,
    )
    expect(isPhotoReady(fakeJob({ status: 'RUNNING' }))).toBe(true)
  })
})
