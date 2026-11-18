import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newEyeState } from '@/features/edit/eyes/state'

const api = vi.hoisted(() => ({ getFaceModel: vi.fn(), getSimulationState: vi.fn() }))
const renderer = vi.hoisted(() => ({ renderHead: vi.fn() }))
vi.mock('./api', () => api)
vi.mock('./draftRender', () => renderer)

import { useDraftImages } from './useDraftImages'

/** 테스트 환경에는 WebGL·IntersectionObserver가 없어 둘 다 있는 것처럼 둔다(칸이 바로 화면에 들어온다) */
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => null,
  } as unknown as RenderingContext)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.callback([{ isIntersecting: true }])
      }
      disconnect() {}
    },
  )
  renderer.renderHead.mockImplementation(async (_head, _mesh, weights) =>
    Object.keys(weights).length ? 'blob:draft' : 'blob:original',
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  api.getFaceModel.mockReset()
  api.getSimulationState.mockReset()
  renderer.renderHead.mockReset()
})

describe('useDraftImages (S15P31B204-813)', () => {
  it('슬라이더 값만이 아니라 코 리그 주소·점 조작·눈 편집까지 넘겨 시안을 그린다', async () => {
    const eyeEdit = newEyeState()
    eyeEdit.L.enabled = true
    const pointStrokes = [{ vertex: 12, delta: [0, 0.001, 0] as [number, number, number] }]
    api.getFaceModel.mockResolvedValue({
      faceModelId: 'fm-1',
      meshUrl: 'https://cdn.test/head.glb',
      rigUrl: 'https://cdn.test/rig.json',
    })
    api.getSimulationState.mockResolvedValue({
      simulationId: 'sim-1',
      morphState: {
        schemaVersion: 'v1',
        // 막아 둔 눈 코드(eye.*)는 3D에 넘기지 않는다(편집 화면과 같다)
        weights: { 'nose.bridge_height': 0.4, 'contour.chin_width': -0.5, 'eye.size': 0.3 },
        pointStrokes,
        eyeEdit,
      },
    })
    const box = { current: document.createElement('div') }
    const { result } = renderHook(() => useDraftImages('sim-1', 'fm-1', '2026-11-13', box))

    await waitFor(() => expect(result.current.draft).toBe('blob:draft'))
    expect(result.current.original).toBe('blob:original')
    // 원본은 편집 없이 받은 그대로
    expect(renderer.renderHead).toHaveBeenCalledWith('fm-1', 'https://cdn.test/head.glb', {})
    expect(renderer.renderHead).toHaveBeenCalledWith(
      'fm-1',
      'https://cdn.test/head.glb',
      { 'nose.bridge_height': 0.4, 'contour.chin_width': -0.5 },
      { rigUrl: 'https://cdn.test/rig.json', pointStrokes, eyeEdit },
    )
  })

  it('리그가 없는 모델·편집 없는 시안도 그대로 그린다(리그 주소는 null)', async () => {
    api.getFaceModel.mockResolvedValue({ faceModelId: 'fm-2', meshUrl: 'https://cdn.test/b.glb' })
    api.getSimulationState.mockResolvedValue({
      simulationId: 'sim-2',
      morphState: { schemaVersion: 'v1', weights: { 'contour.cheekbone': 0.2 } },
    })
    const box = { current: document.createElement('div') }
    const { result } = renderHook(() => useDraftImages('sim-2', 'fm-2', '2026-11-13', box))

    await waitFor(() => expect(result.current.draft).toBe('blob:draft'))
    expect(renderer.renderHead).toHaveBeenCalledWith(
      'fm-2',
      'https://cdn.test/b.glb',
      { 'contour.cheekbone': 0.2 },
      { rigUrl: null, pointStrokes: undefined, eyeEdit: undefined },
    )
  })

  it('받기에 실패하면 실패로 알린다(칸은 원래 모델 썸네일을 쓴다)', async () => {
    api.getFaceModel.mockRejectedValue(new Error('network'))
    api.getSimulationState.mockResolvedValue({
      simulationId: 'sim-3',
      morphState: { schemaVersion: 'v1', weights: {} },
    })
    const box = { current: document.createElement('div') }
    const { result } = renderHook(() => useDraftImages('sim-3', 'fm-3', '2026-11-13', box))
    await waitFor(() => expect(result.current.failed).toBe(true))
  })
})
