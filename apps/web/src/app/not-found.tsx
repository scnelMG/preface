import Link from 'next/link'
import { BrandBar } from '@/shared/ui'

export const metadata = { title: '페이지를 찾을 수 없어요' }

/**
 * 없는 주소·지운 항목(404). Next 기본 화면 대신 서비스 톤으로 보여 준다(2026-10-30 화면 통일).
 * 그룹 layout 밖에서도 그려질 수 있어 로고만 있는 머리줄을 직접 둔다((auth) layout과 같은 모양).
 */
export default function NotFound() {
  return (
    <div className="preface-app">
      <BrandBar />
      {/* 메인과 같은 큰 제목 체계(두 줄이 차례로 올라온다)·버튼 모양(2026-10-31). 뒤에 아주 옅은 큰 404 */}
      <main className="pf-404">
        <span className="pf-404-code" aria-hidden="true">
          404
        </span>
        <h1 className="type-display pf-404-title">
          <span className="pf-reveal-line">
            <span>찾는 페이지가</span>
          </span>
          <span className="pf-reveal-line">
            <span>없어요.</span>
          </span>
        </h1>
        <p className="type-lead pf-404-lead">
          주소가 바뀌었거나 삭제된 항목이에요. 메인에서 다시 시작하거나 내 작업실로 이동하세요.
        </p>
        <div className="pf-404-actions">
          <Link href="/" className="btn-primary">
            메인으로 가기
          </Link>
          <Link href="/studio" className="btn-ghost">
            내 작업실
          </Link>
        </div>
      </main>
    </div>
  )
}
