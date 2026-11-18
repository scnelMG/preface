import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CaptureGuide } from './CaptureGuide'

const prepDialog = () => screen.queryByRole('dialog', { name: '찍기 전에 확인해요' })

describe('SCR-05 촬영 가이드 (휴대폰)', () => {
  it('시연을 보여 주고, 버튼 위의 외울 순서 줄은 두지 않는다 (2026-11-01)', () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)

    expect(screen.getByRole('heading', { name: '휴대폰을 천천히 옮겨 담아요' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '촬영 순서 시연' })).toBeInTheDocument()
    expect(screen.queryByText('이 순서만 기억해요')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '촬영 순서' })).not.toBeInTheDocument()
  })

  it('"약 N초면 충분해요" 같은 권장 길이 문구는 두지 않는다(-882)', () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    expect(screen.getByText('얼굴은 그대로, 휴대폰만 반원을 그리며 옮겨요.')).toBeInTheDocument()
    expect(screen.queryByText(/초면 충분해요/)).not.toBeInTheDocument()
  })

  it('한 번 확인했어도 다시 들어오면 팝업을 또 띄운다(-882)', async () => {
    const { unmount } = render(<CaptureGuide liveSupported onCapture={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '확인했어요' }))
    unmount()

    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    expect(prepDialog()).toHaveAttribute('open')
  })

  it('들어오면 찍기 전 준비(밝기·이마와 귀·거리·안경과 모자)와 원본 안내를 팝업으로 먼저 보여 준다 (-566)', () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)

    const dialog = prepDialog()
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('open')
    const prep = within(dialog!).getByRole('list', { name: '찍기 전에 확인해요' })
    expect(within(prep).getAllByRole('listitem')).toHaveLength(4)
    expect(within(prep).getByText('이마와 귀가 보이게')).toBeInTheDocument()
    expect(within(prep).getByText('안경과 모자는 벗고')).toBeInTheDocument()
    expect(within(dialog!).getByText(/편집하지 않은 원본 영상을 그대로 올려요/)).toBeInTheDocument()
    // 닫는 길은 [확인했어요] 하나다. X는 없다
    expect(within(dialog!).queryByRole('button', { name: '닫기' })).not.toBeInTheDocument()
    expect(screen.getByText(/카메라 권한을 확인해 주세요/)).toBeInTheDocument()
  })

  it('[확인했어요]를 누르면 팝업이 닫히고 시연을 처음부터 다시 튼다. 본문에는 준비 목록이 없다', async () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    const before = screen.getByLabelText(/휴대폰으로 얼굴을 찍는 순서 시연/)

    await userEvent.click(screen.getByRole('button', { name: '확인했어요' }))

    expect(prepDialog()).toBeNull()
    expect(screen.queryByRole('list', { name: '찍기 전에 확인해요' })).not.toBeInTheDocument()
    // key가 바뀌어 영상을 새로 만든다(처음부터 재생)
    expect(screen.getByLabelText(/휴대폰으로 얼굴을 찍는 순서 시연/)).not.toBe(before)
  })

  it('영상 아래 "찍기 전 확인 다시 보기"로 팝업을 다시 연다', async () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: '확인했어요' }))

    await userEvent.click(screen.getByRole('button', { name: '찍기 전 확인 다시 보기' }))
    expect(prepDialog()).toHaveAttribute('open')
  })

  it('"영상 촬영하기"를 누르면 카메라를 연다', async () => {
    const onCapture = vi.fn()
    render(<CaptureGuide liveSupported onCapture={onCapture} />)

    await userEvent.click(screen.getByRole('button', { name: '영상 촬영하기' }))
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  it('"영상 파일 올리기" 링크는 없다(업로드는 웹 녹화로만, -929)', () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
  })

  it('웹 녹화를 못 하는 브라우저면 촬영 버튼 대신 다른 브라우저로 열라는 안내만 보여 준다', () => {
    render(<CaptureGuide liveSupported={false} onCapture={() => {}} />)
    expect(screen.queryByRole('button', { name: '영상 촬영하기' })).not.toBeInTheDocument()
    expect(
      screen.getByText('이 브라우저에서는 촬영할 수 없어요. 최신 Safari나 Chrome으로 열어 주세요'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
  })

  it('아이폰 사진 보관함 안내·갤러리 버튼은 없다(-619에서 없앰)', () => {
    render(<CaptureGuide liveSupported onCapture={() => {}} />)
    expect(screen.queryByRole('list', { name: '아이폰에서 찍는 방법' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '갤러리에서 고르기' })).not.toBeInTheDocument()
    expect(screen.queryByText(/사진 보관함/)).not.toBeInTheDocument()
  })
})
