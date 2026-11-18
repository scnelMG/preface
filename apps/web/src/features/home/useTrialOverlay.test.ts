import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TRIAL_HISTORY_KEY, useTrialOverlay } from './useTrialOverlay'

beforeEach(() => {
  window.history.replaceState(null, '')
  document.documentElement.style.overflow = ''
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 640 })
})
afterEach(() => vi.restoreAllMocks())

function popTo(state: unknown) {
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state }))
  })
}

describe('useTrialOverlay', () => {
  it('열면 주소는 그대로 두고 history 항목을 쌓고 뒤 페이지 스크롤을 잠근다', () => {
    const before = window.location.href
    const { result } = renderHook(() => useTrialOverlay())
    act(() => result.current.show())

    expect(result.current.open).toBe(true)
    expect(window.history.state).toMatchObject({ [TRIAL_HISTORY_KEY]: true })
    expect(window.location.href).toBe(before)
    expect(document.documentElement.style.overflow).toBe('hidden')
  })

  it('뒤로 가기(popstate)로 닫히고 연 순간의 스크롤 위치로 돌아간다', () => {
    const { result } = renderHook(() => useTrialOverlay())
    act(() => result.current.show())
    popTo(null)

    expect(result.current.open).toBe(false)
    expect(document.documentElement.style.overflow).toBe('')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640)
  })

  it('홈으로 버튼은 쌓은 항목을 뒤로 가기로 지운다', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => popTo(null))
    const { result } = renderHook(() => useTrialOverlay())
    act(() => result.current.show())
    act(() => result.current.close())

    expect(back).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBe(false)
  })

  it('쌓은 항목이 없으면(이미 다른 항목) 뒤로 가지 않고 그냥 닫는다', () => {
    const back = vi.spyOn(window.history, 'back')
    const { result } = renderHook(() => useTrialOverlay())
    act(() => result.current.show())
    window.history.replaceState(null, '')
    act(() => result.current.close())

    expect(back).not.toHaveBeenCalled()
    expect(result.current.open).toBe(false)
  })

  it('앞으로 가기로 체험 항목에 돌아오면 다시 연다', () => {
    const { result } = renderHook(() => useTrialOverlay())
    popTo({ [TRIAL_HISTORY_KEY]: true })
    expect(result.current.open).toBe(true)
  })
})
