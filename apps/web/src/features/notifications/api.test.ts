import { beforeEach, describe, expect, it } from 'vitest'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { setAccessToken } from '@/shared/api/tokenStore'
import { getNotifications, markAllNotificationsRead, markNotificationsRead } from './api'
import { notificationHref } from './links'
import { list } from './testing'

beforeEach(() => setAccessToken('access', 'user'))

function bodyOf(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as unknown
}

describe('getNotifications (API-NOTI-01)', () => {
  it('size를 1~50으로 맞춘다', async () => {
    const fetch = routeFetch([
      ['GET', '/notifications', ok(list([]))],
      ['GET', '/notifications', ok(list([]))],
    ])
    await getNotifications({ page: 2, size: 80 })
    await getNotifications({ size: 0 })
    const urls = callsTo(fetch, '/notifications').map(([url]) => new URL(String(url)))
    expect(urls[0].searchParams.get('size')).toBe('50')
    expect(urls[0].searchParams.get('page')).toBe('2')
    expect(urls[1].searchParams.get('size')).toBe('1')
  })
})

describe('markNotificationsRead (API-NOTI-02)', () => {
  it('ID 100개씩 나눠 보내고 마지막 안 읽은 개수를 돌려준다', async () => {
    const fetch = routeFetch([
      ['POST', '/notifications/read', ok({ unreadCount: 5 })],
      ['POST', '/notifications/read', ok({ unreadCount: 0 })],
    ])
    const ids = Array.from({ length: 150 }, (_, i) => `n-${i}`)
    const result = await markNotificationsRead([...ids, 'n-0'])
    expect(result.unreadCount).toBe(0)
    const calls = callsTo(fetch, '/notifications/read')
    expect(calls).toHaveLength(2)
    expect((bodyOf(calls[0]) as { notificationIds: string[] }).notificationIds).toHaveLength(100)
    expect((bodyOf(calls[1]) as { notificationIds: string[] }).notificationIds).toHaveLength(50)
  })

  it('빈 목록은 보내지 않는다', async () => {
    await expect(markNotificationsRead([])).rejects.toThrow()
  })

  it('모두 읽음은 all=true 한 번이다', async () => {
    const fetch = routeFetch([['POST', '/notifications/read', ok({ unreadCount: 0 })]])
    await markAllNotificationsRead()
    expect(bodyOf(callsTo(fetch, '/notifications/read')[0])).toEqual({ all: true })
  })
})

describe('notificationHref', () => {
  it('성공은 작업실 머리 선택, 실패는 복원 실패 안내로 간다', () => {
    expect(notificationHref({ target: { kind: 'FACE_MODEL', id: 'fm-1' } })).toBe(
      '/studio?faceModelId=fm-1',
    )
    expect(notificationHref({ target: { kind: 'RECON_JOB', id: 'job-1' } })).toBe(
      '/reconstructions/job-1',
    )
  })

  it('대상이 없거나 모르는 종류면 이동하지 않는다', () => {
    expect(notificationHref({ target: null })).toBeNull()
    expect(notificationHref({ target: { kind: 'SIMULATION', id: 's-1' } })).toBeNull()
  })
})
