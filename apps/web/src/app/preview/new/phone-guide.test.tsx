import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOLD_MS, HOLD_SWAP_MS, PhoneGuide } from './phone-guide'
vi.mock('next/dynamic', () => ({ default: () => () => null }))
let reduced = false
beforeEach(() => {
  reduced = false
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.cb([{ isIntersecting: true }])
      }
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('휴대폰 촬영 각도 안내', () => {
  it('왼쪽, 정면, 오른쪽, 위, 아래 순서로 이동한다(두 번째 정면은 없다)', () => {
    render(<PhoneGuide />)
    for (const name of ['1. 왼쪽', '2. 정면', '3. 오른쪽', '4. 위', '5. 아래']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      // 첫 정면은 손 바꿔 잡는 시간을 준다
      act(() => vi.advanceTimersByTime(name === '2. 정면' ? HOLD_SWAP_MS : HOLD_MS))
    }
    expect(screen.getByRole('button', { name: '1. 왼쪽' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('정면에서 손을 바꿀 시간을 주고 오른쪽 안내로 이어진다', () => {
    render(<PhoneGuide />)
    act(() => vi.advanceTimersByTime(HOLD_MS))
    expect(screen.getByText('정면에서 손 바꿔 잡기')).toBeInTheDocument()
    expect(
      screen.getByText('얼굴은 고정하고, 팔을 쭉 뻗은 채로 휴대폰을 천천히 움직여주세요.'),
    ).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(HOLD_SWAP_MS - 100))
    expect(screen.getByRole('button', { name: '2. 정면' })).toHaveAttribute('aria-pressed', 'true')
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByRole('button', { name: '3. 오른쪽' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  it('순서 막대는 머무는 시간만큼 넓다(손 바꿔 잡는 정면이 가장 길다)', () => {
    render(<PhoneGuide />)
    expect(Number(screen.getByRole('button', { name: '2. 정면' }).style.flexGrow)).toBe(
      HOLD_SWAP_MS,
    )
    expect(Number(screen.getByRole('button', { name: '1. 왼쪽' }).style.flexGrow)).toBe(HOLD_MS)
    expect(screen.queryByRole('button', { name: '6. 아래' })).not.toBeInTheDocument()
  })
  it('수동 선택하면 자동 재생을 멈추고 재생 버튼으로 다시 시작한다', () => {
    render(<PhoneGuide />)
    fireEvent.click(screen.getByRole('button', { name: '4. 위' }))
    act(() => vi.advanceTimersByTime(5200))
    expect(screen.getByRole('button', { name: '4. 위' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '각도 안내 재생' }))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    expect(screen.getByRole('button', { name: '5. 아래' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('모션 감소 설정에서는 방향을 직접 고를 수 있다', () => {
    reduced = true
    render(<PhoneGuide />)
    act(() => vi.advanceTimersByTime(5200))
    expect(screen.getByRole('button', { name: '1. 왼쪽' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: '각도 안내 일시정지' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '3. 오른쪽' }))
    expect(screen.getByRole('button', { name: '3. 오른쪽' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
