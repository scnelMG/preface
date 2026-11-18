import type { FieldError } from '@/shared/api/types'
import { formatMegabytes, formatSeconds, formatTypeList } from './policy'
import type { UploadPolicy } from './types'

/**
 * 올리기 전 영상 검사(FN-CAP-02 예외 "제한값 위반 → 업로드 전 FE에서 1차 안내, 서버도 거부").
 * 서버 거부(CAP_002)도 같은 모양으로 바꿔 같은 문구를 쓴다.
 */
export type VideoIssue =
  | { kind: 'type'; allowed: string[] }
  | { kind: 'size'; maxSizeBytes: number }
  | { kind: 'too-short'; minDurationMs: number }
  | { kind: 'too-long'; maxDurationMs: number }
  /** 브라우저가 길이를 읽지 못했다. CAP-01에 길이가 필수라 올릴 수 없다 */
  | { kind: 'duration-unknown' }

export interface VideoMeta {
  /** resolveContentType 결과. 모르면 null */
  contentType: string | null
  sizeBytes: number
  /** 읽지 못했으면 null */
  durationMs: number | null
}

export function validateVideo(meta: VideoMeta, policy: UploadPolicy): VideoIssue[] {
  const { video } = policy
  const issues: VideoIssue[] = []

  if (!meta.contentType || !video.allowedContentTypes.includes(meta.contentType)) {
    issues.push({ kind: 'type', allowed: video.allowedContentTypes })
  }
  if (meta.sizeBytes > video.maxSizeBytes) {
    issues.push({ kind: 'size', maxSizeBytes: video.maxSizeBytes })
  }
  if (meta.durationMs === null || !Number.isFinite(meta.durationMs)) {
    issues.push({ kind: 'duration-unknown' })
  } else if (meta.durationMs < video.minDurationMs) {
    issues.push({ kind: 'too-short', minDurationMs: video.minDurationMs })
  } else if (meta.durationMs > video.maxDurationMs) {
    issues.push({ kind: 'too-long', maxDurationMs: video.maxDurationMs })
  }
  return issues
}

export function issueMessage(issue: VideoIssue): string {
  switch (issue.kind) {
    case 'type':
      return `${formatTypeList(issue.allowed)} 영상만 올릴 수 있어요.`
    case 'size':
      return `영상 용량이 너무 커요. ${formatMegabytes(issue.maxSizeBytes)}MB 이하로 찍어 주세요.`
    case 'too-short':
      return `영상이 너무 짧아요. ${formatSeconds(issue.minDurationMs)}초 이상 찍어 주세요.`
    case 'too-long':
      return `영상이 너무 길어요. ${formatSeconds(issue.maxDurationMs)}초 이하로 찍어 주세요.`
    case 'duration-unknown':
      return '영상 길이를 확인하지 못했어요. 다시 찍어 주세요.'
  }
}

/** `"minDurationMs=25000,maxDurationMs=45000"` → `{ minDurationMs: 25000, maxDurationMs: 45000 }` */
function parseReason(reason: string): Record<string, number> {
  const values: Record<string, number> = {}
  for (const pair of reason.split(',')) {
    const [key, raw] = pair.split('=').map((s) => s.trim())
    const value = Number(raw)
    if (key && raw !== undefined && Number.isFinite(value)) values[key] = value
  }
  return values
}

/**
 * 서버 거부 `CAP_002`의 details를 VideoIssue로 바꾼다(명세서 v2.8 CAP-01).
 * 예: `[{ field: "sizeBytes", reason: "maxSizeBytes=262144000" },
 *       { field: "durationMs", reason: "minDurationMs=25000,maxDurationMs=45000" }]`
 * 서버 값이 FE 정책과 다를 수 있으니 서버 값을 쓴다. 모르는 필드는 버린다.
 */
export function issuesFromCap002(
  details: FieldError[],
  sent: { durationMs: number },
  policy: UploadPolicy,
): VideoIssue[] {
  const issues: VideoIssue[] = []
  for (const { field, reason } of details) {
    const values = parseReason(reason ?? '')
    if (field === 'contentType') {
      issues.push({ kind: 'type', allowed: policy.video.allowedContentTypes })
    } else if (field === 'sizeBytes') {
      issues.push({
        kind: 'size',
        maxSizeBytes: values.maxSizeBytes ?? policy.video.maxSizeBytes,
      })
    } else if (field === 'durationMs') {
      const min = values.minDurationMs ?? policy.video.minDurationMs
      const max = values.maxDurationMs ?? policy.video.maxDurationMs
      issues.push(
        sent.durationMs > max
          ? { kind: 'too-long', maxDurationMs: max }
          : { kind: 'too-short', minDurationMs: min },
      )
    }
  }
  return issues
}
