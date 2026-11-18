import { describe, expect, it } from 'vitest'
import { matchesEyeReview, readEyeReview } from './review'

describe('회원 GLB 눈 판정', () => {
  const hash = 'a'.repeat(64)

  it('눈별 판정을 그대로 읽는다', () => {
    expect(readEyeReview({ R: 'present', L: 'absent' }, hash)).toEqual({
      review: { R: 'present', L: 'absent' },
      eyePartsSha256: hash,
    })
  })

  it('예전 GLB와 불완전한 판정·해시는 모두 알 수 없음으로 잠근다', () => {
    const unknown = { review: { R: 'unknown', L: 'unknown' }, eyePartsSha256: null }
    expect(readEyeReview(undefined, undefined)).toEqual(unknown)
    expect(readEyeReview({ R: 'absent' }, hash)).toEqual(unknown)
    expect(readEyeReview({ R: 'absent', L: 'maybe' }, hash)).toEqual(unknown)
    expect(readEyeReview({ R: 'absent', L: 'present' }, undefined)).toEqual(unknown)
    expect(readEyeReview({ R: 'absent', L: 'present' }, 'A'.repeat(64))).toEqual(unknown)
  })

  it('현재 모델의 서버 판정과 GLB 판정·해시가 모두 같을 때만 연다', () => {
    const review = { R: 'present' as const, L: 'absent' as const }
    const asset = { key: 'sim:mesh-a', evidence: { review, eyePartsSha256: hash } }
    expect(matchesEyeReview(asset, 'sim:mesh-a', review, hash)).toBe(true)
    expect(matchesEyeReview(null, 'sim:mesh-a', review, hash)).toBe(false)
    expect(matchesEyeReview(asset, 'sim:mesh-b', review, hash)).toBe(false)
    expect(matchesEyeReview(asset, 'sim:mesh-a', { R: 'absent', L: 'absent' }, hash)).toBe(false)
    expect(matchesEyeReview(asset, 'sim:mesh-a', review, 'b'.repeat(64))).toBe(false)
    expect(matchesEyeReview(asset, 'sim:mesh-a', review, null)).toBe(false)
  })
})
