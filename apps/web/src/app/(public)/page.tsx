import { Suspense } from 'react'
import { HomePage } from '@/features/home/HomePage'

/**
 * 메인 — Figma P3-06(게스트)·P3-13(회원). 게스트·회원 분기는 HomePage가 클라이언트에서 한다
 */
export default function MainPage() {
  return (
    <Suspense fallback={null}>
      <HomePage />
    </Suspense>
  )
}
