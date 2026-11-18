import { afterEach, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { getSimulation, updateMorphState } from './api'
import { recoverRecommendation, rememberRecommendation } from './recommendationSave'
import type { Simulation } from './types'

vi.mock('./api', () => ({ getSimulation: vi.fn(), updateMorphState: vi.fn() }))

afterEach(() => {
  sessionStorage.clear()
  vi.resetAllMocks()
})

const changes = [{ code: 'contour.jaw_angle', value: -0.06 }]
const signal = () => new AbortController().signal
const detail = (stateVersion: number, value: number): Simulation => ({
  simulationId: 'sim-1',
  faceModelId: 'fm-1',
  title: '시안',
  stateVersion,
  currentSeq: stateVersion,
  canUndo: true,
  canRedo: false,
  hasChanges: true,
  morphState: { schemaVersion: 'v1', weights: { 'contour.jaw_angle': value } },
})

it.each([
  [-0.06, 'saved'],
  [0.18, 'error'],
] as const)('이미 바뀐 서버 버전에 덮어쓰지 않는다 (%s)', async (value, status) => {
  rememberRecommendation('sim-1', 3, changes)
  const current = detail(4, value)
  await expect(recoverRecommendation(current, signal())).resolves.toEqual({ data: current, status })
  expect(updateMorphState).not.toHaveBeenCalled()
  await expect(recoverRecommendation(current, signal())).resolves.toBeNull()
})

it('재요청 중 원래 저장이 먼저 끝나면 현재 값을 읽고 이력을 추가하지 않는다', async () => {
  rememberRecommendation('sim-1', 3, changes)
  vi.mocked(updateMorphState).mockRejectedValueOnce(
    new ApiError(409, { code: ErrorCode.VERSION_CONFLICT, message: '버전 충돌', details: [] }),
  )
  const current = detail(4, -0.06)
  vi.mocked(getSimulation).mockResolvedValueOnce(current)
  await expect(recoverRecommendation(detail(3, 0), signal())).resolves.toEqual({
    data: current,
    status: 'saved',
  })
  expect(updateMorphState).toHaveBeenCalledExactlyOnceWith('sim-1', 3, changes)
  await expect(recoverRecommendation(current, signal())).resolves.toBeNull()
})
