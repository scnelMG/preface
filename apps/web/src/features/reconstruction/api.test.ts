import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('@/shared/api/client', () => ({ api: { get: (...args: unknown[]) => get(...args) } }))

const { getReconstruction } = await import('./api')

beforeEach(() => get.mockReset())

describe('getReconstruction', () => {
  it('jobId를 경로 한 칸으로 인코딩한다', () => {
    void getReconstruction('a/b?c')
    expect(get).toHaveBeenCalledWith('/reconstructions/a%2Fb%3Fc', { signal: undefined })
  })
})
