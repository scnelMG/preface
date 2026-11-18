import { describe, expect, it } from 'vitest'
import { daysAgo, groupOf, relativeTime } from './time'

// 기준: 2026-10-31 15:00 (Asia/Seoul) = 06:00Z
const now = new Date('2026-10-31T06:00:00Z')

describe('알림 시간 표시', () => {
  it('하루 안은 방금·분·시간으로 짧게 쓴다', () => {
    expect(relativeTime('2026-10-31T05:59:30Z', now)).toBe('방금')
    expect(relativeTime('2026-10-31T05:48:00Z', now)).toBe('12분 전')
    expect(relativeTime('2026-10-31T01:00:00Z', now)).toBe('5시간 전')
  })

  it('날짜 경계는 서울 시간 기준이다(어제 23시는 어제)', () => {
    // 서울 10/30 23:30 = 14:30Z
    expect(daysAgo('2026-10-30T14:30:00Z', now)).toBe(1)
    expect(relativeTime('2026-10-30T14:30:00Z', now)).toBe('어제')
    // 서울 10/31 00:10 = 10/30 15:10Z → 오늘
    expect(relativeTime('2026-10-30T15:10:00Z', now)).toBe('14시간 전')
  })

  it('일주일 안은 며칠 전, 그 뒤는 날짜만(해가 다르면 연도까지)', () => {
    expect(relativeTime('2026-10-27T03:00:00Z', now)).toBe('4일 전')
    expect(relativeTime('2026-10-21T08:50:00Z', now)).toBe('10월 21일')
    expect(relativeTime('2025-12-30T03:00:00Z', now)).toBe('2025.12.30')
  })

  it('묶음은 오늘·어제·지난 7일·이전', () => {
    expect(groupOf('2026-10-31T01:00:00Z', now)).toBe('오늘')
    expect(groupOf('2026-10-30T03:00:00Z', now)).toBe('어제')
    expect(groupOf('2026-10-26T03:00:00Z', now)).toBe('지난 7일')
    expect(groupOf('2026-10-20T03:00:00Z', now)).toBe('이전')
  })
})
