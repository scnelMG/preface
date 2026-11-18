import type { EyeReview } from './state'

export interface EyeReviewEvidence {
  review: EyeReview
  eyePartsSha256: string | null
}

const unknown = (): EyeReviewEvidence => ({
  review: { R: 'unknown', L: 'unknown' },
  eyePartsSha256: null,
})

export function readEyeReview(value: unknown, hash: unknown): EyeReviewEvidence {
  if (!value || typeof value !== 'object' || typeof hash !== 'string') return unknown()
  const review = value as Record<string, unknown>
  if (
    (review.R === 'present' || review.R === 'absent') &&
    (review.L === 'present' || review.L === 'absent') &&
    /^[0-9a-f]{64}$/.test(hash)
  ) {
    return { review: { R: review.R, L: review.L }, eyePartsSha256: hash }
  }
  return unknown()
}

export function matchesEyeReview(
  asset: { key: string; evidence: EyeReviewEvidence } | null,
  key: string,
  serverReview: EyeReview | null | undefined,
  serverHash: string | null | undefined,
): boolean {
  return Boolean(
    asset?.key === key &&
    serverHash &&
    asset.evidence.eyePartsSha256 === serverHash &&
    serverReview &&
    asset.evidence.review.L === serverReview.L &&
    asset.evidence.review.R === serverReview.R,
  )
}
