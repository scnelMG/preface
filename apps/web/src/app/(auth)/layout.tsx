import { BrandBar } from '@/shared/ui'

/**
 * 로그인·가입 동의·OAuth 콜백. 서비스 헤더 대신 로고만 있는 top-bar를 쓴다(Figma SCR-02 `top-bar · 로고만`).
 * 로고는 메인 머리줄과 같은 모양(BrandBar, 2026-10-31).
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="preface-app">
      <BrandBar />
      <main className="flex-1">{children}</main>
    </div>
  )
}
