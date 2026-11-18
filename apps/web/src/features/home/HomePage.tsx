'use client'

import { useAuthStore } from '@/features/auth/store'
import { useFirstVisitRedirect } from '@/features/landing/firstVisit'
import { MainStudio } from './MainStudio'

/**
 * 체험 메인. 무대는 디자인 시스템 v4로 다시 지은 MainStudio다(2026-10-30).
 * 최근 작업은 메인에 두지 않는다(2026-10-30 사용자 결정). 시안은 작업실 `시안` 탭에서 본다.
 */
export function HomePage() {
  const status = useAuthStore((s) => s.status)
  useFirstVisitRedirect(status)
  return <MainStudio />
}
