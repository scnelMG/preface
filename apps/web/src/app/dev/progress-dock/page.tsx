import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Playground } from './Playground'

export const metadata = { title: '진행 팝업 (개발용)' }

/**
 * 개발용 확인 페이지. 하단 진행 팝업(Figma `v3/ProgressDock`)을 가짜 작업으로 펼쳐 본다.
 * API를 부르지 않는다. 운영 빌드에서는 404다.
 * 가짜 작업 시각을 `Date.now()`로 만들어서 요청 때 그리도록 `<Suspense>`로 감싼다.
 */
export default function ProgressDockDevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <Suspense fallback={null}>
      <Playground />
    </Suspense>
  )
}
