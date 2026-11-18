/**
 * presigned URL로 스토리지에 직접 PUT한다. Spring은 파일 바이트를 중계하지 않는다(명세서 "파일").
 *
 * fetch는 업로드 진행률을 주지 않아 XHR을 쓴다(`upload.onprogress`).
 * **URL은 서명 URL이다. 에러 메시지·로그에 넣지 않는다.**
 */

export class StorageUploadError extends Error {
  /** 0이면 네트워크 오류(응답 없음) */
  readonly status: number

  constructor(status: number) {
    super(status === 0 ? '스토리지 연결 실패' : `스토리지 응답 ${status}`)
    this.name = 'StorageUploadError'
    this.status = status
  }

  get isNetwork() {
    return this.status === 0
  }
}

export interface PutObjectOptions {
  url: string
  /** CAP-01이 내려준 서명 헤더 그대로 */
  headers: Record<string, string>
  body: Blob
  /** 0~1 */
  onProgress?: (ratio: number) => void
  signal?: AbortSignal
}

/** 성공하면 응답 `ETag`를 돌려준다(multipart 완료에 쓴다, S15P31B204-506). 버킷 CORS가 노출하지 않으면 null */
export function putObject({ url, headers, body, onProgress, signal }: PutObjectOptions) {
  return new Promise<string | null>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('업로드를 취소했어요.', 'AbortError'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve(xhr.getResponseHeader('ETag'))
      } else {
        reject(new StorageUploadError(xhr.status))
      }
    }
    xhr.onerror = () => reject(new StorageUploadError(0))
    xhr.ontimeout = () => reject(new StorageUploadError(0))
    xhr.onabort = () => reject(new DOMException('업로드를 취소했어요.', 'AbortError'))

    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}
