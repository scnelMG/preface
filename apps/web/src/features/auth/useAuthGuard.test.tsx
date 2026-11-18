import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { useAuthStore } from './store'
import { useAuthGuard } from './useAuthGuard'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/studio',
}))

beforeEach(() => {
  replace.mockReset()
  useLoginPrompt.setState({ open: false, returnTo: null })
})

describe('useAuthGuard', () => {
  it('세션 복구 중에는 아무것도 하지 않고 내용을 숨긴다', () => {
    useAuthStore.setState({ status: 'loading' })

    const { result } = renderHook(() => useAuthGuard())

    expect(result.current.ready).toBe(false)
    expect(useLoginPrompt.getState().open).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('비로그인이면 지금 경로를 돌아올 곳으로 로그인 모달을 연다', () => {
    useAuthStore.setState({ status: 'anonymous' })

    const { result } = renderHook(() => useAuthGuard())

    expect(result.current.ready).toBe(false)
    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio' })
  })

  it('가입 동의를 마치지 않았으면 가입 동의 화면으로', () => {
    useAuthStore.setState({ status: 'signup' })

    renderHook(() => useAuthGuard())

    expect(replace).toHaveBeenCalledWith('/signup')
    expect(useLoginPrompt.getState().open).toBe(false)
  })

  it('회원이면 통과', () => {
    useAuthStore.setState({ status: 'member' })

    const { result } = renderHook(() => useAuthGuard())

    expect(result.current.ready).toBe(true)
    expect(useLoginPrompt.getState().open).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })
})
