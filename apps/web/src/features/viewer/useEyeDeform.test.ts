import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { newEyeState } from '../edit/eyes/state'
import type { EyeRig } from './eyeRig'
import type { EyeDeformRequest, EyeDeformResponse } from './eyeDeform.worker'
import { createLatestQueue, useEyeDeform } from './useEyeDeform'

describe('눈 변형 계산 줄(-526)', () => {
  it('계산 중에 들어온 값은 마지막 것만 이어서 계산한다', () => {
    const sent: number[] = []
    const queue = createLatestQueue<number>((job) => sent.push(job))
    queue.push(1)
    queue.push(2)
    queue.push(3)
    queue.push(4)
    expect(sent).toEqual([1])
    queue.done()
    expect(sent).toEqual([1, 4])
    expect(queue.busy).toBe(true)
    queue.done()
    expect(queue.busy).toBe(false)
    queue.push(5)
    expect(sent).toEqual([1, 4, 5])
  })

  it('시험 결과를 현재 편집 화면에 반영하지 않고 요청자에게 돌려준다', async () => {
    const worker = {
      postMessage: vi.fn<(message: EyeDeformRequest) => void>(),
      terminate: vi.fn(),
      onmessage: vi.fn<(event: { data: EyeDeformResponse }) => void>(),
    }
    vi.stubGlobal('Worker', function () {
      return worker
    })
    try {
      const rig = { landmarks: [], balls: [], skins: [] } as unknown as EyeRig
      const onApplied = vi.fn()
      const invalidate = vi.fn()
      const { result, unmount } = renderHook(() =>
        useEyeDeform(rig, undefined, undefined, '', undefined, invalidate, onApplied),
      )
      const trial = result.current.current?.(newEyeState(), { L: 'absent', R: 'absent' })
      const message = worker.postMessage.mock.lastCall?.[0]
      expect(message?.type).toBe('apply')
      if (message?.type !== 'apply') throw Error('눈 시험 요청 누락')
      const response = {
        type: 'result',
        id: message.id,
        changed: 5,
        reductions: [],
        skins: [],
      } as const
      act(() => worker.onmessage({ data: { ...response, reductions: [], skins: [] } }))
      await expect(trial).resolves.toEqual(response)
      expect(onApplied).not.toHaveBeenCalled()
      expect(invalidate).not.toHaveBeenCalled()
      unmount()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
