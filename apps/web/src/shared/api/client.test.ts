import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './ApiError'
import { __resetRefreshState, api } from './client'
import { ErrorCode } from './errorCodes'
import { clearAccessToken, getAccessToken, setAccessToken } from './tokenStore'

function ok<T>(data: T) {
  return { ok: true, status: 200, json: async () => ({ success: true, data, error: null }) }
}

function fail(status: number, code: string, message = '실패', details: unknown[] = []) {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, data: null, error: { code, message, details } }),
  }
}

describe('api client', () => {
  beforeEach(() => {
    clearAccessToken()
    __resetRefreshState()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('refresh token 쿠키가 오가도록 credentials를 include로 보낸다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok({ id: 'u-1' }) as unknown as Response)

    await api.get('/users/me')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.credentials).toBe('include')
  })

  it('access token이 있으면 Authorization 헤더를 붙인다', async () => {
    setAccessToken('token-1', 'user')
    vi.mocked(fetch).mockResolvedValueOnce(ok({ id: 'u-1' }) as unknown as Response)

    await api.get('/users/me')

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('anonymous 요청에는 Authorization을 붙이지 않는다', async () => {
    setAccessToken('token-1', 'user')
    vi.mocked(fetch).mockResolvedValueOnce(ok([]) as unknown as Response)

    await api.get('/consent-documents', { anonymous: true })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('getBlob은 성공하면 본문을 Blob으로, 실패하면 공통 에러를 ApiError로 준다', async () => {
    setAccessToken('token-1', 'user')
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => blob,
      } as unknown as Response)
      .mockResolvedValueOnce(fail(409, 'READ_002') as unknown as Response)

    await expect(api.getBlob('/photo')).resolves.toBe(blob)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    expect((init?.headers as Record<string, string>).Accept).toBe('image/*, application/json')

    const error = await api.getBlob('/photo').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('READ_002')
  })

  it('AUTH_002를 받으면 재발급하고 한 번 재시도한다', async () => {
    setAccessToken('expired', 'user')
    vi.mocked(fetch)
      .mockResolvedValueOnce(fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED) as unknown as Response)
      .mockResolvedValueOnce(ok({ accessToken: 'fresh', expiresIn: 1800 }) as unknown as Response)
      .mockResolvedValueOnce(ok({ id: 'u-1' }) as unknown as Response)

    const result = await api.get<{ id: string }>('/users/me')

    expect(result).toEqual({ id: 'u-1' })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(getAccessToken()).toBe('fresh')
  })

  it('업로드 전용 세션(capture)은 AUTH_002를 받아도 재발급하지 않는다', async () => {
    setAccessToken('capture-token', 'capture')
    vi.mocked(fetch).mockResolvedValueOnce(
      fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED) as unknown as Response,
    )

    const error = await api.get('/uploads/policy').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe(ErrorCode.ACCESS_TOKEN_EXPIRED)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe('capture-token')
  })

  it('재발급이 실패하면 토큰을 비우고 원래 에러를 던진다', async () => {
    setAccessToken('expired', 'user')
    vi.mocked(fetch)
      .mockResolvedValueOnce(fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED) as unknown as Response)
      .mockResolvedValueOnce(fail(401, ErrorCode.REFRESH_TOKEN_INVALID) as unknown as Response)

    await expect(api.get('/users/me')).rejects.toBeInstanceOf(ApiError)
    expect(getAccessToken()).toBeNull()
  })

  it('가입 토큰이 만료되면 재발급하지 않는다 (다른 계정 refresh 쿠키로 회원 세션이 열리지 않게)', async () => {
    setAccessToken('signup-expired', 'signup')
    vi.mocked(fetch).mockResolvedValueOnce(
      fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED) as unknown as Response,
    )

    await expect(api.post('/auth/signup', { consents: [] })).rejects.toMatchObject({
      code: ErrorCode.ACCESS_TOKEN_EXPIRED,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('동시에 만료돼도 재발급은 한 번만 돈다', async () => {
    setAccessToken('expired', 'user')
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/auth/token/refresh')) {
        return ok({ accessToken: 'fresh', expiresIn: 1800 }) as unknown as Response
      }
      return (getAccessToken() === 'fresh'
        ? ok({ id: 'u-1' })
        : fail(401, ErrorCode.ACCESS_TOKEN_EXPIRED)) as unknown as Response
    })

    await Promise.all([api.get('/users/me'), api.get('/notifications'), api.get('/simulations')])

    const refreshCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).includes('/auth/token/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })

  it('실패 응답을 ApiError로 바꾸고 필드 사유를 꺼낼 수 있다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      fail(400, ErrorCode.INVALID_REQUEST, '요청 값을 확인해 주세요.', [
        { field: 'nickname', reason: '필수 값이에요.' },
      ]) as unknown as Response,
    )

    const error = await api.post('/auth/signup', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe(ErrorCode.INVALID_REQUEST)
    expect((error as ApiError).fieldErrors()).toEqual({ nickname: '필수 값이에요.' })
  })

  it('null·undefined 쿼리 값은 보내지 않는다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(null) as unknown as Response)

    await api.get('/reconstructions/current', {
      query: { includeRecentFailed: true, cursor: null, limit: undefined },
    })

    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('includeRecentFailed=true')
    expect(url).not.toContain('cursor')
    expect(url).not.toContain('limit')
  })
})

describe('api client — 배포 빌드의 상대 경로 Base', () => {
  afterEach(() => {
    vi.doUnmock('@/shared/config/env')
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('Base가 /api/v1이면 같은 출처 상대 주소로 요청한다', async () => {
    vi.resetModules()
    vi.doMock('@/shared/config/env', () => ({ API_BASE_URL: '/api/v1', ASSET_BASE_URL: '' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([]) as unknown as Response))
    const { api: relativeApi } = await import('./client')

    await relativeApi.get('/reconstructions', { query: { cursor: 'a b', limit: 20, empty: null } })

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/reconstructions?cursor=a+b&limit=20')
  })
})
