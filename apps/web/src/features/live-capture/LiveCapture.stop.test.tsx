import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuideFrame } from './guideEngine'
import { LIVE_CAPTURE_COPY, LiveCapture } from './LiveCapture'
import { stubLiveCaptureSupport } from './testing'

// 녹화 마무리 실패 경로만 본다. 얼굴 추적·안내 판단·녹화기는 가짜로 둔다(실제 카메라·얼굴 영상 없음)
const fake = vi.hoisted(() => ({
  trackerClose: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('./faceTracker', () => ({
  createFaceTracker: () =>
    Promise.resolve({
      detect: () => null,
      measureBangs: () => undefined,
      segmenterFailed: false,
      maskDebug: '',
      close: fake.trackerClose,
    }),
}))

vi.mock('./recorder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recorder')>()),
  startRecording: () => ({
    stop: () => Promise.reject(new Error('녹화를 마치지 못함(테스트)')),
    discard: fake.discard,
  }),
}))

// 첫 틱에 바로 녹화를 시작하는 안내 판단
vi.mock('./guideEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./guideEngine')>()
  class FakeGuideEngine {
    stepIndex = 0
    bothSides = false
    endDebug = ''
    private started = false
    begin() {}
    stop() {}
    confirmBangs() {}
    wantsBangs() {
      return false
    }
    tick(): GuideFrame {
      const first = !this.started
      this.started = true
      return {
        phase: 'rec',
        stepIndex: 0,
        message: { text: '녹화 중', tone: 'plain' },
        hint: '',
        oval: 'ok',
        sizeTag: null,
        gauge: null,
        recSec: 0,
        recording: true,
        startRecording: first,
        stop: null,
        voice: [],
        checks: null,
        checkPassed: false,
        headGuide: null,
        askBangsConfirm: false,
      }
    }
  }
  return { ...actual, GuideEngine: FakeGuideEngine }
})

describe('LiveCapture 녹화 마무리 실패', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    // 추적 반복이 카메라 프레임이 준비됐다고 보게 한다
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fake.trackerClose.mockReset()
    fake.discard.mockReset()
  })

  it('녹화를 마치지 못하면 안내를 보이고 카메라와 얼굴 추적을 끈다', async () => {
    const restore = stubLiveCaptureSupport()
    const stopTrack = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: stopTrack }] }),
      },
    })
    render(<LiveCapture onRecorded={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: '소리 들어 보기' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '잘 들려요' }))
    await userEvent.click(screen.getByRole('button', { name: '촬영 시작' }))
    await userEvent.click(await screen.findByRole('button', { name: '녹화 멈춤' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(LIVE_CAPTURE_COPY.unsupported)
    // 화면을 떠나기 전이라도 카메라 불이 꺼지고 추적이 멈춘다
    expect(stopTrack).toHaveBeenCalled()
    expect(fake.trackerClose).toHaveBeenCalled()
    restore()
  })
})
