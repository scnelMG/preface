import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listFaceModels: vi.fn() }))
vi.mock('@/features/studio/api', () => api)

import { useModelTitle } from './useModelTitle'

const model = (id: string, title: string) => ({
  faceModelId: id,
  title,
  createdAt: '2026-11-01T00:00:00Z',
  thumbnailUrl: null,
  simulationCount: 0,
})

/** 쪽마다 50개씩, 전체 total개인 목록 */
function pages(total: number, named: Record<number, ReturnType<typeof model>>) {
  api.listFaceModels.mockImplementation(async ({ page, size }: { page: number; size: number }) => {
    const items = Array.from(
      { length: Math.max(0, Math.min(size, total - page * size)) },
      (_, i) => {
        const index = page * size + i
        return named[index] ?? model(`other-${index}`, `모델 ${index}`)
      },
    )
    return { items, page, size, totalElements: total }
  })
}

afterEach(() => {
  api.listFaceModels.mockReset()
})

describe('useModelTitle (S15P31B204-812·838)', () => {
  it('찾기 전에는 "내 모델", 찾으면 작업실에서 바꾼 이름을 보인다', async () => {
    pages(2, { 1: model('fm-1', '바꾼 이름') })
    const { result } = renderHook(() => useModelTitle('fm-1'))
    expect(result.current).toBe('내 모델')
    await waitFor(() => expect(result.current).toBe('바꾼 이름'))
  })

  it('이름이 비어 있으면 작업실과 같이 "내 모델"이다', async () => {
    pages(1, { 0: model('fm-1', '  ') })
    const { result } = renderHook(() => useModelTitle('fm-1'))
    await waitFor(() => expect(api.listFaceModels).toHaveBeenCalledTimes(1))
    expect(result.current).toBe('내 모델')
  })

  it('첫 쪽(50개)에 없으면 다음 쪽에서 찾는다(-838)', async () => {
    pages(120, { 105: model('fm-1', '오래된 모델') })
    const { result } = renderHook(() => useModelTitle('fm-1'))
    await waitFor(() => expect(result.current).toBe('오래된 모델'))
    expect(api.listFaceModels.mock.calls.map(([params]) => params.page)).toEqual([0, 1, 2])
  })

  it('마지막 쪽까지 없으면 더 묻지 않고 "내 모델"로 둔다', async () => {
    pages(70, {})
    const { result } = renderHook(() => useModelTitle('fm-1'))
    await waitFor(() => expect(api.listFaceModels).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(api.listFaceModels).toHaveBeenCalledTimes(2)
    expect(result.current).toBe('내 모델')
  })

  it('목록을 못 불러오면 "내 모델"이다', async () => {
    api.listFaceModels.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useModelTitle('fm-1'))
    await waitFor(() => expect(api.listFaceModels).toHaveBeenCalledTimes(1))
    expect(result.current).toBe('내 모델')
  })

  it('모델 id가 없으면 묻지 않는다', () => {
    const { result } = renderHook(() => useModelTitle(undefined))
    expect(result.current).toBe('내 모델')
    expect(api.listFaceModels).not.toHaveBeenCalled()
  })
})
