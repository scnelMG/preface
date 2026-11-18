import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '@/features/auth/store'
import {
  clearVisited,
  FIRST_VISIT_STORAGE_KEY,
  hasVisited,
  markVisited,
  useFirstVisitRedirect,
  useMarkVisited,
} from './firstVisit'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}))

beforeEach(() => {
  replace.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  clearVisited()
  localStorage.clear()
})

function renderRedirect(status: AuthStatus) {
  return renderHook(({ s }) => useFirstVisitRedirect(s), { initialProps: { s: status } })
}

describe('첫 방문 랜딩', () => {
  it('처음 온 비로그인 사용자를 랜딩으로 바꿔 보내고 기록한다', () => {
    renderRedirect('anonymous')

    expect(replace).toHaveBeenCalledExactlyOnceWith('/about')
    expect(localStorage.getItem(FIRST_VISIT_STORAGE_KEY)).toBe('1')
  })

  it('두 번째부터는 메인을 그대로 둔다', () => {
    localStorage.setItem(FIRST_VISIT_STORAGE_KEY, '1')

    renderRedirect('anonymous')

    expect(replace).not.toHaveBeenCalled()
  })

  it('랜딩에 먼저 도착했으면 메인에서 다시 보내지 않는다', () => {
    renderHook(() => useMarkVisited())
    expect(hasVisited()).toBe(true)

    renderRedirect('anonymous')

    expect(replace).not.toHaveBeenCalled()
  })

  it('회원은 보내지 않고, 나중에 로그아웃해도 보내지 않는다', () => {
    const { rerender } = renderRedirect('member')
    expect(replace).not.toHaveBeenCalled()

    rerender({ s: 'anonymous' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('세션 복구 중에는 판단하지 않고, 회원으로 정해지면 그대로 둔다', () => {
    const { rerender } = renderRedirect('loading')
    expect(replace).not.toHaveBeenCalled()
    expect(hasVisited()).toBe(false)

    rerender({ s: 'member' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('세션 복구가 비로그인으로 끝나면 그때 보낸다', () => {
    const { rerender } = renderRedirect('loading')
    rerender({ s: 'anonymous' })

    expect(replace).toHaveBeenCalledExactlyOnceWith('/about')
  })

  it('저장소가 예외를 던져도 한 번만 보내고 이 탭에서는 기억한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    renderRedirect('anonymous').unmount()
    renderRedirect('anonymous')

    expect(replace).toHaveBeenCalledExactlyOnceWith('/about')
    expect(() => markVisited()).not.toThrow()
  })
})
