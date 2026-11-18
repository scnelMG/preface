/**
 * 테스트용 가짜 XHR·영상. 실제 서명 URL·얼굴 영상을 쓰지 않는다.
 */

export type XhrBehavior = (xhr: FakeXhr) => void

/** 기본 동작: 50%·100% 진행률을 보내고 200으로 끝난다 */
export const succeed: XhrBehavior = (xhr) => {
  queueMicrotask(() => {
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 } as ProgressEvent)
    xhr.status = 200
    xhr.onload?.()
  })
}

export const respondWith =
  (status: number): XhrBehavior =>
  (xhr) => {
    queueMicrotask(() => {
      xhr.status = status
      xhr.onload?.()
    })
  }

export const networkDown: XhrBehavior = (xhr) => {
  queueMicrotask(() => xhr.onerror?.())
}

/** 응답을 보내지 않는다(취소 테스트) */
export const hang: XhrBehavior = () => {}

export class FakeXhr {
  static instances: FakeXhr[] = []
  static behaviors: XhrBehavior[] = []

  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null

  /** S3 응답 ETag 자리(합성 값) */
  etag: string | null = '"etag"'

  getResponseHeader(name: string) {
    return name.toLowerCase() === 'etag' ? this.etag : null
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
    FakeXhr.instances.push(this)
    const behavior = FakeXhr.behaviors.shift() ?? succeed
    behavior(this)
  }
  abort() {
    this.onabort?.()
  }

  static reset() {
    FakeXhr.instances = []
    FakeXhr.behaviors = []
  }
}

/** 합성 영상 파일. 내용은 의미 없는 바이트다 */
export function fakeVideo(
  options: { name?: string; type?: string; bytes?: number; content?: string } = {},
) {
  const { name = 'clip.mov', type = 'video/quicktime', content = 'synthetic-video' } = options
  const file = new File([content], name, { type })
  if (options.bytes !== undefined) Object.defineProperty(file, 'size', { value: options.bytes })
  return file
}

export const POLICY_RESPONSE = {
  video: {
    allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSizeBytes: 262144000,
    minDurationMs: 25000,
    maxDurationMs: 45000,
    recommendedDurationMs: 35000,
  },
  uploadUrlTtlSec: 600,
}

/** 서명 URL 자리. 테스트에서도 실제 주소 모양을 쓰지 않는다 */
export const FAKE_SIGNED_URL = 'https://storage.invalid/object?signature=redacted'

export function uploadUrlResponse(checksum: string, uploadId = 'up-1') {
  return {
    uploadId,
    uploadUrl: FAKE_SIGNED_URL,
    method: 'PUT',
    headers: {
      'Content-Type': 'video/quicktime',
      'x-amz-server-side-encryption': 'AES256',
      'x-amz-checksum-sha256': checksum,
    },
    expiresAt: '2026-10-22T06:40:00Z',
  }
}

export const JOB_RESPONSE = {
  jobId: 'job-1',
  status: 'QUEUED',
  queuePosition: 1,
  pollIntervalMs: 3000,
}
