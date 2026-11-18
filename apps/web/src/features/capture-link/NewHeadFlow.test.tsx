import type React from 'react'
import { render, screen } from '@testing-library/react'
import { Activity } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_GUIDE } from '@/features/capture-guide/guideContent'
import { FakeNotification, installFakeNotification } from '@/features/notifications/testing'
import * as api from './api'
import { NewHeadFlow } from './NewHeadFlow'

// 시연 영상은 그리지 않고, 화면이 넘긴 소개·행동·준비 칸만 그대로 둔다
vi.mock('@/features/capture-guide/CaptureMotionGuide', () => ({
  CaptureMotionGuide: ({
    intro,
    actions,
    after,
  }: {
    intro?: React.ReactNode
    actions?: React.ReactNode
    after?: React.ReactNode
  }) => (
    <div>
      {intro}
      {actions}
      {after}
    </div>
  ),
}))

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
// 휴대폰 여부(-457). 기본은 PC
const device = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/features/capture/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/capture/device')>()),
  isMobileDevice: () => device.mobile,
}))
const nav = vi.hoisted(() => ({ openPage: vi.fn() }))
vi.mock('@/features/capture/linkToken', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/capture/linkToken')>()),
  openPage: nav.openPage,
}))
vi.mock('./api', () => ({
  createCaptureLink: vi.fn(),
  getCaptureLink: vi.fn(),
  deleteCaptureLink: vi.fn(),
}))

// jsdom에는 <dialog>의 showModal·close가 없다
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
  device.mobile = false
  nav.openPage.mockReset()
  router.push.mockReset()
  router.replace.mockReset()
  vi.mocked(api.createCaptureLink)
    .mockReset()
    .mockResolvedValue({
      linkId: 'lk-1',
      // 합성 값이다
      qrUrl: 'https://example.test/m/capture#t=fake',
      expiresAt: new Date(Date.now() + 180_000).toISOString(),
    })
  vi.mocked(api.getCaptureLink).mockReset()
  vi.mocked(api.deleteCaptureLink).mockReset().mockResolvedValue({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NewHeadFlow', () => {
  it('촬영 가이드를 먼저 보여 주고, 그동안 QR을 발급하지 않는다', () => {
    render(<NewHeadFlow />)
    expect(screen.getByRole('heading', { name: '휴대폰으로 얼굴을 담아요' })).toBeInTheDocument()
    expect(api.createCaptureLink).not.toHaveBeenCalled()
  })

  it('영상 촬영하기를 누르면 같은 페이지에 QR을 발급한다', async () => {
    render(<NewHeadFlow />)
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(screen.getByRole('heading', { name: 'QR을 찍어 연결하세요.' })).toBeInTheDocument()
    expect(api.createCaptureLink).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('img', { name: '휴대폰 연결 QR 코드' })).toBeInTheDocument()
  })

  it('닫으면 기다리던 QR을 끊고 내 작업실로 간다', async () => {
    render(<NewHeadFlow />)
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    await screen.findByRole('img', { name: '휴대폰 연결 QR 코드' })
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(api.deleteCaptureLink).toHaveBeenCalledWith('lk-1')
    expect(router.push).toHaveBeenCalledWith('/studio')
  })
})

describe('NewHeadFlow — 화면을 떠났다 돌아올 때(cacheComponents <Activity>)', () => {
  // cacheComponents는 떠난 화면을 unmount하지 않고 <Activity mode="hidden">으로 남긴다. 그 흉내다
  function renderInActivity(mode: 'visible' | 'hidden') {
    return (
      <Activity mode={mode}>
        <NewHeadFlow />
      </Activity>
    )
  }

  it('QR까지 갔다가 떠난 뒤 다시 들어오면 촬영 가이드부터 보인다', async () => {
    const { rerender } = render(renderInActivity('visible'))
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    await screen.findByRole('img', { name: '휴대폰 연결 QR 코드' })

    rerender(renderInActivity('hidden'))
    rerender(renderInActivity('visible'))

    expect(screen.getByRole('heading', { name: '휴대폰으로 얼굴을 담아요' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '휴대폰 연결 QR 코드' })).not.toBeInTheDocument()
  })

  it('업로드가 끝나 생성 대기 화면으로 넘어가면(화면 숨김) 다음 화면을 막는 모달을 남기지 않는다', async () => {
    const { rerender } = render(renderInActivity('visible'))
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    await screen.findByRole('img', { name: '휴대폰 연결 QR 코드' })

    rerender(renderInActivity('hidden'))
    // 열린 modal dialog가 남으면 보이지 않아도 문서 나머지가 inert가 된다(-391)
    expect(document.querySelector('dialog[open]')).not.toBeInTheDocument()
  })

  it('다시 영상 촬영하기를 누르면 지난 QR이 아니라 새 QR을 발급한다', async () => {
    const { rerender } = render(renderInActivity('visible'))
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    await screen.findByRole('img', { name: '휴대폰 연결 QR 코드' })
    rerender(renderInActivity('hidden'))
    rerender(renderInActivity('visible'))

    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(api.createCaptureLink).toHaveBeenCalledTimes(2)
  })
})

describe('NewHeadFlow 브라우저 알림 권한(FN-REC-03 첫 복원)', () => {
  it('화면에 들어올 때는 묻지 않고, 영상 촬영하기 클릭 안에서 한 번 묻는다', async () => {
    installFakeNotification('default')
    render(<NewHeadFlow />)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
    // 답과 상관없이 QR로 넘어간다
    expect(screen.getByRole('heading', { name: 'QR을 찍어 연결하세요.' })).toBeInTheDocument()
  })

  it('이미 거부했으면 다시 묻지 않고 그대로 진행한다', async () => {
    installFakeNotification('denied')
    render(<NewHeadFlow />)
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'QR을 찍어 연결하세요.' })).toBeInTheDocument()
  })

  it('이미 허용했으면 묻지 않는다', async () => {
    installFakeNotification('granted')
    render(<NewHeadFlow />)
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('알림을 지원하지 않는 브라우저도 막지 않는다', async () => {
    vi.stubGlobal('Notification', undefined)
    render(<NewHeadFlow />)
    await userEvent.click(screen.getByRole('button', { name: CAPTURE_GUIDE.pcNext }))
    expect(screen.getByRole('heading', { name: 'QR을 찍어 연결하세요.' })).toBeInTheDocument()
  })
})

describe('NewHeadFlow — 휴대폰에서 열면(-457)', () => {
  it('가이드·QR 없이 촬영 링크를 바로 발급해 이 탭에서 촬영 화면으로 간다', async () => {
    device.mobile = true
    render(<NewHeadFlow />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('촬영 화면으로 이동하는 중')
    await vi.waitFor(() =>
      expect(nav.openPage).toHaveBeenCalledWith(
        `${window.location.origin}/m/capture#t=fake&self=1`,
      ),
    )
    expect(api.createCaptureLink).toHaveBeenCalledTimes(1)
  })

  it('발급이 실패하면(진행 중 작업 등) PC와 같은 안내를 보여 준다', async () => {
    device.mobile = true
    vi.mocked(api.createCaptureLink).mockRejectedValue(new Error('network'))
    render(<NewHeadFlow />)

    expect(await screen.findByRole('dialog', { name: '휴대폰으로 촬영해요' })).toBeInTheDocument()
    expect(nav.openPage).not.toHaveBeenCalled()
  })
})
