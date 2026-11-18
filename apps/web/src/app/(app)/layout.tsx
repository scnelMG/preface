import { AuthGate } from '@/features/auth/AuthGate'
import { LoginModal } from '@/features/auth/LoginModal'
import { legalFooterLinks } from '@/features/legal/documents'
import { CONTACT } from '@/features/legal/facts'
import { SiteFooter } from '@/features/layout/SiteFooter'
import { SiteHeader } from '@/features/layout/SiteHeader'
import { ProgressDock } from '@/features/reconstruction/ProgressDock'

export default function AppLayout({ children }: LayoutProps<'/'>) {
  // 하단 진행 팝업은 API-REC-03을 10초 간격으로 조회해 띄운다(REQ-F-08, -196).
  // 회원만 들어온다. 비로그인이면 AuthGate가 내용을 숨기고 로그인 모달을 띄운다.
  return (
    <div className="preface-app">
      <SiteHeader />
      <main className="flex-1">
        <AuthGate>{children}</AuthGate>
      </main>
      <SiteFooter links={legalFooterLinks()} contact={CONTACT} />
      <ProgressDock />
      <LoginModal />
    </div>
  )
}
