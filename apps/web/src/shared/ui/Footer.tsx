import Link from 'next/link'
import { Fragment } from 'react'
import { cx } from './cx'

/**
 * Figma `v3/Footer` — 저작권 줄 + "데이터 안내".
 * 2026-10-30 사용자 결정: 영문 문구(YOUR OWN PERSPECTIVE)와 고지 문구를 머리줄에서 뺐다.
 * 기능명세 R-01(결과 화면 고지)은 3D 무대 아래 안내 아이콘(툴팁·읽기 프로그램 문구)이 맡는다(`features/viewer/ViewerHints`).
 *
 * "데이터 안내"를 누르면 어디로 가는지는 Figma에 없다(미정). dataNoticeHref를 주면 링크가 되고,
 * 없으면 글자로만 보인다.
 *
 * links: "데이터 안내" 앞에 놓는 링크(이용약관·개인정보 처리방침 등). 표시 전용이라 경로는 부르는 쪽이 정한다.
 * strong이면 굵게 보인다(개인정보 처리방침은 다른 링크와 구분되게 표시 — 처리방침 작성지침).
 *
 * contact: 문의 메일 주소. 주면 "데이터 안내" 뒤에 메일 링크(mailto)로 보인다(사용자 요청 2026-11-02).
 */
export interface FooterLink {
  href: string
  label: string
  strong?: boolean
}

export function Footer({
  dataNoticeHref,
  links = [],
  contact,
}: {
  dataNoticeHref?: string
  links?: readonly FooterLink[]
  contact?: string
}) {
  const notice = dataNoticeHref ? (
    <Link href={dataNoticeHref} className="underline-offset-2 hover:underline">
      데이터 안내
    </Link>
  ) : (
    <span>데이터 안내</span>
  )

  return (
    <footer className="w-full border-t border-hairline text-muted-soft">
      <div className="flex w-full flex-col gap-(--space-6) px-[5%] py-(--space-20) md:flex-row md:items-center md:justify-between md:px-[4%]">
        <p className="type-caption whitespace-nowrap">© 2026 Preface</p>
        <div className="flex items-start justify-between md:gap-(--space-24)">
          <p className="type-kr-caption-10-regular-lh20 md:type-kr-caption-10-regular-lh13">
            {links.map((link) => (
              <Fragment key={link.href}>
                <Link
                  href={link.href}
                  className={cx(
                    'underline-offset-2 hover:underline',
                    link.strong && 'font-semibold',
                  )}
                >
                  {link.label}
                </Link>
                {' · '}
              </Fragment>
            ))}
            {notice}
            {contact && (
              <>
                {' · '}
                <a href={`mailto:${contact}`} className="underline-offset-2 hover:underline">
                  문의 {contact}
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </footer>
  )
}
