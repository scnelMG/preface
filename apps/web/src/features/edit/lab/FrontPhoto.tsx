'use client'

import { useEffect, useState } from 'react'
import { PRIVATE_MEDIA } from '@/shared/analytics'
import { getFrontPhoto } from '../api'

/**
 * 실험실에서 촬영한 내 정면 사진을 3D 옆에 본다(S15P31B204-599). 조절 카드의 방식 탭 `원본 사진`으로 연다(S15P31B204-770,
 * 전에는 툴바 동그라미 버튼이 카드를 덮었다 -624). 사진은 3D 완성 때 보관한 5방향 사진 중 정면 한 장(BE -604).
 * 사진이 없으면(예전 3D·체험 모델) 탭도 없다.
 */

/** 주소 만료(10분) 이만큼 전에 새로 받는다 */
const REFRESH_BEFORE_MS = 60_000
/** 만료 시각이 이상해도 너무 자주 부르지 않는다 */
const MIN_REFRESH_MS = 30_000

/**
 * 정면 사진 주소. 없거나(404) 못 받으면 null. 만료 전에 다시 받는다. 서버 렌더에는 주소가 없다(effect에서 받는다).
 * 운영에서도 보인다(S15P31B204-770, 2026-11-11 사용자 결정): 처리방침 2026-11-v4·얼굴 데이터 동의서 2026-11-v3에
 * "정면 사진 1장을 본인 편집실 비교 화면에 표시" 목적을 더했다. 전에는 개정 전이라 개발 서버·로컬에서만 켰다.
 * AI 관상 카드도 3D 완성 뒤 관상 사진 대신 이 훅으로 같은 사진을 보여 준다(S15P31B204-891, 같은 문서에 목적을 더함).
 */
export function useFrontPhoto(faceModelId: string | null | undefined) {
  const [photo, setPhoto] = useState<{ faceModelId: string; url: string } | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!faceModelId) return
    const controller = new AbortController()
    let timer = 0
    getFrontPhoto(faceModelId, controller.signal)
      .then((result) => {
        setPhoto({ faceModelId, url: result.url })
        const wait = Date.parse(result.expiresAt) - Date.now() - REFRESH_BEFORE_MS
        timer = window.setTimeout(
          () => setRound((value) => value + 1),
          Number.isFinite(wait) ? Math.max(wait, MIN_REFRESH_MS) : MIN_REFRESH_MS,
        )
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhoto(null)
      })
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [faceModelId, round])

  return photo && photo.faceModelId === faceModelId ? photo.url : null
}

const PHOTO_ALT = '촬영한 내 정면 사진'

/**
 * `원본 사진` 탭 내용. 조절 카드(휴대폰은 아래 시트) 높이를 채우고, 사진 비율과 카드 비율이 달라도 얼굴이 잘리지 않게
 * 다 보인다(contain). 카드 높이는 상담과 같은 고정 높이라 탭을 바꿔도 카드가 움직이지 않는다(service.css data-mode='photo')
 */
export function FrontPhotoView({ url }: { url: string }) {
  return (
    <figure className="pf-front-photo mt-(--space-16) flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--pf-radius-md) bg-(--pf-canvas-deep)">
      {/* presigned 주소라 next/image 최적화를 거치지 않는다 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...PRIVATE_MEDIA}
        src={url}
        alt={PHOTO_ALT}
        className="min-h-0 w-full flex-1 object-contain"
      />
      <figcaption className="shrink-0 bg-surface px-(--space-4) pt-(--space-10) type-caption text-muted-soft">
        촬영한 내 얼굴이에요. 나만 볼 수 있어요.
      </figcaption>
    </figure>
  )
}
