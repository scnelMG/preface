import { Suspense } from 'react'
import { StudioScreen } from '@/features/studio/components/StudioScreen'

export const metadata = { title: '내 작업실' }

/**
 * 작업실(유저플로우 03, Figma P3-36·P3-42·P3-45·SCR-15).
 *
 * `(app)`이 아니라 `(public)`에 둔다. 게스트도 같은 `/studio`에서 기본 모델 2종(남성·여성)을 고르는 화면(P3-36)이 있어서다.
 * 회원 기능(내 모델·최근 기록·삭제)은 화면이 로그인 상태를 보고 나눈다. 머리 추가(`/studio/new`)는 `(app)`에 남는다.
 *
 * StudioScreen이 useSearchParams()로 `?faceModelId=`·`?tab=`을 읽어 <Suspense>로 감싼다.
 */
export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioScreen />
    </Suspense>
  )
}
