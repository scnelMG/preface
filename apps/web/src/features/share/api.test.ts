import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()
vi.mock('@/shared/api/client', () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}))

const { createShare, getSharedView, isOpenShare, listShares, revokeShare } = await import('./api')

beforeEach(() => {
  get.mockReset()
  post.mockReset()
  del.mockReset()
})

describe('공유 API', () => {
  it('공유 보기는 로그인 없이 부른다', () => {
    const signal = new AbortController().signal
    void getSharedView('tok_en-1', signal)
    expect(get).toHaveBeenCalledWith('/shares/tok_en-1', { anonymous: true, signal })
  })

  it('공유 만들기·목록·끝내기 경로', () => {
    void createShare('s1')
    void listShares('s1')
    void revokeShare('sh1')
    expect(post).toHaveBeenCalledWith('/simulations/s1/shares')
    expect(get).toHaveBeenCalledWith('/simulations/s1/shares', { signal: undefined })
    expect(del).toHaveBeenCalledWith('/shares/sh1')
  })

  it('헤어·보내는 사람 이름 중 있는 것만 본문에 담고, 둘 다 없으면 본문 없이 부른다', () => {
    void createShare('s1', { hairAssetId: 'dandy' })
    void createShare('s1', { senderName: '민트초코' })
    void createShare('s1', { hairAssetId: 'dandy', senderName: '민트초코' })
    void createShare('s1', { hairAssetId: null, senderName: null })
    void createShare('s1')
    expect(post).toHaveBeenNthCalledWith(1, '/simulations/s1/shares', { hairAssetId: 'dandy' })
    expect(post).toHaveBeenNthCalledWith(2, '/simulations/s1/shares', { senderName: '민트초코' })
    expect(post).toHaveBeenNthCalledWith(3, '/simulations/s1/shares', {
      hairAssetId: 'dandy',
      senderName: '민트초코',
    })
    expect(post).toHaveBeenNthCalledWith(4, '/simulations/s1/shares')
    expect(post).toHaveBeenNthCalledWith(5, '/simulations/s1/shares')
  })

  it('경로 조각은 인코딩한다', () => {
    void revokeShare('a/b')
    expect(del).toHaveBeenCalledWith('/shares/a%2Fb')
  })

  it('끝났거나 만료된 공유는 열려 있지 않다', () => {
    const now = new Date('2026-11-20T00:00:00Z')
    const base = { shareId: 'x', createdAt: '2026-11-19T00:00:00Z' }
    expect(isOpenShare({ ...base, expiresAt: '2026-11-21T00:00:00Z', revokedAt: null }, now)).toBe(
      true,
    )
    expect(
      isOpenShare(
        { ...base, expiresAt: '2026-11-21T00:00:00Z', revokedAt: '2026-11-19T12:00:00Z' },
        now,
      ),
    ).toBe(false)
    expect(isOpenShare({ ...base, expiresAt: '2026-11-20T00:00:00Z', revokedAt: null }, now)).toBe(
      false,
    )
  })
})
