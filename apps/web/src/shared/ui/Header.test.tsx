import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Header } from './Header'

function renderMember(onLogout = vi.fn()) {
  render(
    <>
      <Header
        active="main"
        member={{ nickname: '민서' }}
        onLoginClick={() => {}}
        onLogout={onLogout}
      />
      <p>본문</p>
    </>,
  )
  return onLogout
}

const profile = () => screen.getByRole('button', { name: '민서님, 계정 메뉴' })

describe('Header', () => {
  it('현재 메뉴만 aria-current="page"다', () => {
    render(<Header active="studio" member={null} onLoginClick={() => {}} onLogout={() => {}} />)
    const nav = screen.getByRole('navigation', { name: '주요 메뉴' })
    expect(within(nav).getByRole('link', { name: '내 작업실' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: '메인' })).not.toHaveAttribute('aria-current')
  })

  it('비로그인이면 로그인 버튼이 있고, 누르면 onLoginClick을 부른다', async () => {
    const onLoginClick = vi.fn()
    render(<Header active="main" member={null} onLoginClick={onLoginClick} onLogout={() => {}} />)
    // Desktop·Mobile 모양을 화면 폭으로 바꾸므로 버튼이 둘 그려진다
    const buttons = screen.getAllByRole('button', { name: /로그인/ })
    await userEvent.click(buttons[0])
    expect(onLoginClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /계정 메뉴/ })).not.toBeInTheDocument()
  })

  it('회원이면 프로필 메뉴 버튼이 있고, 로그인 버튼은 없다', () => {
    renderMember()
    expect(profile()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '내 정보' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /로그인/ })).not.toBeInTheDocument()
  })

  it('안 읽은 알림은 회원일 때만 표시한다', () => {
    const { rerender } = render(
      <Header
        active="main"
        member={{ nickname: '민서' }}
        unread
        onLoginClick={() => {}}
        onLogout={() => {}}
      />,
    )
    expect(screen.getByRole('link', { name: '알림, 새 알림 있음' })).toBeInTheDocument()

    rerender(
      <Header active="main" member={null} unread onLoginClick={() => {}} onLogout={() => {}} />,
    )
    expect(screen.getByRole('link', { name: '알림' })).toBeInTheDocument()
  })
})

describe('회원 프로필 메뉴', () => {
  it('누르면 내 정보·로그아웃 메뉴가 열린다', async () => {
    renderMember()
    await userEvent.click(profile())

    expect(profile()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: '내 정보' })).toHaveAttribute('href', '/me')
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeEnabled()
  })

  it('로그아웃을 누르면 메뉴를 닫고 onLogout을 부른다', async () => {
    const onLogout = renderMember()
    await userEvent.click(profile())
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))

    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(profile()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
  })

  it('키보드로 열고 Tab으로 항목을 옮겨 가며, Esc로 닫고 프로필 버튼으로 돌아온다', async () => {
    renderMember()
    profile().focus()
    await userEvent.keyboard('{Enter}')
    expect(profile()).toHaveAttribute('aria-expanded', 'true')

    await userEvent.tab()
    expect(screen.getByRole('link', { name: '내 정보' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '로그아웃' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(profile()).toHaveAttribute('aria-expanded', 'false')
    expect(profile()).toHaveFocus()
  })

  it('바깥을 누르면 닫는다', async () => {
    renderMember()
    await userEvent.click(profile())
    await userEvent.click(screen.getByText('본문'))

    expect(profile()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: '내 정보' })).not.toBeInTheDocument()
  })

  it('로그아웃 중에는 로그아웃을 다시 누를 수 없다', async () => {
    render(
      <Header
        active="main"
        member={{ nickname: '민서' }}
        onLoginClick={() => {}}
        onLogout={() => {}}
        loggingOut
      />,
    )
    await userEvent.click(profile())
    expect(screen.getByRole('button', { name: '로그아웃하는 중…' })).toBeDisabled()
  })
})
