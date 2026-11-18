import { describe, expect, it } from 'vitest'
import { FACE_READING_OPEN_AT, isFaceReadingEnabled } from './flag'

const prod = { hostname: 'example.com', port: '' }

describe('isFaceReadingEnabled', () => {
  it('운영 공개 시각은 2026-11-03 00:00 KST다', () => {
    expect(FACE_READING_OPEN_AT).toBe(Date.parse('2026-11-02T15:00:00Z'))
  })

  it('공개 전에는 개발 서버(:8080)와 로컬에서만 켠다', () => {
    const before = FACE_READING_OPEN_AT - 1
    expect(isFaceReadingEnabled({ hostname: 'example.com', port: '8080' }, before)).toBe(true)
    expect(isFaceReadingEnabled({ hostname: 'localhost', port: '3000' }, before)).toBe(true)
    expect(isFaceReadingEnabled({ hostname: '127.0.0.1', port: '3000' }, before)).toBe(true)
    expect(isFaceReadingEnabled(prod, before)).toBe(false)
  })

  it('공개 시각부터는 운영에서도 켠다', () => {
    expect(isFaceReadingEnabled(prod, FACE_READING_OPEN_AT)).toBe(true)
  })
})
