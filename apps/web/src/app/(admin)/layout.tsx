import type { Metadata } from 'next'
import { AdminGate } from '@/features/admin/AdminGate'
import { AuthGate } from '@/features/auth/AuthGate'
import { LoginModal } from '@/features/auth/LoginModal'

/** 관리자 화면은 검색에 나오지 않게 한다. 일반 화면 메뉴에도 걸지 않는다(S15P31B204-654) */
export const metadata: Metadata = {
  title: { default: '관리자', template: '%s · 관리자 · Preface' },
  robots: { index: false, follow: false },
}

/**
 * 관리자 화면(`/admin/**`). 일반 서비스 머리줄·푸터·진행 팝업 없이 관리자 머리줄만 둔다.
 *
 * - 비로그인: `AuthGate`가 회원 화면과 같이 로그인 모달을 띄운다(닫으면 메인으로)
 * - 관리자가 아님(403): `AdminGate`가 "관리자만 볼 수 있어요"를 보인다
 * - 관리자: `AdminGate`가 머리줄(메뉴·사용자 조회·운영 | 개발 탭)과 내용을 그린다
 */
export default function AdminLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="preface-app flex min-h-full flex-1 flex-col bg-canvas">
      <AuthGate>
        <AdminGate>{children}</AdminGate>
      </AuthGate>
      <LoginModal />
    </div>
  )
}
