import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetToaster, dismissToast, toast } from './Toast'

afterEach(() => {
  act(() => __resetToaster())
  vi.useRealTimers()
})

describe('toast', () => {
  it('레이아웃에 붙이지 않아도 부르면 화면에 뜬다', async () => {
    act(() => {
      toast('저장했어요.')
    })
    expect(await screen.findByText('저장했어요.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('dismissToast로 그 토스트만 바로 걷는다', async () => {
    let first = 0
    act(() => {
      first = toast('앞 요약')
      toast('다른 알림')
    })
    expect(await screen.findByText('앞 요약')).toBeInTheDocument()
    act(() => dismissToast(first))
    expect(screen.queryByText('앞 요약')).not.toBeInTheDocument()
    expect(screen.getByText('다른 알림')).toBeInTheDocument()
  })

  it('정해진 시간이 지나면 사라진다 (기본 3초)', async () => {
    vi.useFakeTimers()
    act(() => {
      toast('잠깐 보여요.')
    })
    expect(screen.getByText('잠깐 보여요.')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.queryByText('잠깐 보여요.')).not.toBeInTheDocument()
  })

  it('되돌리기 같은 버튼을 달 수 있고, 누르면 동작하고 닫힌다', async () => {
    const onUndo = vi.fn()
    act(() => {
      toast('초기화했어요.', { action: { label: '되돌리기', onClick: onUndo } })
    })
    await userEvent.click(await screen.findByRole('button', { name: '되돌리기' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('초기화했어요.')).not.toBeInTheDocument()
  })

  it('여러 번 불러도 토스트 자리는 하나다', () => {
    act(() => {
      toast('하나')
      toast('둘')
    })
    expect(document.querySelectorAll('[data-toaster]')).toHaveLength(1)
  })
})
