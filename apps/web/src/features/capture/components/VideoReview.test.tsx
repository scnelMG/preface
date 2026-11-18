import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Base64 } from '@/features/upload/fileUtils'
import {
  FakeXhr,
  JOB_RESPONSE,
  POLICY_RESPONSE,
  fakeVideo,
  hang,
  networkDown,
  uploadUrlResponse,
} from '@/features/upload/testing'
import { ErrorCode } from '@/shared/api/errorCodes'
import { clearAccessToken, getAccessToken } from '@/shared/api/tokenStore'
import { __resetCaptureSession, useCaptureSessionStore } from '../store'
import { EXCHANGE_OK, failResponse, okResponse } from '../testing'
import {
  FAKE_CAPTURE_TRACE,
  setNextRecording,
  setNextTrace,
  stubLiveCaptureSupport,
} from '@/features/live-capture/testing'
import { CaptureSession } from './CaptureSession'

// jsdom에는 카메라·MediaPipe가 없다. 촬영 화면은 [가짜 녹화 끝]으로 녹화가 끝난 것처럼 만드는 가짜로 바꾼다
vi.mock('@/features/live-capture/LiveCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/live-capture/LiveCapture')>()
  const { FakeLiveCapture } = await import('@/features/live-capture/testing')
  return { ...actual, LiveCapture: FakeLiveCapture }
})

const video = fakeVideo({ name: 'IMG_0001.MOV', type: 'video/quicktime' })
let checksum: string

/** QR 교환 → 연결 확인 → 계속 → 촬영 가이드까지 간다 */
async function openGuide(policy: Response = okResponse(POLICY_RESPONSE)) {
  window.history.replaceState(null, '', '/m/capture#t=qr-token')
  vi.mocked(fetch).mockResolvedValueOnce(okResponse(EXCHANGE_OK)).mockResolvedValueOnce(policy)
  render(<CaptureSession />)
  await userEvent.click(await screen.findByRole('button', { name: '계속' }))
  await screen.findByRole('button', { name: '영상 촬영하기' })
}

/** 웹 촬영을 열어(확인 화면이면 다시 찍기) 녹화가 끝난 것처럼 만든다. 아이폰이면 기종 시트에서 고른다 */
async function record(file: File, iphoneModel?: string) {
  const again = screen.queryByRole('button', { name: '다시 찍기' })
  await userEvent.click(again ?? screen.getByRole('button', { name: '영상 촬영하기' }))
  if (iphoneModel) {
    await userEvent.click(screen.getByRole('radio', { name: iphoneModel }))
    await userEvent.click(screen.getByRole('button', { name: '이 기종으로 촬영하기' }))
  }
  setNextRecording(file)
  await userEvent.click(await screen.findByRole('button', { name: '가짜 녹화 끝' }))
}

/** 브라우저가 미리보기에서 길이·크기를 읽은 것처럼 만든다 */
async function readMetadata(seconds = 36, size = { width: 1080, height: 1920 }) {
  const player = await screen.findByLabelText('촬영한 영상 미리보기')
  Object.defineProperty(player, 'duration', { configurable: true, value: seconds })
  Object.defineProperty(player, 'videoWidth', { configurable: true, value: size.width })
  Object.defineProperty(player, 'videoHeight', { configurable: true, value: size.height })
  fireEvent.loadedMetadata(player)
}

/** 웹 촬영으로 영상을 받고 길이를 읽는다 */
async function pickVideo(file: File, seconds = 36, size = { width: 1080, height: 1920 }) {
  await record(file)
  await readMetadata(seconds, size)
}

function uploadBody() {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => new URL(String(url)).pathname.endsWith('/uploads'))
  return JSON.parse(String(call?.[1]?.body))
}

function apiPaths() {
  return vi
    .mocked(fetch)
    .mock.calls.map(([url]) => new URL(String(url)).pathname.replace('/api/v1', ''))
}

