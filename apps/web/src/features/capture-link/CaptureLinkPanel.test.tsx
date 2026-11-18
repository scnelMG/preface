import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_SEQUENCE,
  MOBILE_CAPTURE_GUIDE,
  MOBILE_CAPTURE_PREPARATION,
} from '@/features/capture-guide/guideContent'
import { ApiError } from '@/shared/api/ApiError'
import { CaptureLinkPanel, formatRemaining } from './CaptureLinkPanel'
import type { CaptureLinkView } from './useCaptureLink'

// 토스트는 <body>에 스스로 붙어 테스트 사이에 남는다. 여기서는 부른 것만 확인한다
const toastMock = vi.hoisted(() => vi.fn())
vi.mock('@/shared/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui')>()),
  toast: toastMock,
}))

// 합성 값이다. 실제 토큰이 아니다
const LINK = {
  linkId: 'lk-1',
  qrUrl: 'https://example.test/m/capture#t=fake-token',
  expiresAt: '2026-10-25T10:03:00Z',
}

function ready(
  status: 'WAITING' | 'CONNECTED' | 'UPLOADED' | 'EXPIRED' | 'CANCELED',
  remainingMs = 161_000,
): CaptureLinkView {
  return { kind: 'ready', link: LINK, status, jobId: null, remainingMs }
}

function setup(view: CaptureLinkView, variant: 'panel' | 'page' = 'panel') {
  const onRegenerate = vi.fn()
  const onDisconnect = vi.fn().mockResolvedValue(undefined)
  render(
    <CaptureLinkPanel
      variant={variant}
      view={view}
      onRegenerate={onRegenerate}
      onDisconnect={onDisconnect}
    />,
  )
  return { onRegenerate, onDisconnect }
}

describe('formatRemaining', () => {
  it('분:초로 바꾸고 초는 올림한다', () => {
    expect(formatRemaining(180_000)).toBe('3:00')
    expect(formatRemaining(161_000)).toBe('2:41')
    expect(formatRemaining(9_500)).toBe('0:10')
    expect(formatRemaining(0)).toBe('0:00')
  })
})

