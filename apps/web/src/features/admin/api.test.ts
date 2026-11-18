import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('@/shared/api/client', () => ({ api: { get: (...args: unknown[]) => get(...args) } }))

const {
  getAdminMe,
  getReconstructionDetail,
  getReconstructionQueue,
  getReconstructionSummary,
  listReconstructions,
} = await import('./api')

beforeEach(() => get.mockReset())

describe('관리자 API', () => {
  it('관리자 정보는 /admin/me', () => {
    void getAdminMe()
    expect(get).toHaveBeenCalledWith('/admin/me', { signal: undefined })
  })

  it('요약은 기간을 쿼리로 보낸다', () => {
    void getReconstructionSummary('7d')
    expect(get).toHaveBeenCalledWith('/admin/reconstructions/summary', {
      query: { period: '7d' },
      signal: undefined,
    })
  })

  it('대기열은 /admin/reconstructions/queue', () => {
    void getReconstructionQueue()
    expect(get).toHaveBeenCalledWith('/admin/reconstructions/queue', { signal: undefined })
  })

  it('작업 상세는 jobId를 경로 한 칸으로 인코딩한다', () => {
    void getReconstructionDetail('a/b?c')
    expect(get).toHaveBeenCalledWith('/admin/reconstructions/a%2Fb%3Fc', { signal: undefined })
  })

  it('작업 목록은 빈 거르기를 빼고 기본 페이지(0, 20)를 보낸다', () => {
    void listReconstructions({ status: '', userId: '  ' })
    expect(get).toHaveBeenCalledWith('/admin/reconstructions', {
      query: {
        status: undefined,
        failCode: undefined,
        stage: undefined,
        userId: undefined,
        from: undefined,
        to: undefined,
        page: 0,
        size: 20,
      },
      signal: undefined,
    })
  })

  it('작업 목록의 날짜는 한국 날짜 0시 ~ 다음 날 0시(UTC)로 바꾸고 size는 100까지만', () => {
    void listReconstructions({
      status: 'FAILED',
      failCode: 'TIMEOUT',
      stage: 'RECONSTRUCT',
      userId: ' u-1 ',
      from: '2026-11-01',
      to: '2026-11-07',
      page: 2,
      size: 500,
    })
    expect(get.mock.calls[0][1].query).toEqual({
      status: 'FAILED',
      failCode: 'TIMEOUT',
      stage: 'RECONSTRUCT',
      userId: 'u-1',
      from: '2026-10-31T15:00:00.000Z',
      to: '2026-11-07T15:00:00.000Z',
      page: 2,
      size: 100,
    })
  })
})
