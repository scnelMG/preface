import { createReconstruction } from '@/features/reconstruction/api'
import type { CreateReconstructionResult } from '@/features/reconstruction/types'
import { ApiError, NetworkError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import {
  completeMultipartUpload,
  createUploadUrl,
  presignUploadParts,
  startMultipartUpload,
} from './api'
import { sha256Base64 } from './fileUtils'
import { putObject, StorageUploadError } from './putObject'
import type { CaptureTrace } from '@/features/live-capture/captureTrace'
import type { CreateUploadRequest, MultipartPartUrl, UploadPolicy } from './types'
import {
  MissingEtagError,
  partChecksums,
  uploadParts,
  type UploadPartsOptions,
} from './uploadParts'
import { issuesFromCap002, type VideoIssue } from './validateVideo'

/**
 * 영상 업로드 전체 흐름 (FN-CAP-02).
 *
 *   hashing     SHA-256(base64) 계산
 *   requesting  API-CAP-01 업로드 URL 발급
 *   uploading   스토리지에 직접 PUT (진행률)
 *   finalizing  API-REC-01 완료 통지 + 복원 작업 생성
 *
 * 실패하면 UploadFailure를 던진다. `resume`으로 다시 시도할 때 앞 단계를 건너뛴다.
 * - 해시는 파일이 같으면 다시 계산하지 않는다
 * - PUT까지 끝났는데 완료 통지만 실패했으면(네트워크) 같은 uploadId로 통지만 다시 한다(REC-01 멱등)
 *
 * 서버 정책에 `partSizeBytes`가 있고 영상이 그보다 크면 multipart로 올린다(S15P31B204-506):
 * 조각별 해시 → 시작(CAP-05) → 조각 병렬 PUT·조각 재시도 → 합치기(CAP-07) → REC-01.
 * 통신이 끊겨 다시 시도하면 끝난 조각은 건너뛰고 남은 조각 URL만 다시 받는다(CAP-06).
 */
export type UploadPhase = 'hashing' | 'requesting' | 'uploading' | 'finalizing'

export type UploadFailureKind =
  /** AUTH_023 등. 세션이 끝났다 */
  | 'session-ended'
  /** REC_002 진행 중인 3D 작업이 있다 */
  | 'job-conflict'
  /** CAP_001 얼굴 데이터 동의 없음·철회 */
  | 'consent-missing'
  /** CAP_002 형식·크기·길이 위반 */
  | 'invalid'
  /** CAP_003 객체 없음 · CAP_005 체크섬 불일치 · 스토리지 거부 → 처음부터 다시 올린다 */
  | 'reupload'
  /** CAP_004 업로드 만료 */
  | 'expired'
  /** 통신 끊김 */
  | 'network'
  /** 스토리지 설정 문제(조각 응답에 ETag 없음). 다시 올려도 같아 다시 시도하지 않는다 */
  | 'storage-config'
  | 'unknown'

export interface ResumePoint {
  checksum?: string
  /** PUT까지 끝난 업로드. 있으면 완료 통지만 다시 한다 */
  uploadId?: string
  /** multipart 조각 해시(조각 순서) */
  partChecksums?: string[]
  /** 진행 중인 multipart 업로드와 끝난 조각의 ETag. 있으면 남은 조각만 올린다 */
  multipart?: { uploadId: string; etags: Record<number, string> }
}

export class UploadFailure extends Error {
  readonly kind: UploadFailureKind
  readonly phase: UploadPhase
  readonly issues: VideoIssue[]
  readonly resume: ResumePoint

  constructor(
    kind: UploadFailureKind,
    phase: UploadPhase,
    resume: ResumePoint,
    options: { issues?: VideoIssue[]; cause?: unknown } = {},
  ) {
    super(`업로드 실패: ${kind} (${phase})`)
    this.name = 'UploadFailure'
    this.kind = kind
    this.phase = phase
    this.resume = resume
    this.issues = options.issues ?? []
    this.cause = options.cause
  }

  /** 같은 파일로 다시 시도할 수 있는가. 아니면 다시 찍거나 PC에서 처리해야 한다 */
  get retryable() {
    return (
      this.kind === 'reupload' ||
      this.kind === 'expired' ||
      this.kind === 'network' ||
      this.kind === 'unknown'
    )
  }
}

export interface UploadInput {
  file: Blob
  contentType: string
  durationMs: number
  /** 기종(-619). 있으면 업로드 요청에 함께 보낸다 */
  deviceModel?: string | null
  /** 웹 녹화 촬영 기록(-641). 있으면 함께 보낸다 */
  captureTrace?: CaptureTrace | null
}

/**
 * 업로드 요청에 붙일 촬영 정보. 업로드는 웹 녹화로만 하므로 촬영 방식은 늘 WEB_RECORDER다(-929).
 * 기종·기록은 값이 없으면 필드를 넣지 않는다
 */
function captureFields(
  input: UploadInput,
): Pick<CreateUploadRequest, 'captureMethod' | 'deviceModel' | 'captureTrace'> {
  const model = input.deviceModel?.trim().slice(0, 100)
  return {
    captureMethod: 'WEB_RECORDER',
    ...(model ? { deviceModel: model } : {}),
    ...(input.captureTrace ? { captureTrace: input.captureTrace } : {}),
  }
}

export interface UploadOptions {
  policy: UploadPolicy
  onPhase?: (phase: UploadPhase) => void
  /** 0~1. uploading 단계에서만 */
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
  resume?: ResumePoint
  /** 조각 재시도 대기(테스트용). 기본 1·2·4초 */
  partRetryDelaysMs?: UploadPartsOptions['retryDelaysMs']
}

export interface UploadResult {
  uploadId: string
  job: CreateReconstructionResult
}

export async function uploadVideo(
  input: UploadInput,
  options: UploadOptions,
): Promise<UploadResult> {
  const { onPhase, onProgress, signal, policy } = options
  let phase: UploadPhase = 'hashing'
  let checksum = options.resume?.checksum
  let uploadId = options.resume?.uploadId
  let sums = options.resume?.partChecksums
  let multipart = options.resume?.multipart
  const partSize = policy.partSizeBytes
  const useMultipart = !!partSize && input.file.size > partSize

  try {
    if (!checksum || (useMultipart && !sums)) {
      onPhase?.('hashing')
      checksum ??= await sha256Base64(input.file)
      if (useMultipart) sums = await partChecksums(input.file, partSize)
      throwIfAborted(signal)
    }

    if (!uploadId && useMultipart && partSize && sums) {
      phase = 'requesting'
      onPhase?.(phase)
      let urls: MultipartPartUrl[]
      if (multipart) {
        const left = sums.map((_, i) => i + 1).filter((n) => !multipart!.etags[n])
        urls = left.length ? (await presignUploadParts(multipart.uploadId, left, signal)).parts : []
      } else {
        const started = await startMultipartUpload(
          {
            contentType: input.contentType,
            sizeBytes: input.file.size,
            durationMs: input.durationMs,
            checksumSha256: checksum,
            partChecksums: sums,
            ...captureFields(input),
          },
          signal,
        )
        multipart = { uploadId: started.uploadId, etags: {} }
        urls = started.parts
      }

      phase = 'uploading'
      onPhase?.(phase)
      const { uploadId: id, etags } = multipart
      await uploadParts({
        file: input.file,
        partSizeBytes: partSize,
        urls,
        etags,
        refresh: async (numbers) => (await presignUploadParts(id, numbers, signal)).parts,
        onProgress,
        signal,
        retryDelaysMs: options.partRetryDelaysMs,
      })
      await completeMultipartUpload(
        id,
        Object.entries(etags).map(([n, etag]) => ({ partNumber: Number(n), etag })),
        signal,
      )
      uploadId = id
    }

    if (!uploadId) {
      phase = 'requesting'
      onPhase?.(phase)
      const target = await createUploadUrl(
        {
          contentType: input.contentType,
          sizeBytes: input.file.size,
          durationMs: input.durationMs,
          checksumSha256: checksum,
          ...captureFields(input),
        },
        signal,
      )

      phase = 'uploading'
      onPhase?.(phase)
      onProgress?.(0)
      await putObject({
        url: target.uploadUrl,
        headers: target.headers,
        body: input.file,
        onProgress,
        signal,
      })
      uploadId = target.uploadId
    }

    phase = 'finalizing'
    onPhase?.(phase)
    const job = await createReconstruction(uploadId)
    return { uploadId, job }
  } catch (error) {
    if (isAbort(error)) throw error
    throw classify(
      error,
      phase,
      { checksum, uploadId, partChecksums: sums, multipart },
      input,
      policy,
    )
  }
}

function classify(
  error: unknown,
  phase: UploadPhase,
  progress: ResumePoint,
  input: UploadInput,
  policy: UploadPolicy,
): UploadFailure {
  // 다시 올릴 때는 해시만 재사용한다. 새 URL을 받아 처음부터 PUT한다
  const restart: ResumePoint = {
    checksum: progress.checksum,
    partChecksums: progress.partChecksums,
  }
  // multipart는 통신이 끊겨도 끝난 조각을 살린다(같은 업로드에 남은 조각만)
  const keepParts: ResumePoint = progress.multipart
    ? { ...restart, multipart: progress.multipart }
    : restart

  if (error instanceof StorageUploadError) {
    return new UploadFailure(
      error.isNetwork ? 'network' : 'reupload',
      phase,
      error.isNetwork ? keepParts : restart,
      { cause: error },
    )
  }
  if (error instanceof MissingEtagError) {
    return new UploadFailure('storage-config', phase, restart, { cause: error })
  }
  if (error instanceof NetworkError) {
    // 완료 통지만 실패했다면 같은 uploadId로 통지만 다시 한다(멱등)
    return new UploadFailure('network', phase, phase === 'finalizing' ? progress : keepParts, {
      cause: error,
    })
  }
  if (!(error instanceof ApiError))
    return new UploadFailure('unknown', phase, restart, { cause: error })

  switch (error.code) {
    case ErrorCode.CAPTURE_SCOPE_FORBIDDEN:
    case ErrorCode.ACCESS_TOKEN_EXPIRED:
    case ErrorCode.UNAUTHORIZED:
      return new UploadFailure('session-ended', phase, restart, { cause: error })
    case ErrorCode.RECONSTRUCTION_IN_PROGRESS:
      return new UploadFailure('job-conflict', phase, restart, { cause: error })
    case ErrorCode.FACE_CONSENT_MISSING:
      return new UploadFailure('consent-missing', phase, restart, { cause: error })
    case ErrorCode.UPLOAD_INVALID:
      return new UploadFailure('invalid', phase, restart, {
        cause: error,
        issues: issuesFromCap002(error.details, input, policy),
      })
    case ErrorCode.UPLOAD_OBJECT_MISSING:
    case ErrorCode.UPLOAD_CHECKSUM_MISMATCH:
      return new UploadFailure('reupload', phase, restart, { cause: error })
    case ErrorCode.UPLOAD_EXPIRED:
      return new UploadFailure('expired', phase, restart, { cause: error })
    default:
      return new UploadFailure(
        error.isRetryable ? 'network' : 'unknown',
        phase,
        phase === 'finalizing' && error.isRetryable ? progress : restart,
        { cause: error },
      )
  }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('업로드를 취소했어요.', 'AbortError')
}

/** 실패 종류별 화면 문구. REC_002는 원래 팝업이지만 Modal(-273) 전이라 화면 안 문구로 둔다 */
export const FAILURE_COPY: Record<UploadFailureKind, { title: string; body: string }> = {
  'session-ended': {
    title: '연결이 끝났어요',
    body: 'PC에서 새 QR을 만들어 다시 스캔해 주세요.',
  },
  'job-conflict': {
    title: '3D는 한 번에 하나만 만들 수 있어요',
    body: '지금 만들고 있는 3D가 끝난 뒤에 다시 올려 주세요.',
  },
  'consent-missing': {
    title: '얼굴 데이터 동의가 필요해요',
    body: 'PC에서 내 정보 › 동의 기록을 확인해 주세요.',
  },
  invalid: {
    title: '이 영상은 올릴 수 없어요',
    body: '안내에 맞게 다시 찍어 주세요.',
  },
  reupload: {
    title: '업로드가 끝나지 않았어요',
    body: '영상이 제대로 올라가지 않았어요. 다시 올려 주세요.',
  },
  expired: {
    title: '업로드 시간이 지났어요',
    body: '다시 올려 주세요.',
  },
  network: {
    title: '인터넷 연결이 끊겼어요',
    body: '연결을 확인한 뒤 다시 올려 주세요.',
  },
  'storage-config': {
    title: '지금은 영상을 올릴 수 없어요',
    body: '서비스 설정 문제로 올리지 못했어요. 잠시 뒤 PC에서 새 QR을 만들어 다시 시도해 주세요.',
  },
  unknown: {
    title: '올리지 못했어요',
    body: '잠시 후 다시 올려 주세요.',
  },
}
