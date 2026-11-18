import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_CAPTURE_COPY, LiveCapture } from './LiveCapture'
import { stubLiveCaptureSupport } from './testing'

// 얼굴 추적 모델은 테스트에서 받지 않는다
vi.mock('./faceTracker', () => ({
  createFaceTracker: () => Promise.reject(new Error('no model in test')),
}))

describe('LiveCapture 화면', () => {
  beforeEach(() => {
    // 음성 파일을 미리 받는 요청. 테스트에서는 실패시켜 주소로 재생하게 둔다
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('지원하지 않는 브라우저면 다른 브라우저로 열라는 안내만 보여 준다(파일 링크 없음, -929)', () => {
    render(<LiveCapture onRecorded={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(LIVE_CAPTURE_COPY.unsupported)
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
  })

  it('처음에는 촬영 준비 시트(오른손·소리 확인)와 거울 미리보기(얼굴 가림)를 보여 준다', () => {
    const restore = stubLiveCaptureSupport()
    render(<LiveCapture onRecorded={() => {}} />)

    const sheet = screen.getByRole('dialog', { name: '촬영 준비' })
    expect(sheet).toHaveTextContent('휴대폰은 오른손으로 잡아 주세요')
    // 실제 움직임: 정면 → 오른쪽 → 다시 정면(-882)
    expect(sheet).toHaveTextContent('정면으로 시작해요.')
    expect(screen.getByRole('button', { name: '소리 들어 보기' })).toBeInTheDocument()
    const preview = screen.getByLabelText('전면 카메라 미리보기', { selector: 'video' })
    expect(preview).toHaveClass('pf-live-video')
    // Clarity가 카메라 미리보기를 기록하지 않게 가린다
    expect(preview).toHaveAttribute('data-clarity-mask', 'True')
    restore()
  })

  it('소리를 들어 보고 "잘 들려요"를 체크해야 촬영 시작이 켜진다', async () => {
    const restore = stubLiveCaptureSupport()
    render(<LiveCapture onRecorded={() => {}} />)

    const start = screen.getByRole('button', { name: '촬영 시작' })
    const heard = screen.getByRole('checkbox', { name: '잘 들려요' })
    expect(start).toBeDisabled()
    expect(heard).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '소리 들어 보기' }))
    expect(heard).toBeEnabled()
    await userEvent.click(heard)
    expect(start).toBeEnabled()
    restore()
  })

  it('앞서 "잘 들려요"를 체크했으면 체크한 채로 열고, 체크를 부모에 알린다(-882)', async () => {
    const restore = stubLiveCaptureSupport()
    const onChange = vi.fn()
    const { unmount } = render(
      <LiveCapture onRecorded={() => {}} soundChecked={false} onSoundCheckedChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '소리 들어 보기' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '잘 들려요' }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    unmount()

    render(<LiveCapture onRecorded={() => {}} soundChecked onSoundCheckedChange={onChange} />)
    expect(screen.getByRole('checkbox', { name: '잘 들려요' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '잘 들려요' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '촬영 시작' })).toBeEnabled()
    restore()
  })

  it('음성 안내를 끄면 소리 확인 없이 촬영 시작이 켜지고, 다음에도 꺼진 채로 연다(-765)', async () => {
    const restore = stubLiveCaptureSupport()
    const { unmount } = render(<LiveCapture onRecorded={() => {}} />)
    const start = screen.getByRole('button', { name: '촬영 시작' })
    expect(start).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /음성 안내 끄기/ }))
    expect(start).toBeEnabled()
    expect(screen.queryByRole('button', { name: '소리 들어 보기' })).not.toBeInTheDocument()
    unmount()

    render(<LiveCapture onRecorded={() => {}} />)
    expect(screen.getByRole('checkbox', { name: /음성 안내 끄기/ })).toBeChecked()
    expect(screen.getByRole('button', { name: '촬영 시작' })).toBeEnabled()
    localStorage.clear()
    restore()
  })

  it('촬영 안내로 돌아가기는 시트 안에 있다', async () => {
    const restore = stubLiveCaptureSupport()
    const onCancel = vi.fn()
    render(<LiveCapture onRecorded={() => {}} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '촬영 안내로 돌아가기' }))
    expect(onCancel).toHaveBeenCalledOnce()
    restore()
  })

  it('카메라를 열지 못하면 권한 안내와 다시 시도를 보여 준다', async () => {
    const restore = stubLiveCaptureSupport()
    render(<LiveCapture onRecorded={() => {}} />)

    await startCapture()

    expect(await screen.findByRole('alert')).toHaveTextContent(LIVE_CAPTURE_COPY.cameraDenied)
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    restore()
  })

  it('얼굴 모델을 받지 못하면 촬영할 수 없다고 안내한다', async () => {
    const restore = stubLiveCaptureSupport()
    const stop = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop }] }),
      },
    })
    render(<LiveCapture onRecorded={() => {}} />)

    await startCapture()

    expect(await screen.findByRole('alert')).toHaveTextContent(LIVE_CAPTURE_COPY.unsupported)
    // 카메라는 끈다
    expect(stop).toHaveBeenCalled()
    restore()
  })
})

/** 촬영 준비 시트: 소리 들어 보기 → 잘 들려요 → 촬영 시작 */
async function startCapture() {
  await userEvent.click(screen.getByRole('button', { name: '소리 들어 보기' }))
  await userEvent.click(screen.getByRole('checkbox', { name: '잘 들려요' }))
  await userEvent.click(screen.getByRole('button', { name: '촬영 시작' }))
}
