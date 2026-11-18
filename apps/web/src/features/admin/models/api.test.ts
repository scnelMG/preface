import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { ApiError } from '@/shared/api/ApiError'
import { __resetRefreshState } from '@/shared/api/client'
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenStore'
import { adminModelsApi, assetsFresh } from './api'
import { formatBytes, formatDuration } from './format'

beforeEach(() => {
  __resetRefreshState()
  setAccessToken('admin-token', 'user')
})
afterEach(() => {
  clearAccessToken()
  vi.unstubAllGlobals()
})

const PAGE = { items: [], page: 1, size: 20, totalElements: 0, totalPages: 0 }

describe('adminModelsApi', () => {
  it('모델 목록은 사용자 경로에 page·size를 붙여 부른다', async () => {
    const fetch = routeFetch([['GET', '/admin/users/u-1/face-models', ok(PAGE)]])
    await expect(adminModelsApi.faceModels('u-1', { page: 1 })).resolves.toEqual(PAGE)
    const [[url, init]] = callsTo(fetch, '/face-models')
    expect(String(url)).toContain('/admin/users/u-1/face-models?page=1&size=20')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer admin-token' })
  })

  it('size는 계약 최대 100으로 자른다', async () => {
    const fetch = routeFetch([['GET', '/face-models', ok(PAGE)]])
    await adminModelsApi.faceModels('u-1', { size: 500 })
    expect(String(callsTo(fetch, '/face-models')[0][0])).toContain('size=100')
  })

  it('모델 자산과 저장소는 각 경로로 부른다', async () => {
    const assets = {
      faceModelId: 'fm-1',
      expiresAt: '2026-11-07T03:00:00Z',
      texturedMeshUrl: 'https://example.test/mesh.glb',
      baseMeshUrl: null,
      thumbnailUrl: null,
      captureImages: [],
    }
    const storage = {
      userId: 'u-1',
      prefix: 'users/u-1/',
      checkedAt: '2026-11-07T03:00:00Z',
      objects: [],
      deletionFailures: [],
    }
    routeFetch([
      ['GET', '/admin/face-models/fm-1/assets', ok(assets)],
      ['GET', '/admin/users/u-1/storage', ok(storage)],
    ])
    await expect(adminModelsApi.assets('fm-1')).resolves.toEqual(assets)
    await expect(adminModelsApi.storage('u-1')).resolves.toEqual(storage)
  })

  it('관리자가 아니면 403 ApiError를 던진다', async () => {
    routeFetch([['GET', '/storage', fail(403, 'ADM_001', '관리자 아님')]])
    const error = await adminModelsApi.storage('u-1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: 'ADM_001' })
  })
})

describe('assetsFresh', () => {
  const now = Date.parse('2026-11-07T03:00:00Z')
  it('만료까지 30초 넘게 남아야 다시 쓴다', () => {
    expect(assetsFresh({ expiresAt: '2026-11-07T03:04:00Z' }, now)).toBe(true)
    expect(assetsFresh({ expiresAt: '2026-11-07T03:00:20Z' }, now)).toBe(false)
    expect(assetsFresh({ expiresAt: '2026-11-07T02:59:00Z' }, now)).toBe(false)
    expect(assetsFresh({ expiresAt: 'bad' }, now)).toBe(false)
  })
})

describe('format', () => {
  it('크기를 사람이 읽는 단위로', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1234567)).toBe('1.2 MB')
    expect(formatBytes(null)).toBe('—')
  })
  it('영상 길이를 초·분으로', () => {
    expect(formatDuration(12000)).toBe('12초')
    expect(formatDuration(75000)).toBe('1분 15초')
    expect(formatDuration(null)).toBe('—')
  })
})