describe('CaptureLinkPanel', () => {
  it('기다리는 중이면 QR·남은 시간·대기 문구를 보여 준다', () => {
    setup(ready('WAITING'))
    const qr = screen.getByRole('img', { name: '휴대폰 연결 QR 코드' })
    expect(qr.tagName.toLowerCase()).toBe('svg')
    // 접근성 이름·글자에 토큰 주소가 드러나지 않는다
    expect(document.body.textContent).not.toContain('fake-token')
    expect(screen.getByText('2:41')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('휴대폰 연결을 기다리고 있어요')
  })

  it('발급 중이면 QR 자리에 안내를 둔다', () => {
    setup({ kind: 'issuing' })
    expect(screen.queryByRole('img', { name: '휴대폰 연결 QR 코드' })).not.toBeInTheDocument()
    expect(screen.getByText('QR을 만드는 중…')).toBeInTheDocument()
  })

  it('연결되면 QR을 감추고 연결 끊기를 준다', async () => {
    const { onDisconnect } = setup(ready('CONNECTED'))
    expect(screen.queryByRole('img', { name: '휴대폰 연결 QR 코드' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('휴대폰이 연결됐어요')
    await userEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('휴대폰 연결을 끊었어요.')
  })

  it('연결되면 QR 자리에 휴대폰과 같은 촬영 가이드를 보여 준다(-450)', () => {
    setup(ready('CONNECTED'))
    const guide = screen.getByRole('region', { name: '촬영 가이드' })
    expect(within(guide).getByRole('img', { name: CAPTURE_SEQUENCE.alt })).toBeInTheDocument()
    expect(guide).toHaveTextContent(CAPTURE_SEQUENCE.steps.join(' → '))
    const prep = within(guide).getByRole('list', { name: MOBILE_CAPTURE_GUIDE.preparationLabel })
    expect(
      within(prep)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([...MOBILE_CAPTURE_PREPARATION])
    // 연결 전 순서 안내(QR 찍기 등)는 감춘다
    expect(screen.queryByRole('list', { name: '연결 순서' })).not.toBeInTheDocument()
  })

  it('연결 전·업로드 뒤에는 촬영 가이드를 보이지 않는다', () => {
    setup(ready('WAITING'))
    expect(screen.queryByRole('region', { name: '촬영 가이드' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: '연결 순서' })).toBeInTheDocument()
  })

  it.each(['panel', 'page'] as const)(
    '기다리는 중에도 남은 시간 옆 새로고침 아이콘으로 QR을 새로 만든다(%s, 2026-10-30)',
    async (variant) => {
      const { onRegenerate } = setup(ready('WAITING'), variant)
      const refresh = screen.getByRole('button', { name: 'QR 새로 만들기' })
      expect(refresh).toHaveTextContent('')
      await userEvent.click(refresh)
      expect(onRegenerate).toHaveBeenCalledTimes(1)
    },
  )

  it('연결된 뒤에는 새로고침 아이콘을 두지 않는다', () => {
    setup(ready('CONNECTED'))
    expect(screen.queryByRole('button', { name: 'QR 새로 만들기' })).not.toBeInTheDocument()
  })

  it('만료되면 QR 새로 만들기를 준다', async () => {
    const { onRegenerate } = setup(ready('EXPIRED', 0))
    expect(screen.getByRole('status')).toHaveTextContent('QR이 만료됐어요')
    await userEvent.click(screen.getByRole('button', { name: 'QR 새로 만들기' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('끊기면 끊김 문구를 보여 준다', () => {
    setup(ready('CANCELED', 0))
    expect(screen.getByRole('status')).toHaveTextContent('휴대폰 연결이 끊겼어요')
  })

  it('업로드가 끝나면 이동 안내를 보여 준다', () => {
    setup(ready('UPLOADED'))
    expect(screen.getByRole('status')).toHaveTextContent('3D 생성 화면으로 이동해요')
  })

  it('진행 중 작업(REC_002)이면 한 번에 하나만 안내와 작업실 링크를 보여 준다', () => {
    setup({
      kind: 'failed',
      error: new ApiError(409, {
        code: 'REC_002',
        message: '진행 중인 작업이 있어요.',
        details: [],
      }),
    })
    expect(screen.getByText('3D는 한 번에 하나만 만들 수 있어요')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('진행 중인 작업이 있어요.')
    expect(screen.getByRole('link', { name: /내 작업실로 가기/ })).toHaveAttribute(
      'href',
      '/studio',
    )
  })

  it('얼굴 동의가 없으면(CAP_001) 동의 기록으로 보낸다', () => {
    setup({
      kind: 'failed',
      error: new ApiError(403, {
        code: 'CAP_001',
        message: '얼굴 데이터 동의가 필요해요.',
        details: [],
      }),
    })
    expect(screen.getByRole('link', { name: /동의 기록 보기/ })).toHaveAttribute(
      'href',
      '/me/consents',
    )
  })

  it('그 밖의 실패는 다시 시도를 준다', async () => {
    const { onRegenerate } = setup({
      kind: 'failed',
      error: new Error('서버와 연결하지 못했어요.'),
    })
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })
})

describe('실서비스 촬영 페이지 상태', () => {
  it('같은 발급 QR과 실제 남은 시간을 새 레이아웃에 표시한다', () => {
    setup(ready('WAITING'), 'page')
    expect(screen.getByRole('heading', { name: 'QR을 찍어 연결하세요.' })).toBeVisible()
    expect(screen.getByRole('img', { name: '휴대폰 연결 QR 코드' })).toBeInTheDocument()
    expect(screen.getByText('2:41')).toBeVisible()
    expect(document.body.textContent).not.toContain('fake-token')
  })
  it('만료 시 같은 재발급 콜백을 사용한다', async () => {
    const { onRegenerate } = setup(ready('EXPIRED'), 'page')
    await userEvent.click(screen.getByRole('button', { name: 'QR 새로 만들기' }))
    expect(onRegenerate).toHaveBeenCalledOnce()
  })
  it('연결 후 QR을 감추고 실제 해제 콜백을 사용한다', async () => {
    const { onDisconnect } = setup(ready('CONNECTED'), 'page')
    expect(screen.queryByRole('img', { name: '휴대폰 연결 QR 코드' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '휴대폰이 연결됐어요.' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
    expect(onDisconnect).toHaveBeenCalledOnce()
  })
})
