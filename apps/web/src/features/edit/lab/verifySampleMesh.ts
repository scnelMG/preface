import type { SampleHead } from '@/features/studio/samples'

/** 현재 브라우저가 받은 공개 기본 모델이 승인된 manifest 버전인지 확인한다. */
export async function verifySampleMesh(sample: SampleHead, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(sample.meshUrl, { signal, cache: 'force-cache' })
  if (!response.ok) return false
  const bytes = await response.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const sha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  return sha === sample.eyeReview.sha256
}
