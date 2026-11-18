'use client'

import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { Footer, type FooterLink } from '@/shared/ui/Footer'

/**
 * 레이아웃에 붙이는 푸터. 휴대폰(md 미만)의 작업 화면에서는 숨긴다(S15P31B204-563).
 *
 * 작업 화면(작업실·머리 추가, 실험실, 3D 생성 대기)은 휴대폰에서 화면 전체를 작업 공간으로 쓰고,
 * 바닥을 조절 시트에 양보한다. PC는 화면이 넓어 푸터(약관·처리방침·문의)를 그대로 둔다(사용자 결정 2026-11-04).
 * 메인·서비스 소개·약관·소개 같은 정보 화면은 PC·휴대폰 모두 푸터를 둔다.
 *
 * usePathname()은 cacheComponents에서 <Suspense> 안에서만 쓸 수 있다(SiteHeader와 같다).
 * 경로를 알기 전에는 그리지 않는다. 휴대폰 작업 화면에서 푸터가 잠깐 비쳤다 사라지지 않게 하려는 것이다.
 */
const WORK_PREFIXES = ['/studio', '/lab', '/simulations', '/reconstructions'] as const

export function isWorkScreen(pathname: string): boolean {
  return WORK_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function PathFooter({ links, contact }: { links: readonly FooterLink[]; contact?: string }) {
  const pathname = usePathname()
  const footer = <Footer links={links} contact={contact} />
  if (!isWorkScreen(pathname)) return footer
  return <div className="max-md:hidden">{footer}</div>
}

export function SiteFooter(props: { links: readonly FooterLink[]; contact?: string }) {
  return (
    <Suspense fallback={null}>
      <PathFooter {...props} />
    </Suspense>
  )
}
