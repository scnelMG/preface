import { LoginModal } from '@/features/auth/LoginModal'
import { legalFooterLinks } from '@/features/legal/documents'
import { CONTACT } from '@/features/legal/facts'
import { SiteFooter } from '@/features/layout/SiteFooter'
import { SiteHeader } from '@/features/layout/SiteHeader'
import { ProgressDock } from '@/features/reconstruction/ProgressDock'

export default function PublicLayout({ children }: LayoutProps<'/'>) {
  // 메인·서비스·체험 화면에서도 3D 생성 진행 팝업을 띄운다(REQ-F-08 "어느 화면에 있든", -382).
  // 회원일 때만 조회하므로 비로그인 방문자에게는 아무것도 그리지 않는다.
  return (
    <div className="preface-app">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter links={legalFooterLinks()} contact={CONTACT} />
      <ProgressDock />
      <LoginModal />
    </div>
  )
}
