import { act, render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { AuthGate } from './AuthGate'
import { LoginModal } from './LoginModal'
import { useAuthStore } from './store'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/studio',
}))

// jsdom에는 <dialog>의 showModal·close가 없다(Modal.test.tsx와 같은 흉내)
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
  replace.mockReset()
  useAuthStore.setState({ leaving: false })
  useLoginPrompt.setState({ open: false, returnTo: null })
})

function renderApp() {
  return render(
    <>
      <AuthGate>
        <p>내 작업실</p>
      </AuthGate>
      <LoginModal />
    </>,
  )
}

describe('AuthGate', () => {
  it('회원이면 내용을 그린다', () => {
    useAuthStore.setState({ status: 'member' })
    renderApp()
    expect(screen.getByText('내 작업실')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('비로그인이면 내용을 숨기고 로그인 모달을 띄운다', () => {
    useAuthStore.setState({ status: 'anonymous' })
    renderApp()
    expect(screen.queryByText('내 작업실')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '로그인하고 시작해요' })).toHaveAttribute('open')
  })

  it('비로그인으로 모달을 닫으면 메인으로 보낸다', () => {
    useAuthStore.setState({ status: 'anonymous' })
    renderApp()
    act(() => useLoginPrompt.getState().close())
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('스스로 로그아웃·탈퇴했으면 로그인 모달 없이 메인으로 보내고, 나가면 표시를 거둔다', () => {
    useAuthStore.setState({ status: 'member', leaving: false })
    const view = renderApp()
    act(() => useAuthStore.getState().signOut({ leaving: true }))
    expect(screen.queryByText('내 작업실')).not.toBeInTheDocument()
    expect(useLoginPrompt.getState().open).toBe(false)
    expect(replace).toHaveBeenCalledWith('/')

    view.unmount()
    expect(useAuthStore.getState().leaving).toBe(false)
  })

  it('세션 복구 중에는 모달 없이 기다린다', () => {
    useAuthStore.setState({ status: 'loading' })
    renderApp()
    expect(screen.queryByText('내 작업실')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open')
    expect(replace).not.toHaveBeenCalled()
  })
})
