import { Dashboard } from '@/features/admin/Dashboard'

export const metadata = { title: '한눈에 보기' }

/** 관리자 한눈에 보기: 기간별 3D 생성 요약과 지금 기다리는 작업(S15P31B204-654) */
export default function AdminHomePage() {
  return <Dashboard />
}
