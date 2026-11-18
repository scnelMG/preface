import { LandingPage } from '@/features/landing/LandingPage'

export const metadata = { title: '소개' }

/** 랜딩(소개) — Figma P3-01. 헤더 메뉴 없이, 처음 온 비로그인 사용자를 메인에서 여기로 한 번 보낸다 */
export default function AboutPage() {
  return <LandingPage />
}
