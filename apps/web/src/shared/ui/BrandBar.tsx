import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * 로고만 있는 머리줄(2026-10-31). 로그인·가입·404·휴대폰 촬영 화면이 메인 머리줄(PreviewNav)과 같은 로고를 쓰게 한다.
 * 모양은 app/preview/preview.css의 `.pp-global-nav`·`.pp-logo`(높이 80, 로고 37px·650, 보라 °).
 *
 * - `link={false}`: 휴대폰 업로드 세션처럼 다른 화면으로 나가면 안 되는 곳은 글자만 둔다.
 * - `children`: 오른쪽 자리(예: "PC와 연결됨" 표시).
 */
export function BrandBar({ link = true, children }: { link?: boolean; children?: ReactNode }) {
  const mark = (
    <>
      preface<span aria-hidden="true">°</span>
    </>
  )
  return (
    <header className="pp-global-nav pf-brand-bar">
      {link ? (
        <Link className="pp-logo" href="/" aria-label="Preface 홈">
          {mark}
        </Link>
      ) : (
        <span className="pp-logo">{mark}</span>
      )}
      {children}
    </header>
  )
}
