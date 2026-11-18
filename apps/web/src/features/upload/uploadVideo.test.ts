import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failResponse, okResponse } from '@/features/capture/testing'
import { ErrorCode } from '@/shared/api/errorCodes'
import { sha256Base64 } from './fileUtils'
import { DEFAULT_UPLOAD_POLICY } from './policy'
import {
  FAKE_SIGNED_URL,
  FakeXhr,
  JOB_RESPONSE,
  fakeVideo,
  hang,
  networkDown,
  respondWith,
  succeed,
  uploadUrlResponse,
  type XhrBehavior,
} from './testing'
import { FAILURE_COPY, UploadFailure, uploadVideo, type UploadPhase } from './uploadVideo'

const file = fakeVideo()
const input = { file, contentType: 'video/quicktime', durationMs: 36_000 }
let checksum: string

function calls() {
  return vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    path: new URL(String(url)).pathname.replace('/api/v1', ''),
    method: init?.method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  }))
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e)
  expect(error).toBeInstanceOf(UploadFailure)
  return error as UploadFailure
}

describe('sha256Base64', () => {
  it('SHA-256을 base64로 만든다 (표준 예: "abc")', async () => {
    expect(await sha256Base64(new Blob(['abc']))).toBe(
      'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
    )
  })
})

describe('uploadVideo — CAP-01 → S3 PUT → REC-01', () => {
  beforeEach(async () => {
    checksum = await sha256Base64(file)
    FakeXhr.reset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('성공: 해시 → URL 발급 → 원본 PUT(진행률) → 완료 통지', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    const phases: UploadPhase[] = []
    const progress: number[] = []

    const result = await uploadVideo(input, {
      policy: DEFAULT_UPLOAD_POLICY,
      onPhase: (p) => phases.push(p),
      onProgress: (r) => progress.push(r),
    })

    expect(result).toEqual({ uploadId: 'up-1', job: JOB_RESPONSE })
    expect(phases).toEqual(['hashing', 'requesting', 'uploading', 'finalizing'])
    expect(progress).toEqual([0, 0.5, 1, 1])

    const [create, finalize] = calls()
    expect(create).toEqual({
      path: '/uploads',
      method: 'POST',
      body: {
        contentType: 'video/quicktime',
        sizeBytes: file.size,
        durationMs: 36_000,
        checksumSha256: checksum,
        // 업로드는 웹 녹화로만 한다(-929)
        captureMethod: 'WEB_RECORDER',
      },
    })
    expect(finalize).toEqual({
      path: '/reconstructions',
      method: 'POST',
      body: { uploadId: 'up-1' },
    })

    // 원본 파일 그대로, 서명 헤더 그대로 PUT한다
    const [put] = FakeXhr.instances
    expect(put.method).toBe('PUT')
    expect(put.body).toBe(file)
    expect(put.headers).toEqual({
      'Content-Type': 'video/quicktime',
      'x-amz-server-side-encryption': 'AES256',
      'x-amz-checksum-sha256': checksum,
    })
  })

  it('PUT 중 통신이 끊기면 network — 다시 시도할 때 해시는 재사용하고 새 URL을 받는다', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum, 'up-2'), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = [networkDown]

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))
    expect(failure.kind).toBe('network')
    expect(failure.phase).toBe('uploading')
    expect(failure.retryable).toBe(true)
    expect(failure.resume).toEqual({ checksum, uploadId: undefined })

    const phases: UploadPhase[] = []
    const result = await uploadVideo(input, {
      policy: DEFAULT_UPLOAD_POLICY,
      resume: failure.resume,
      onPhase: (p) => phases.push(p),
    })
    expect(phases).toEqual(['requesting', 'uploading', 'finalizing'])
    expect(result.uploadId).toBe('up-2')
  })

  it('서명 URL은 에러 메시지에 남지 않는다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
    FakeXhr.behaviors = [respondWith(403)]

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))

    expect(failure.kind).toBe('reupload')
    expect(failure.message).not.toContain(FAKE_SIGNED_URL)
    expect(String((failure.cause as Error).message)).not.toContain('storage.invalid')
  })

  it('S3가 체크섬 불일치(400 BadDigest)로 거부하면 reupload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
    FakeXhr.behaviors = [respondWith(400)]

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))
    expect(failure.kind).toBe('reupload')
    expect(failure.resume.uploadId).toBeUndefined()
  })

  it('완료 통지만 통신 실패하면 같은 uploadId로 통지만 다시 한다(REC-01 멱등)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 200))

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))
    expect(failure.kind).toBe('network')
    expect(failure.phase).toBe('finalizing')
    expect(failure.resume).toEqual({ checksum, uploadId: 'up-1' })

    const result = await uploadVideo(input, {
      policy: DEFAULT_UPLOAD_POLICY,
      resume: failure.resume,
    })
    expect(result.job.jobId).toBe('job-1')
    expect(FakeXhr.instances).toHaveLength(1)
    expect(calls().map((c) => c.path)).toEqual(['/uploads', '/reconstructions', '/reconstructions'])
  })

  it.each([
    [409, ErrorCode.UPLOAD_OBJECT_MISSING, 'reupload'],
    [409, ErrorCode.UPLOAD_CHECKSUM_MISMATCH, 'reupload'],
    [410, ErrorCode.UPLOAD_EXPIRED, 'expired'],
    [409, ErrorCode.RECONSTRUCTION_IN_PROGRESS, 'job-conflict'],
    [403, ErrorCode.FACE_CONSENT_MISSING, 'consent-missing'],
    [403, ErrorCode.CAPTURE_SCOPE_FORBIDDEN, 'session-ended'],
    [500, ErrorCode.INTERNAL_ERROR, 'unknown'],
  ])('완료 통지 %s %s → %s', async (status, code, kind) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(failResponse(status, code))

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))
    expect(failure.kind).toBe(kind)
    expect(failure.phase).toBe('finalizing')
    // 다시 올릴 때는 처음부터(새 URL). 해시만 재사용
    expect(failure.resume).toEqual({ checksum })
  })

  it.each([
    [409, ErrorCode.RECONSTRUCTION_IN_PROGRESS, 'job-conflict', false],
    [403, ErrorCode.FACE_CONSENT_MISSING, 'consent-missing', false],
    [403, ErrorCode.CAPTURE_SCOPE_FORBIDDEN, 'session-ended', false],
    [401, ErrorCode.ACCESS_TOKEN_EXPIRED, 'session-ended', false],
  ])('URL 발급 %s %s → %s (PUT하지 않는다)', async (status, code, kind, retryable) => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(status, code))

    const failure = await failureOf(uploadVideo(input, { policy: DEFAULT_UPLOAD_POLICY }))
    expect(failure.kind).toBe(kind)
    expect(failure.retryable).toBe(retryable)
    expect(FakeXhr.instances).toHaveLength(0)
  })

  it('CAP_002 details를 문제 목록으로 바꾼다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      failResponse(400, ErrorCode.UPLOAD_INVALID, [
        { field: 'durationMs', reason: 'minDurationMs=25000,maxDurationMs=45000' },
      ]),
    )

    const failure = await failureOf(
      uploadVideo({ ...input, durationMs: 50_000 }, { policy: DEFAULT_UPLOAD_POLICY }),
    )
    expect(failure.kind).toBe('invalid')
    expect(failure.retryable).toBe(false)
    expect(failure.issues).toEqual([{ kind: 'too-long', maxDurationMs: 45_000 }])
  })

  it('취소하면 AbortError를 그대로 던진다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
    FakeXhr.behaviors = [hang]
    const controller = new AbortController()

    const promise = uploadVideo(input, {
      policy: DEFAULT_UPLOAD_POLICY,
      signal: controller.signal,
      onPhase: (p) => {
        if (p === 'uploading') queueMicrotask(() => controller.abort())
      },
    })

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('uploadVideo — 촬영 방식·기종 (S15P31B204-619)', () => {
  beforeEach(async () => {
    checksum = await sha256Base64(file)
    FakeXhr.reset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('captureMethod는 늘 WEB_RECORDER로, deviceModel은 있으면 CAP-01 본문에 싣는다(-929)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))

    await uploadVideo({ ...input, deviceModel: 'iPhone 16 Pro' }, { policy: DEFAULT_UPLOAD_POLICY })

    expect(calls()[0]!.body).toEqual({
      contentType: 'video/quicktime',
      sizeBytes: file.size,
      durationMs: 36_000,
      checksumSha256: checksum,
      captureMethod: 'WEB_RECORDER',
      deviceModel: 'iPhone 16 Pro',
    })
  })

  it('기종을 모르면 deviceModel은 빼고, 100자를 넘으면 자른다', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))

    await uploadVideo({ ...input, deviceModel: null }, { policy: DEFAULT_UPLOAD_POLICY })
    await uploadVideo({ ...input, deviceModel: 'x'.repeat(120) }, { policy: DEFAULT_UPLOAD_POLICY })

    const [first, , second] = calls()
    expect(first!.body).toMatchObject({ captureMethod: 'WEB_RECORDER' })
    expect(first!.body).not.toHaveProperty('deviceModel')
    expect(second!.body.deviceModel).toHaveLength(100)
  })

  it('웹 녹화 촬영 기록(captureTrace)은 있을 때만 CAP-01 본문에 싣는다(-641)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    // 합성 값
    const captureTrace = {
      version: 1 as const,
      guideVersion: 'g',
      trackerVersion: 't',
      meta: {
        durationMs: 1,
        stopReason: 'complete' as const,
        stepsDone: 6,
        stepsTotal: 6,
        mimeType: 'video/mp4',
        bothSides: true,
      },
      steps: [{ name: 'recleft', startMs: 0, endMs: 50 }],
      trace: [[0, 55, -1, 1] as [number, number, number, 1]],
      trackSettings: {},
    }

    await uploadVideo({ ...input, captureTrace }, { policy: DEFAULT_UPLOAD_POLICY })
    await uploadVideo({ ...input, captureTrace: null }, { policy: DEFAULT_UPLOAD_POLICY })

    const [first, , second] = calls()
    expect(first!.body.captureTrace).toEqual(captureTrace)
    expect(second!.body).not.toHaveProperty('captureTrace')
  })
})

