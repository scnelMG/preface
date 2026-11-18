import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExpressionTracking } from './ExpressionControl'
import { loadExpressionRig } from './rig'

vi.mock('./rig', async (original) => ({
  ...(await original<typeof import('./rig')>()),
  loadExpressionRig: vi.fn(),
}))
const load = vi.mocked(loadExpressionRig)

describe('useExpressionTracking: 표정 리그 받기', () => {
  beforeEach(() => {
    load.mockReset()
  })

  it('리그 주소가 없으면 버튼을 그리지 않고 아무것도 받지 않는다', () => {
    const { result } = renderHook(() => useExpressionTracking(null))
    expect(result.current.available).toBe(false)
    act(() => result.current.toggle())
    expect(load).not.toHaveBeenCalled()
  })

  it('처음 켤 때 받고, 받지 못하면 끄고 다시 누르라고 알린다', async () => {
    load.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useExpressionTracking('https://rig/expression.json'))
    expect(result.current.available).toBe(true)
    expect(load).not.toHaveBeenCalled()
    await act(async () => result.current.toggle())
    expect(load).toHaveBeenCalledTimes(1)
    expect(result.current.running).toBe(false)
    expect(result.current.rig).toBeNull()
    expect(result.current.status).toBe('표정 데이터를 받지 못했어요. 잠시 뒤 다시 눌러 주세요')
  })

  it('형식이 맞지 않는 리그도 같은 문구로 알리고 버튼은 남긴다', async () => {
    load.mockResolvedValue(null)
    const { result } = renderHook(() => useExpressionTracking('https://rig/expression.json'))
    await act(async () => result.current.toggle())
    expect(result.current.available).toBe(true)
    expect(result.current.status).toBe('표정 데이터를 받지 못했어요. 잠시 뒤 다시 눌러 주세요')
  })

  it('받는 도중에 끄면 받기를 멈추고 시작하지 않는다', async () => {
    let signal: AbortSignal | undefined
    load.mockImplementation((_url, given) => {
      signal = given
      return new Promise((_, reject) =>
        given?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      )
    })
    const { result } = renderHook(() => useExpressionTracking('https://rig/expression.json'))
    act(() => result.current.toggle())
    expect(result.current.status).toBe('표정 데이터를 받는 중…')
    await act(async () => result.current.toggle())
    expect(signal?.aborted).toBe(true)
    expect(result.current.running).toBe(false)
    expect(result.current.status).toBe('')
  })

  it('모델(리그 주소)이 바뀌면 진행 중인 받기를 멈춘다', async () => {
    let signal: AbortSignal | undefined
    load.mockImplementation((_url, given) => {
      signal = given
      return new Promise(() => {})
    })
    const { result, rerender } = renderHook(({ url }) => useExpressionTracking(url), {
      initialProps: { url: 'https://rig/a.json' },
    })
    act(() => result.current.toggle())
    rerender({ url: 'https://rig/b.json' })
    expect(signal?.aborted).toBe(true)
    expect(result.current.running).toBe(false)
  })
})
