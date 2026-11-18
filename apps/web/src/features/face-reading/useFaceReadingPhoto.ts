'use client'

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/features/auth/store'
import { ApiError } from '@/shared/api/ApiError'
import { getFaceReadingPhoto } from './api'

/** 사진을 못 받았을 때 다시 묻는 간격과 횟수. 관상 기록이 막 생긴 순간의 404 같은 잠깐의 실패를 넘긴다(-523) */
export const PHOTO_RETRY_MS = 2000
export const PHOTO_RETRIES = 3

/** 사진이 지워져(3D 완성) 다시 물어도 소용없음 */
const PHOTO_GONE = 'READ_002'

/**
 * 받은 관상 사진(jobId별). 서버 사진은 3D가 완성되면 지워지므로(READ_002), 한 번 받은 사진은 이 탭이 살아 있는 동안
 * 메모리에 둔다(S15P31B204-891). 전에는 화면이 숨겨지거나(cacheComponents의 Activity) 3D가 완성되면 사진이 사라졌다.
 * 로그아웃하면 비운다. 새로고침하면 사라진다(디스크에는 남기지 않는다).
 */
const photoCache = new Map<string, Blob>()
let unsubscribeAuth: (() => void) | null = null

function keepPhoto(jobId: string, blob: Blob) {
  photoCache.set(jobId, blob)
  // 같은 기기에서 다른 사람이 로그인할 수 있으니 회원 상태가 끝나면 비운다
  unsubscribeAuth ??= useAuthStore.subscribe((next, previous) => {
    if (previous.status === 'member' && next.status !== 'member') clearFaceReadingPhotoCache()
  })
}

/** 받아 둔 관상 사진이 있는지. 3D 완성 뒤 정면 사진을 따로 부를지 정할 때 쓴다 */
export function hasFaceReadingPhoto(jobId: string): boolean {
  return photoCache.has(jobId)
}

/** 받아 둔 관상 사진을 모두 비운다(로그아웃, 테스트) */
export function clearFaceReadingPhotoCache(): void {
  photoCache.clear()
  unsubscribeAuth?.()
  unsubscribeAuth = null
}

/**
 * 관상에 쓴 정면 사진을 받아 화면 안에서만 쓰는 주소(blob URL)로 준다(S15P31B204-452).
 *
 * - 받은 사진은 메모리(`photoCache`)에 두고, 다시 그릴 때(화면 복귀·3D 완성) 서버를 부르지 않고 거기서 주소를 만든다(-891).
 *   그래서 `enabled`가 false여도 받아 둔 사진이 있으면 준다. `enabled`는 서버에 새로 물어도 되는지만 정한다.
 * - 받을 수 없으면(3D 완성으로 지워짐 `READ_002`, 몇 번 다시 물어도 실패) null — 카드는 다른 사진이나 글만 보인다.
 * - 잠깐의 실패(404·네트워크)는 `PHOTO_RETRY_MS` 간격으로 `PHOTO_RETRIES`번까지 다시 묻는다.
 *   전에는 한 번 실패하면 다시 묻지 않아 새로고침해야 사진이 보였다(-523).
 * - 화면을 떠나면 주소는 풀지만(revoke) 사진은 로그아웃·새로고침 전까지 메모리에 남는다. 서버는 `no-store`라 브라우저
 *   캐시에는 남지 않는다.
 */
export function useFaceReadingPhoto(jobId: string, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const cached = photoCache.get(jobId)
    if (!cached && !enabled) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const show = (blob: Blob) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }
    const load = (attempt: number) => {
      getFaceReadingPhoto(jobId, controller.signal)
        .then((blob) => {
          if (controller.signal.aborted) return
          keepPhoto(jobId, blob)
          show(blob)
        })
        .catch((error: unknown) => {
          // 사진은 덤이다. 끝내 못 받으면 글만 보인다
          if (controller.signal.aborted) return
          if (error instanceof ApiError && error.code === PHOTO_GONE) return
          if (attempt < PHOTO_RETRIES) timer = setTimeout(() => load(attempt + 1), PHOTO_RETRY_MS)
        })
    }
    if (cached) void Promise.resolve(cached).then(show)
    else load(0)

    return () => {
      controller.abort()
      clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [jobId, enabled])

  return url
}
