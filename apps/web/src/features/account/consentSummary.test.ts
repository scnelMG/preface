import { describe, expect, it } from 'vitest'
import type { ConsentRecord } from '@/features/auth/types'
import { formatDate, summarizeConsents } from './consentSummary'

function record(over: Partial<ConsentRecord>): ConsentRecord {
  return {
    consentType: 'TERMS',
    title: '서비스 이용약관',
    version: '2026-10-v1',
    effectiveAt: '2026-10-01T00:00:00Z',
    status: 'AGREED',
    agreedAt: '2026-10-19T03:00:00Z',
    withdrawnAt: null,
    isLatestVersion: true,
    ...over,
  }
}

describe('formatDate', () => {
  it('UTC 시각을 한국 날짜로 쓴다', () => {
    expect(formatDate('2026-10-18T16:00:00Z')).toBe('2026.10.19')
  })
})

describe('summarizeConsents', () => {
  it('버전이 섞이고 새 버전이 있으면 그렇게 적는다', () => {
    const summary = summarizeConsents([
      record({ consentType: 'TERMS' }),
      record({ consentType: 'PRIVACY', version: '2026-11-v2', isLatestVersion: false }),
      record({ consentType: 'FACE_DATA', agreedAt: '2026-10-20T03:00:00Z' }),
      record({ consentType: 'FACE_PUBLIC' }),
    ])
    expect(summary).toEqual({
      complete: true,
      line: '동의함 · 2026.10.20 · 버전 여러 개 · 새 버전 있음',
    })
  })

  it('기록이 빠지면 complete가 false다', () => {
    expect(summarizeConsents([record({})]).complete).toBe(false)
  })
})
