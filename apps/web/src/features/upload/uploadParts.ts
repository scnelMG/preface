import { bytesToBase64 } from './fileUtils'
import { putObject, StorageUploadError } from './putObject'
import type { MultipartPartUrl } from './types'

/**
 * multipart 조각 올리기 (S15P31B204-506).
 *
 * 큰 영상을 `partSizeBytes`로 잘라 동시에 몇 개씩 S3에 직접 PUT한다. 한 조각이 끊기면 그 조각만 다시 보낸다
 * (단일 PUT은 끊기면 처음부터 다시 올려야 했다). 조각 URL이 만료됐으면(403) 서버에서 다시 받아 이어 간다.
 */

/** 조각 순서대로 SHA-256(base64). 조각 하나씩 읽어 메모리는 조각 크기만큼만 더 쓴다 */
export async function partChecksums(file: Blob, partSizeBytes: number): Promise<string[]> {
  const sums: string[] = []
  for (let start = 0; start < file.size; start += partSizeBytes) {
    const buffer = await file.slice(start, start + partSizeBytes).arrayBuffer()
    sums.push(bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))))
  }
  return sums
}

/** 스토리지 응답에 ETag가 없다(버킷 CORS ExposeHeaders 누락). 설정 문제라 다시 올려도 같다 */
export class MissingEtagError extends Error {
  constructor() {
    super('storage response has no ETag')
    this.name = 'MissingEtagError'
  }
}

export interface UploadPartsOptions {
  file: Blob
  partSizeBytes: number
  /** 아직 안 올린 조각의 서명 URL */
  urls: MultipartPartUrl[]
  /** 끝난 조각의 ETag. 성공할 때마다 여기에 채운다(실패해도 남아 다음 시도에서 건너뛴다) */
  etags: Record<number, string>
  /** 만료된 조각 URL을 다시 받는다(가칭 API-CAP-06) */
  refresh: (partNumbers: number[]) => Promise<MultipartPartUrl[]>
  /** 0~1. 끝난 조각 + 올리는 중인 조각 바이트 합 */
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
  /** 동시에 올리는 조각 수 */
  concurrency?: number
  /** 조각 하나를 다시 보내기 전 기다리는 시간(ms). 길이 = 재시도 횟수 */
  retryDelaysMs?: number[]
}

export const PART_CONCURRENCY = 3
export const PART_RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

export async function uploadParts(options: UploadPartsOptions): Promise<void> {
  const {
    file,
    partSizeBytes,
    etags,
    refresh,
    onProgress,
    signal,
    concurrency = PART_CONCURRENCY,
    retryDelaysMs = PART_RETRY_DELAYS_MS,
  } = options
  const partCount = Math.ceil(file.size / partSizeBytes)
  const urls = new Map(options.urls.map((u) => [u.partNumber, u]))
  const queue: number[] = []
  for (let n = 1; n <= partCount; n++) if (!etags[n]) queue.push(n)

  const sizeOf = (n: number) => Math.min(partSizeBytes, file.size - (n - 1) * partSizeBytes)
  const inFlight = new Map<number, number>()
  const report = () => {
    let sent = 0
    for (const n of Object.keys(etags)) sent += sizeOf(Number(n))
    for (const loaded of inFlight.values()) sent += loaded
    onProgress?.(Math.min(sent / file.size, 1))
  }

  async function sendPart(n: number) {
    const body = file.slice((n - 1) * partSizeBytes, (n - 1) * partSizeBytes + sizeOf(n))
    for (let attempt = 0; ; attempt++) {
      let target = urls.get(n)
      if (!target) {
        for (const fresh of await refresh([n])) urls.set(fresh.partNumber, fresh)
        target = urls.get(n)
        if (!target) throw new StorageUploadError(0)
      }
      try {
        const etag = await putObject({
          url: target.url,
          headers: target.headers,
          body,
          signal,
          onProgress: (r) => {
            inFlight.set(n, r * sizeOf(n))
            report()
          },
        })
        // ETag가 없으면 합칠 수 없다(버킷 CORS ExposeHeaders 누락). 다시 보내도 같으니 바로 실패
        if (!etag) throw new MissingEtagError()
        inFlight.delete(n)
        etags[n] = etag
        report()
        return
      } catch (error) {
        inFlight.delete(n)
        if (!(error instanceof StorageUploadError) || attempt >= retryDelaysMs.length) throw error
        if (error.status === 403)
          urls.delete(n) // 서명 만료: 새 URL을 받아 다시
        else if (!error.isNetwork && error.status < 500) throw error // 400 등은 다시 보내도 같다
        await wait(retryDelaysMs[attempt], signal)
      }
    }
  }

  // 작업자 N개가 큐에서 조각을 하나씩 꺼낸다. 하나가 끝내 실패하면 나머지도 멈춘다
  let failed: unknown = null
  const worker = async () => {
    while (queue.length > 0 && failed === null) {
      const n = queue.shift()!
      try {
        await sendPart(n)
      } catch (error) {
        failed ??= error
      }
    }
  }
  report()
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  if (failed !== null) throw failed
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('업로드를 취소했어요.', 'AbortError'))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('업로드를 취소했어요.', 'AbortError'))
      },
      { once: true },
    )
  })
}
