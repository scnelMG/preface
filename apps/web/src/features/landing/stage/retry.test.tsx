import { StrictMode, type ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetryBoundary, withRetry } from './retry'

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('실패하면 기다렸다 다시 불러, 성공한 값을 돌려준다', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('ok')
    const result = withRetry(run, new AbortController().signal, [1000])
    await vi.advanceTimersByTimeAsync(999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('기다리는 시간을 다 쓰면 마지막 오류로 거절한다', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('down'))
    const result = withRetry(run, new AbortController().signal, [10, 20])
    const settled = expect(result).rejects.toThrow('down')
    await vi.advanceTimersByTimeAsync(30)
    await settled
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('화면을 떠나면(signal 끊김) 더 부르지 않는다', async () => {
    const controller = new AbortController()
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('network'))
    const result = withRetry(run, controller.signal, [1000])
    const settled = expect(result).rejects.toBeDefined()
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await settled
    await vi.advanceTimersByTimeAsync(5000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('RetryBoundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 오류 경계가 잡은 오류를 React가 console.error로 알린다. 일부러 낸 오류라 숨긴다
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.useRealTimers())

  /** useGLTF처럼, 받기 전(source.ok=false)에는 그릴 때마다 같은 오류를 낸다 */
  function headSource() {
    const source = { ok: false }
    function Head() {
      if (!source.ok) throw new Error('load failed')
      return <p>머리</p>
    }
    return { source, Head }
  }

  // React는 동시 렌더 중 오류가 나면 한 번 더 동기로 그려 본 뒤 그 사실을 따로 알린다. 시험에서는 조용히 둔다
  const quiet = (ui: ReactNode) => render(ui, { onRecoverableError: () => {} })

  it('안쪽이 실패하면 보관된 실패를 지우고 기다렸다 다시 그린다', async () => {
    const { source, Head } = headSource()
    const onError = vi.fn()
    quiet(
      <RetryBoundary onError={onError} delays={[1000]}>
        <Head />
      </RetryBoundary>,
    )
    expect(screen.queryByText('머리')).not.toBeInTheDocument()
    expect(onError).toHaveBeenCalledTimes(1)

    source.ok = true
    await act(() => vi.advanceTimersByTimeAsync(999))
    expect(screen.queryByText('머리')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByText('머리')).toBeInTheDocument()
  })

  it('효과가 떼였다 다시 붙어도(StrictMode) 다시 그리기가 사라지지 않는다', async () => {
    // 처음 붙는 순간 바로 실패하면, 오류를 잡은 자리에서 건 타이머는 StrictMode가 효과를 뗄 때 지워졌다
    const { source, Head } = headSource()
    quiet(
      <StrictMode>
        <RetryBoundary delays={[1000]}>
          <Head />
        </RetryBoundary>
      </StrictMode>,
    )
    source.ok = true
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('머리')).toBeInTheDocument()
  })

  it('기다리는 시간을 다 쓰면 아무것도 그리지 않고 더 시도하지 않는다', async () => {
    const { Head } = headSource()
    const onError = vi.fn()
    const { container } = quiet(
      <RetryBoundary onError={onError} delays={[10, 20]}>
        <Head />
      </RetryBoundary>,
    )
    // act는 콜백이 끝난 뒤 다시 그리므로, 다음 기다림은 다시 그린 뒤에야 걸린다. 한 번씩 넘긴다
    await act(() => vi.advanceTimersByTimeAsync(10))
    await act(() => vi.advanceTimersByTimeAsync(20))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    // 처음 1번 + 다시 2번
    expect(onError).toHaveBeenCalledTimes(3)
    expect(container).toBeEmptyDOMElement()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('포기한 뒤에도 다시 붙으면(화면에 다시 들어오면) 처음부터 다시 그린다', () => {
    const { source, Head } = headSource()
    const onError = vi.fn()
    const first = quiet(
      <RetryBoundary onError={onError} delays={[]}>
        <Head />
      </RetryBoundary>,
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(first.container).toBeEmptyDOMElement()
    first.unmount()

    source.ok = true
    quiet(
      <RetryBoundary onError={onError} delays={[]}>
        <Head />
      </RetryBoundary>,
    )
    expect(screen.getByText('머리')).toBeInTheDocument()
  })

  it('화면을 떠나면 기다리던 다시 그리기를 취소한다', () => {
    const { Head } = headSource()
    const { unmount } = quiet(
      <RetryBoundary delays={[1000]}>
        <Head />
      </RetryBoundary>,
    )
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