describe('uploadVideo — multipart (S15P31B204-506)', () => {
  // 합성 20바이트, 조각 8바이트 → 3조각(8·8·4)
  const big = fakeVideo({ content: 'synthetic-video-part' })
  const bigInput = { file: big, contentType: 'video/quicktime', durationMs: 36_000 }
  const policy = { ...DEFAULT_UPLOAD_POLICY, partSizeBytes: 8 }
  const noWait = [0, 0, 0]
  let sums: string[]

  const partUrl = (n: number) => ({
    partNumber: n,
    url: `${FAKE_SIGNED_URL}&part=${n}`,
    headers: { 'x-amz-checksum-sha256': sums[n - 1] },
  })
  const started = (numbers = [1, 2, 3]) =>
    okResponse(
      { uploadId: 'mp-1', partSizeBytes: 8, parts: numbers.map(partUrl), expiresAt: 'x' },
      201,
    )
  const reissued = (numbers: number[]) =>
    okResponse({ parts: numbers.map(partUrl), expiresAt: 'x' })
  const noContent = () => okResponse(undefined, 204)
  const putParts = () =>
    FakeXhr.instances.map((x) => Number(new URL(x.url).searchParams.get('part')))

  beforeEach(async () => {
    checksum = await sha256Base64(big)
    sums = await Promise.all(
      [big.slice(0, 8), big.slice(8, 16), big.slice(16)].map((b) => sha256Base64(b)),
    )
    FakeXhr.reset()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('멀티파트 시작 요청에도 captureMethod·deviceModel을 싣는다(-619)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = []

    await uploadVideo({ ...bigInput, deviceModel: 'SM-S921N' }, { policy })

    expect(calls()[0]).toMatchObject({
      path: '/uploads/multipart',
      body: { captureMethod: 'WEB_RECORDER', deviceModel: 'SM-S921N', partChecksums: sums },
    })
  })

  it('조각 크기보다 크면 조각 해시 → 시작 → 조각 PUT → 합치기 → 완료 통지', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = []
    const phases: UploadPhase[] = []
    const progress: number[] = []

    const result = await uploadVideo(bigInput, {
      policy,
      onPhase: (p) => phases.push(p),
      onProgress: (r) => progress.push(r),
    })

    expect(result.uploadId).toBe('mp-1')
    expect(phases).toEqual(['hashing', 'requesting', 'uploading', 'finalizing'])
    expect(progress.at(-1)).toBe(1)
    const [start, complete, finalize] = calls()
    expect(start).toMatchObject({
      path: '/uploads/multipart',
      body: { sizeBytes: 20, checksumSha256: checksum, partChecksums: sums },
    })
    expect(complete).toEqual({
      path: '/uploads/mp-1/complete',
      method: 'POST',
      body: {
        parts: [1, 2, 3].map((n) => ({ partNumber: n, etag: '"etag"' })),
      },
    })
    expect(finalize.body).toEqual({ uploadId: 'mp-1' })
    expect(putParts().sort()).toEqual([1, 2, 3])
    expect(FakeXhr.instances.map((x) => (x.body as Blob).size).sort()).toEqual([4, 8, 8])
  })

  it('한 조각이 끊기면 그 조각만 다시 보낸다', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = [networkDown]

    await uploadVideo(bigInput, { policy, partRetryDelaysMs: noWait })

    expect(FakeXhr.instances).toHaveLength(4)
    expect(putParts().filter((n) => n === 1)).toHaveLength(2)
  })

  it('조각 URL이 만료(403)되면 그 조각 URL만 다시 받아 이어 간다', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(reissued([1]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    FakeXhr.behaviors = [respondWith(403)]

    await uploadVideo(bigInput, { policy, partRetryDelaysMs: noWait })

    expect(calls()[1]).toMatchObject({ path: '/uploads/mp-1/parts', body: { partNumbers: [1] } })
  })

  it('재시도까지 끊기면 network — 다시 시도할 때 끝난 조각은 건너뛰고 남은 조각 URL만 받는다', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(started())
      .mockResolvedValueOnce(reissued([1]))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))
    // 보내는 순서: 조각 1(끊김) → 2 → 3 → 조각 1 재시도(또 끊김)
    FakeXhr.behaviors = [networkDown, succeed, succeed, networkDown]
    const failure = await failureOf(uploadVideo(bigInput, { policy, partRetryDelaysMs: [0] }))

    expect(failure.kind).toBe('network')
    expect(failure.retryable).toBe(true)
    expect(failure.resume.multipart?.uploadId).toBe('mp-1')
    expect(Object.keys(failure.resume.multipart?.etags ?? {}).sort()).toEqual(['2', '3'])

    FakeXhr.reset()
    const phases: UploadPhase[] = []
    const result = await uploadVideo(bigInput, {
      policy,
      resume: failure.resume,
      onPhase: (p) => phases.push(p),
    })
    expect(phases).toEqual(['requesting', 'uploading', 'finalizing'])
    expect(result.uploadId).toBe('mp-1')
    expect(calls()[1]).toMatchObject({ path: '/uploads/mp-1/parts', body: { partNumbers: [1] } })
    expect(putParts()).toEqual([1])
  })

  it('조각 응답에 ETag가 없으면(버킷 CORS 설정) storage-config — 다시 올려도 같으니 다시 시도하지 않는다', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(started())
    const noEtag: XhrBehavior = (xhr) => {
      xhr.etag = null
      succeed(xhr)
    }
    FakeXhr.behaviors = [noEtag, noEtag, noEtag]

    const failure = await failureOf(uploadVideo(bigInput, { policy, partRetryDelaysMs: noWait }))

    expect(failure.kind).toBe('storage-config')
    expect(failure.retryable).toBe(false)
    expect(FAILURE_COPY['storage-config'].title).toBe('지금은 영상을 올릴 수 없어요')
    // 같은 조각을 다시 보내지 않는다(3조각을 한 번씩만)
    expect(FakeXhr.instances.length).toBeLessThanOrEqual(3)
    // 합치기·완료 통지는 부르지 않는다
    expect(calls()).toHaveLength(1)
  })

  it('조각 크기보다 작은 영상은 지금처럼 PUT 한 번', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(okResponse(uploadUrlResponse(checksum), 201))
      .mockResolvedValueOnce(okResponse(JOB_RESPONSE, 202))

    await uploadVideo(bigInput, { policy: { ...policy, partSizeBytes: 64 } })

    expect(calls().map((c) => c.path)).toEqual(['/uploads', '/reconstructions'])
  })
})
