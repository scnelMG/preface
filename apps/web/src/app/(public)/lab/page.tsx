import { Suspense } from 'react'
import { GuestLab } from '@/features/edit/lab/GuestLab'

export const metadata = { title: '체험 실험실' }

/**
 * 비로그인 체험 실험실(유저플로우 02, Figma P3-61 체험). 슬라이더 항목만 API-EDIT-01로 받고
 * 조절값은 브라우저에만 둔다(FN-REC-04).
 *
 * GuestLab이 useSearchParams()로 `?sample=`(남성·여성 기본 모델)을 읽어 <Suspense>로 감싼다.
 */
export default function LabPage() {
  return (
    <Suspense fallback={null}>
      <GuestLab />
    </Suspense>
  )
}
