import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import { MattermostNotify, MM_ID_HINT } from './MattermostNotify'

const api = vi.hoisted(() => ({
  mattermostRequestCode: vi.fn(),
  mattermostConfirm: vi.fn(),
  mattermostUnlink: vi.fn(),
}))
vi.mock('./api', () => ({ accountApi: api }))

vi.mock('@/shared/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/Toast')>()),
  toast: vi.fn(),
}))

const SENT = {
  username: 'hong',
  expiresAt: '2099-01-01T00:10:00Z',
  resendAvailableAt: '2000-01-01T00:00:00Z',
}

describe('MattermostNotify (S15P31B204-476)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('고지에 동의해야 코드를 받을 수 있고, 코드가 맞으면 아이디를 등록한다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    api.mattermostRequestCode.mockResolvedValue(SENT)
    api.mattermostConfirm.mockResolvedValue({ username: 'hong', linkedAt: '2026-10-30T05:00:00Z' })
    render(<MattermostNotify username={null} onChange={onChange} />)

    await user.type(screen.getByLabelText('Mattermost 아이디'), '@hong')
    const send = screen.getByRole('button', { name: '확인 코드 받기' })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(send)
    expect(api.mattermostRequestCode).toHaveBeenCalledWith('@hong')

    await user.type(await screen.findByLabelText('@hong에게 보낸 6자리 코드'), '12a3456')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(api.mattermostConfirm).toHaveBeenCalledWith('123456')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('hong'))
  })

  it('입력칸에 이메일 주소 전체가 아니라 아이디만 적으라고 안내한다', () => {
    render(<MattermostNotify username={null} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Mattermost 아이디')).toHaveAccessibleDescription(MM_ID_HINT)
  })

  it('서버 문구로 실패를 알린다', async () => {
    const user = userEvent.setup()
    api.mattermostRequestCode.mockRejectedValue(
      new ApiError(400, {
        code: 'NOTI_002',
        message: 'Mattermost 아이디를 찾을 수 없어요. 아이디를 다시 확인해 주세요.',
        details: [],
      }),
    )
    render(<MattermostNotify username={null} onChange={vi.fn()} />)

    await user.type(screen.getByLabelText('Mattermost 아이디'), 'nobody')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '확인 코드 받기' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('찾을 수 없어요')
  })

  it('등록돼 있으면 아이디를 보여 주고 알림을 끌 수 있다', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    api.mattermostUnlink.mockResolvedValue(undefined)
    render(<MattermostNotify username="hong" onChange={onChange} />)

    // 아이디만 따로 감싸 화면 녹화(Clarity)에서 가린다(S15P31B204-553)
    expect(screen.getByText('@hong')).toHaveAttribute('data-clarity-mask')
    expect(screen.getByText(/\(으\)로 3D 생성 결과를 알려 드려요/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '알림 끄기' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null))
  })
})
