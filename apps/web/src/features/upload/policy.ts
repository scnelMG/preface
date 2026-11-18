import type { UploadPolicy } from './types'

/**
 * API-CAP-02를 못 받았을 때 쓰는 기본값. 명세서 CAP-02 비고와 같은 값이다.
 * 최종 검사는 서버(CAP-01)가 한다. 이 값은 올리기 전에 미리 알려 주는 용도다.
 */
export const DEFAULT_UPLOAD_POLICY: UploadPolicy = {
  video: {
    allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSizeBytes: 262_144_000,
    minDurationMs: 20_000,
    maxDurationMs: 75_000,
    recommendedDurationMs: 25_000,
  },
  uploadUrlTtlSec: 600,
}

/** 확장자 → MIME. 휴대폰 브라우저가 `file.type`을 비워 보낼 때 쓴다 */
const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
}

/** 사용자에게 보여 줄 형식 이름 */
const TYPE_LABELS: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/**
 * 파일의 MIME을 정한다. `file.type`이 있으면 그대로, 없으면 확장자로 추정한다.
 * 모르면 null — 형식 위반으로 다룬다.
 */
export function resolveContentType(file: Pick<File, 'name' | 'type'>): string | null {
  if (file.type) return file.type.toLowerCase()
  const ext = file.name.split('.').pop()?.toLowerCase()
  return (ext && EXTENSION_TYPES[ext]) || null
}

export function formatTypeList(types: readonly string[]): string {
  return types.map((t) => TYPE_LABELS[t] ?? t.replace(/^video\//, '')).join('·')
}

export function formatSeconds(ms: number): number {
  return Math.round(ms / 1000)
}

export function formatMegabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}

/** 영상 길이 표시 `0:36` */
export function formatClock(ms: number): string {
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