describe('SCR-07 영상 확인·업로드 (업로드 전용 세션)', () => {
  let restoreSupport: () => void

  beforeEach(async () => {
    restoreSupport = stubLiveCaptureSupport()
    checksum = await sha256Base64(video)
    __resetCaptureSession()
    clearAccessToken()
    FakeXhr.reset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    // jsdom에는 미디어 재생이 없다
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    restoreSupport()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('"영상 촬영하기"는 카메라 앱 대신 웹 촬영 화면을 연다(-619)', async () => {
    await openGuide()

    await userEvent.click(screen.getByRole('button', { name: '영상 촬영하기' }))

    expect(await screen.findByText('실시간 촬영 화면(테스트)')).toBeInTheDocument()
    expect(useCaptureSessionStore.getState().step).toBe('recording')
    // 카메라 앱을 여는 capture 입력은 없다
    expect(document.querySelector('input[capture]')).toBeNull()
  })

  it('촬영 화면에서 돌아가면 촬영 안내로 간다', async () => {
    await openGuide()
    await userEvent.click(screen.getByRole('button', { name: '영상 촬영하기' }))

    await userEvent.click(await screen.findByRole('button', { name: '촬영 안내로 돌아가기' }))

    expect(await screen.findByRole('button', { name: '영상 촬영하기' })).toBeInTheDocument()
  })

  it('촬영한 영상을 확인하고 올리면 업로드 완료 화면으로 간다', async () => {
    await openGuide()
    await pickVideo(video)

    expect(screen.getByRole('heading', { name: '영상을 확인해 주세요' })).toBeInTheDocument()
    expect(screen.getByText('0:36')).toBeInTheDocument()
    // 오른쪽부터 왼쪽까지 휴대폰을 옮기고, 고개를 위·아래로 움직였는지 확인하게 한다
    expect(screen.getByText('오른쪽부터 왼쪽, 위·아래까지 다 담았나요')).toBeInTheDocument()

    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
    expect(useCaptureSessionStore.getState().jobId).toBe('job-1')
    expect(apiPaths()).toEqual([
      '/capture-links/exchange',
      '/uploads/policy',
      '/uploads',
      '/reconstructions',
    ])
    // 업로드 전용 세션 토큰으로 올린다
    const uploadInit = vi.mocked(fetch).mock.calls[2][1]
    expect((uploadInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer capture-session-token',
    )
    expect(FakeXhr.instances[0].body).toBe(video)
    // 웹 녹화라고 함께 보낸다. 기종은 모르면 보내지 않는다(jsdom은 기종을 알려 주지 않는다)
    expect(uploadBody()).toMatchObject({ captureMethod: 'WEB_RECORDER' })
    expect(uploadBody()).not.toHaveProperty('deviceModel')
    // 촬영 화면이 넘긴 촬영 기록을 그대로 싣는다(-641)
    expect(uploadBody().captureTrace).toEqual(FAKE_CAPTURE_TRACE)
  })

  it('웹 녹화가 반대쪽 끝에 닿기 전에 멈췄으면 올리지 않고 다시 찍게 한다(S0-2)', async () => {
    setNextTrace({
      ...FAKE_CAPTURE_TRACE,
      meta: { ...FAKE_CAPTURE_TRACE.meta, stopReason: 'manual', stepsDone: 1, bothSides: false },
    })
    await openGuide()
    await pickVideo(video)

    expect(screen.getByRole('alert')).toHaveTextContent('반대쪽 끝까지 돌리지 못했어요')
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '다시 찍기' }))
    expect(screen.getByText('실시간 촬영 화면(테스트)')).toBeInTheDocument()
    expect(apiPaths()).toEqual(['/capture-links/exchange', '/uploads/policy'])
  })

  it('올리는 동안 진행률을 보여 주고 취소할 수 있다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
    FakeXhr.behaviors = [hang]

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))
    const bar = await screen.findByRole('progressbar', { name: '업로드 진행률' })
    // 진행률 바는 해시 계산·주소 받기 동안에도 보인다. 느린 CI에서는 그때 PUT이 아직 시작 전이라
    // 업로드 요청이 만들어질 때까지 기다린다(main 파이프라인 간헐 실패)
    await waitFor(() => expect(FakeXhr.instances[0]).toBeDefined())
    act(() => {
      FakeXhr.instances[0].upload.onprogress?.({
        lengthComputable: true,
        loaded: 42,
        total: 100,
      } as ProgressEvent)
    })

    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '42'))
    expect(screen.getByText('42%')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(await screen.findByRole('button', { name: '이 영상 올리기' })).toBeEnabled()
  })

  it('마무리(3D 작업 요청) 단계에서는 멈출 수 없어 취소 버튼을 감춘다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      // REC-01 응답을 보내지 않아 마무리 단계에 머문다
      .mockReturnValueOnce(new Promise<Response>(() => {}))

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByText('거의 다 됐어요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument()
  })

  it('정책 밖 영상은 올리기 전에 막고 이유를 알려 준다', async () => {
    await openGuide()
    await pickVideo(video, 12)

    expect(screen.getByRole('alert')).toHaveTextContent(
      '영상이 너무 짧아요. 25초 이상 찍어 주세요.',
    )
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '다시 찍기' })).toBeEnabled()
  })

  it('헤더에 길이가 없는 영상(Infinity)은 끝으로 이동해 길이를 계산한다', async () => {
    await openGuide()
    await record(video)
    const player = await screen.findByLabelText('촬영한 영상 미리보기')
    Object.defineProperty(player, 'duration', {
      configurable: true,
      value: Number.POSITIVE_INFINITY,
    })
    fireEvent.loadedMetadata(player)
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeDisabled()

    Object.defineProperty(player, 'duration', { configurable: true, value: 30 })
    fireEvent.durationChange(player)

    expect(await screen.findByText('0:30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeEnabled()
  })

  it('길이를 읽지 못하면 다시 찍으라고 한다', async () => {
    await openGuide()
    await record(video)
    fireEvent.error(await screen.findByLabelText('촬영한 영상 미리보기'))

    expect(screen.getByRole('alert')).toHaveTextContent('영상 길이를 확인하지 못했어요')
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeDisabled()
  })

  it('정책 조회가 실패하면 기본값(20~75초)으로 검사한다', async () => {
    await openGuide(failResponse(500, ErrorCode.INTERNAL_ERROR))
    await pickVideo(video, 76)

    expect(screen.getByRole('alert')).toHaveTextContent('75초 이하로')
  })

  it('다시 찍으면 새 영상으로 바뀐다', async () => {
    await openGuide()
    await pickVideo(video, 12)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await pickVideo(fakeVideo({ name: 'IMG_0002.MOV', content: 'other' }), 30)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('0:30')).toBeInTheDocument()
  })

  it('REC_002면 "한 번에 하나만" 안내를 화면 안에 보이고 다시 올리기는 없다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(409, ErrorCode.RECONSTRUCTION_IN_PROGRESS))

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('3D는 한 번에 하나만 만들 수 있어요')
    expect(screen.queryByRole('button', { name: '다시 올리기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 영상 올리기' })).not.toBeInTheDocument()
  })

  it('CAP_001이면 동의 안내', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403, ErrorCode.FACE_CONSENT_MISSING))

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('얼굴 데이터 동의가 필요해요')
  })

  it('CAP_002면 서버가 준 정책 값으로 이유를 알려 준다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch).mockResolvedValueOnce(
      failResponse(400, ErrorCode.UPLOAD_INVALID, [
        { field: 'sizeBytes', reason: 'maxSizeBytes=104857600' },
      ]),
    )

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('100MB 이하로 찍어 주세요')
  })

  it('CAP_005(체크섬 불일치)면 다시 올리기로 처음부터 올린다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(failResponse(409, ErrorCode.UPLOAD_CHECKSUM_MISMATCH))
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum, 'up-2'), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('업로드가 끝나지 않았어요')
    await userEvent.click(screen.getByRole('button', { name: '다시 올리기' }))

    expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
    expect(FakeXhr.instances).toHaveLength(2)
  })

  it('PUT 중 통신이 끊기면 다시 올리기', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum, 'up-2'), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = [networkDown]

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('인터넷 연결이 끊겼어요')
    await userEvent.click(screen.getByRole('button', { name: '다시 올리기' }))

    expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
  })

  it('AUTH_023이면 연결 종료 화면으로 가고 세션 토큰을 버린다', async () => {
    await openGuide()
    await pickVideo(video)
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(403, ErrorCode.CAPTURE_SCOPE_FORBIDDEN))

    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('heading', { name: '연결이 끝났어요' })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('영상 파일을 고르는 입력은 없다(업로드는 웹 녹화로만, -929)', async () => {
    await openGuide()

    expect(screen.queryByTestId('video-file-input')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
  })

  it('웹 녹화는 해상도로 막지 않는다', async () => {
    await openGuide()

    await pickVideo(video, 36, { width: 360, height: 480 })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 영상 올리기' })).toBeEnabled()
  })

  it('확인 화면의 다시 찍기는 웹 촬영을 연다', async () => {
    await openGuide()
    await pickVideo(video)

    await userEvent.click(screen.getByRole('button', { name: '다시 찍기' }))

    expect(await screen.findByText('실시간 촬영 화면(테스트)')).toBeInTheDocument()
  })

  it('아이폰에서 고른 기종을 업로드 요청에 싣는다', async () => {
    await openIphoneGuide()
    await record(video, 'iPhone 18')
    await readMetadata()

    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))

    expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
    // 세대 줄(-756)의 대표 이름: 18 줄은 렌즈 표에 맞게 "iPhone 18 Pro"
    expect(uploadBody()).toMatchObject({
      captureMethod: 'WEB_RECORDER',
      deviceModel: 'iPhone 18 Pro',
    })
  })
})

/** QR 교환 → 연결 확인에서 "아이폰을 쓰고 있나요?"로 아이폰으로 바꿈 → 계속 → 촬영 가이드까지 간다 */
async function openIphoneGuide() {
  window.history.replaceState(null, '', '/m/capture#t=qr-token')
  vi.mocked(fetch)
    .mockResolvedValueOnce(okResponse(EXCHANGE_OK))
    .mockResolvedValueOnce(okResponse(POLICY_RESPONSE))
  render(<CaptureSession />)
  await userEvent.click(await screen.findByRole('button', { name: '아이폰을 쓰고 있나요?' }))
  await userEvent.click(screen.getByRole('button', { name: '계속' }))
  await screen.findByRole('button', { name: '영상 촬영하기' })
}
