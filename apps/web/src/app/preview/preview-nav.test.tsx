import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewNav } from './preview-nav'

const { showLogin } = vi.hoisted(() => ({ showLogin: vi.fn() }))
vi.mock('@/shared/state/loginPrompt', () => ({
  useLoginPrompt: (selector: (value: { show: typeof showLogin }) => unknown) =>
    selector({ show: showLogin }),
}))
beforeEach(() => showLogin.mockClear())

describe('공통 네비', () => {
  it('기본 title 대신 포커스 툴팁을 표시하고 Escape로 지운다', () => {
    render(<PreviewNav />)
    const workspace = screen.getByRole('link', { name: '내 작업실' })
    expect(workspace).not.toHaveAttribute('title')
    // 실제 초점(jsdom은 :focus-visible을 :focus처럼 본다). 키보드 초점만 말풍선을 연다(-884)
    act(() => workspace.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('내 작업실')
    expect(workspace).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
  it('비로그인에서는 프로필 대신 로그인 버튼으로 실제 로그인 흐름을 연다', () => {
    render(<PreviewNav member={false} />)
    expect(screen.queryByText('나')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(showLogin).toHaveBeenCalledOnce()
  })
  it('서비스 메뉴를 열고 Escape로 닫으면 조작 버튼에 포커스를 돌려준다', () => {
    render(<PreviewNav />)
    const trigger = screen.getByRole('button', { name: '서비스 메뉴' })
    fireEvent.click(trigger)
    expect(screen.getByRole('link', { name: /전체 서비스/ })).toHaveAttribute('href', '/services')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '서비스 둘러보기' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('알림은 실제 연동 상태를 가장하지 않고 메뉴와 하나씩 열린다', () => {
    render(<PreviewNav />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: '알림' }))
    expect(screen.queryByRole('region', { name: '서비스 둘러보기' })).not.toBeInTheDocument()
    expect(screen.getByText('실제 계정 알림은 아직 연결되지 않았어요.')).toBeInTheDocument()
  })
  it('실제 화면의 서비스 메뉴: 회원은 3D 얼굴 편집·헤어·표정 트래킹 모두 내 작업실로 간다(-878)', () => {
    render(<PreviewNav connected member />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    expect(screen.getByRole('link', { name: /3D 얼굴 편집/ })).toHaveAttribute('href', '/studio')
    for (const name of [/헤어 스타일/, /표정 트래킹/]) {
      const row = screen.getByRole('link', { name })
      expect(row).toHaveAttribute('href', '/studio')
      expect(row).toHaveTextContent('이용 가능')
    }
    // 표정 트래킹은 헤어 스타일 바로 아래 줄이다
    const rows = within(screen.getByRole('region', { name: '서비스' }))
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(rows.findIndex((text) => text?.includes('표정 트래킹'))).toBe(
      rows.findIndex((text) => text?.includes('헤어 스타일')) + 1,
    )
  })
  it('실제 화면의 서비스 메뉴: 비로그인은 실험실로, 헤어는 로그인 창을 연다', () => {
    render(<PreviewNav connected member={false} />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    expect(screen.getByRole('link', { name: /3D 얼굴 편집/ })).toHaveAttribute('href', '/lab')
    fireEvent.click(screen.getByRole('button', { name: /헤어 스타일/ }))
    expect(showLogin).toHaveBeenCalledWith({ returnTo: '/studio' })
    expect(screen.queryByRole('region', { name: '서비스' })).not.toBeInTheDocument()
    // 표정 트래킹도 헤어처럼 로그인 창을 연다(-878)
    showLogin.mockClear()
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: /표정 트래킹/ }))
    expect(showLogin).toHaveBeenCalledWith({ returnTo: '/studio' })
  })
  it('서비스 메뉴의 예정 항목은 누를 수 없고, 헤어·표정 트래킹은 더 이상 예정이 아니다', () => {
    render(<PreviewNav connected member />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    const panel = screen.getByRole('region', { name: '서비스' })
    for (const title of ['안경 피팅', '메이크업']) {
      const row = within(panel).getByText(title)
      expect(row.closest('a, button')).toBeNull()
      expect(row).toHaveTextContent('예정')
    }
    for (const title of ['헤어 스타일', '표정 트래킹'])
      expect(within(panel).getByText(title).closest('a')).not.toBeNull()
    expect(within(panel).queryByText('일부 체험')).not.toBeInTheDocument()
  })
  it('/preview 시안의 서비스 메뉴 이동은 그대로다', () => {
    const { unmount } = render(<PreviewNav />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    expect(screen.getByRole('link', { name: /3D 얼굴 편집/ })).toHaveAttribute(
      'href',
      '/preview/editor',
    )
    unmount()
    render(<PreviewNav member={false} />)
    fireEvent.click(screen.getByRole('button', { name: '서비스 메뉴' }))
    expect(screen.getByRole('link', { name: /3D 얼굴 편집/ })).toHaveAttribute('href', '/preview')
  })
  it('실제 계정에서는 종 아이콘이 알림 팝업을 열고, 열리면 활성으로 표시한다', () => {
    render(<PreviewNav connected notificationPanel={() => <p>최근 알림 목록</p>} />)
    const bell = screen.getByRole('button', { name: '알림' })
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(bell)
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: '알림' })).toHaveTextContent('최근 알림 목록')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('최근 알림 목록')).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })
})
