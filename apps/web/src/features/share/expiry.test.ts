import { describe, expect, it } from 'vitest'
import { formatShareExpiry } from './expiry'

const NOW = new Date('2026-11-14T03:00:00Z')

describe('formatShareExpiry', () => {
  it('서울 시간으로 월·일·오전/오후·시를 쓴다', () => {
    expect(formatShareExpiry('2026-11-21T06:00:00Z', NOW)).toBe('11월 21일 오후 3시')
    expect(formatShareExpiry('2026-11-20T15:00:00Z', NOW)).toBe('11월 21일 오전 12시')
  })

  it('분이 있으면 붙인다', () => {
    expect(formatShareExpiry('2026-11-21T00:30:00Z', NOW)).toBe('11월 21일 오전 9시 30분')
  })

  it('올해가 아니면 연도를 붙인다', () => {
    expect(formatShareExpiry('2026-12-31T16:00:00Z', NOW)).toBe('2027년 1월 1일 오전 1시')
  })

  it('읽을 수 없는 시각이면 null이다', () => {
    expect(formatShareExpiry('not-a-date', NOW)).toBeNull()
  })
})
