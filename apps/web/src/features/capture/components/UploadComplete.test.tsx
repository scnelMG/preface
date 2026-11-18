import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sha256Base64 } from '@/features/upload/fileUtils'
import {
  FakeXhr,
  JOB_RESPONSE,
  POLICY_RESPONSE,
  fakeVideo,
  uploadUrlResponse,
} from '@/features/upload/testing'
import { setNextRecording, stubLiveCaptureSupport } from '@/features/live-capture/testing'
import { clearAccessToken, getAccessToken } from '@/shared/api/tokenStore'
import { __resetCaptureSession, useCaptureSessionStore } from '../store'
import { EXCHANGE_OK, okResponse } from '../testing'
import { rememberUploaded } from '../uploadedMarker'
import { CaptureSession } from './CaptureSession'

// 페이지 이동은 jsdom에서 할 수 없다. 어디로 어떻게(replace) 가는지만 본다
const nav = vi.hoisted(() => ({ replacePage: vi.fn(), openPage: vi.fn() }))
vi.mock('../linkToken', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../linkToken')>()),
  ...nav,
}))

// jsdom에는 카메라·MediaPipe가 없다. 촬영 화면은 [가짜 녹화 끝]으로 녹화가 끝난 것처럼 만드는 가짜로 바꾼다
vi.mock('@/features/live-capture/LiveCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/live-capture/LiveCapture')>()
  const { FakeLiveCapture } = await import('@/features/live-capture/testing')
  return { ...actual, LiveCapture: FakeLiveCapture }
})

// 합성 영상이다
const video = fakeVideo({ name: 'IMG_0001.MOV', type: 'video/quicktime' })

function apiCalls() {
  return vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    path: new URL(String(url)).pathname.replace('/api/v1', ''),
    method: init?.method ?? 'GET',
  }))
}

/** QR 교환 → 계속 → 촬영 → 올리기까지 마친다. `sameDevice`면 휴대폰에서 바로 시작한 흐름(-457)이다 */
async function uploadOnce({ sameDevice = false } = {}) {
  const checksum = await sha256Base64(video)
  window.history.replaceState(null, '', `/m/capture#t=qr-token${sameDevice ? '&self=1' : ''}`)
  vi.mocked(fetch)
    .mockResolvedValueOnce(okResponse(EXCHANGE_OK))
    .mockResolvedValueOnce(okResponse(POLICY_RESPONSE))
  const view = render(<CaptureSession />)
  // 같은 기기면 계정 확인 없이 바로 촬영 가이드다
  if (!sameDevice) await userEvent.click(await screen.findByRole('button', { name: '계속' }))
  await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
  setNextRecording(video)
  await userEvent.click(await screen.findByRole('button', { name: '가짜 녹화 끝' }))
  const player = await screen.findByLabelText('촬영한 영상 미리보기')
  Object.defineProperty(player, 'duration', { configurable: true, value: 36 })
  fireEvent.loadedMetadata(player)

  vi.mocked(fetch)
    .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
    .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
  await userEvent.click(screen.getByRole('button', { name: '이 영상 올리기' }))
  await screen.findByRole('heading', { name: '업로드했어요' })
  return view
}

describe('SCR-17④ 업로드 완료 (휴대폰)', () => {
  let restoreSupport: () => void

  beforeEach(() => {
    restoreSupport = stubLiveCaptureSupport()
    __resetCaptureSession()
    clearAccessToken()
    window.sessionStorage.clear()
    nav.replacePage.mockReset()
    nav.openPage.mockReset()
    FakeXhr.reset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })

  afterEach(() => {
    restoreSupport()
    vi.unstubAllGlobals()
    window.history.replaceState(null, '', '/')
  })

  it('PC 화면을 보라고 안내하고, 다시 찍는 버튼은 두지 않는다', async () => {
    await uploadOnce()

    expect(screen.getByText(/PC 화면에서 3D가 만들어지는 과정을 확인하세요/)).toBeInTheDocument()
    expect(screen.getByText(/이 창은 닫아도 돼요/)).toBeInTheDocument()
    // Figma처럼 연결 표시는 남긴다
    expect(screen.getByText('PC와 연결됨')).toBeInTheDocument()
    // 작업이 이미 생겼다(REC_002). 여기서 다시 찍지 않는다
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('업로드가 끝나면 세션 토큰을 버리고, 연결 끊기(QR-04)는 부르지 않는다', async () => {
    await uploadOnce()

    expect(getAccessToken()).toBeNull()
    expect(useCaptureSessionStore.getState().video).toBeNull()
    // QR-04를 부르면 링크가 CANCELED가 되어 PC가 UPLOADED·jobId를 못 볼 수 있다
    expect(apiCalls().filter((c) => c.method === 'DELETE')).toEqual([])
    expect(apiCalls().map((c) => c.path)).toEqual([
      '/capture-links/exchange',
      '/uploads/policy',
      '/uploads',
      '/reconstructions',
    ])
  })

  it('완료 화면에서 새로고침하면 QR 재스캔 안내 대신 완료 화면을 다시 보여 준다', async () => {
    const first = await uploadOnce()
    first.unmount()
    __resetCaptureSession()
    vi.mocked(fetch).mockClear()

    // 새로고침: 주소에 토큰이 없다
    window.history.replaceState(null, '', '/m/capture')
    render(<CaptureSession />)

    expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
    // 토큰이 없으니 아무 API도 부르지 않는다(정책 조회 포함)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('업로드 표시는 30분이 지나면 무시한다', async () => {
    rememberUploaded(Date.now() - 31 * 60 * 1000)
    window.history.replaceState(null, '', '/m/capture')
    render(<CaptureSession />)

    expect(
      await screen.findByRole('heading', { name: 'QR을 다시 스캔해 주세요' }),
    ).toBeInTheDocument()
  })

  it('새 QR로 들어오면 이전 업로드 표시를 지우고 새로 연결한다', async () => {
    rememberUploaded()
    window.history.replaceState(null, '', '/m/capture#t=qr-token')
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(EXCHANGE_OK))
      .mockResolvedValue(okResponse(POLICY_RESPONSE))
    render(<CaptureSession />)

    expect(
      await screen.findByRole('heading', { name: '민서님 계정으로 촬영해요' }),
    ).toBeInTheDocument()
    expect(window.sessionStorage.length).toBe(0)
  })

  describe('같은 기기에서 올렸을 때(-457·-524)', () => {
    it('3D 만드는 화면으로 갈 때 방문 기록에서 촬영 화면을 뺀다(뒤로 가기로 돌아오지 않게)', async () => {
      await uploadOnce({ sameDevice: true })

      await userEvent.click(screen.getByRole('button', { name: '3D 만드는 화면 보기' }))

      expect(nav.replacePage).toHaveBeenCalledWith(`/reconstructions/${JOB_RESPONSE.jobId}`)
      // 방문 기록을 쌓는 이동(location.assign)은 쓰지 않는다
      expect(nav.openPage).not.toHaveBeenCalled()
    })

    it('완료 화면이 다시 열려도(새로고침·뒤로 가기) 3D 만드는 화면 버튼을 그대로 보여 준다', async () => {
      const first = await uploadOnce({ sameDevice: true })
      first.unmount()
      // 다시 열면 스토어는 처음 상태다
      __resetCaptureSession()
      vi.mocked(fetch).mockClear()

      window.history.replaceState(null, '', '/m/capture')
      render(<CaptureSession />)

      expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
      // PC를 보라는 안내(QR 흐름) 대신 이 기기에서 가는 버튼
      expect(screen.queryByText(/PC 화면에서/)).toBeNull()
      expect(screen.queryByText('PC와 연결됨')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '3D 만드는 화면 보기' }))
      expect(nav.replacePage).toHaveBeenCalledWith(`/reconstructions/${JOB_RESPONSE.jobId}`)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('QR로 연결한 휴대폰은 작업 ID를 남기지 않는다(다시 열어도 PC 안내)', async () => {
      const first = await uploadOnce()
      first.unmount()
      __resetCaptureSession()

      window.history.replaceState(null, '', '/m/capture')
      render(<CaptureSession />)

      expect(
        await screen.findByText(/PC 화면에서 3D가 만들어지는 과정을 확인하세요/),
      ).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(window.sessionStorage.getItem('preface.capture.uploadedAt')).not.toContain(
        JOB_RESPONSE.jobId,
      )
    })

    it('시각만 남긴 예전 표시도 완료 화면으로 읽는다', async () => {
      window.sessionStorage.setItem('preface.capture.uploadedAt', String(Date.now()))
      window.history.replaceState(null, '', '/m/capture')
      render(<CaptureSession />)

      expect(await screen.findByRole('heading', { name: '업로드했어요' })).toBeInTheDocument()
    })
  })
})
