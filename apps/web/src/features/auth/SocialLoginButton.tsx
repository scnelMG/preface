import Image from 'next/image'
import type { ButtonHTMLAttributes } from 'react'
import { cx } from '@/shared/ui'
import type { ProviderPath } from './types'

/**
 * Figma `v3/Social login` (261:2205) 자리의 카카오·Google 로그인 버튼, 높이 48px.
 *
 * 모양·색·문구는 디자인 토큰이 아니라 각 제공자의 공식 가이드를 따른다(Figma는 임시 도형이었다).
 * - 카카오: Kakao Developers "카카오 로그인 > 디자인 가이드"
 *   (https://developers.kakao.com/docs/ko/kakaologin/design-guide).
 *   컨테이너 #FEE500 · 레이블 #000000 85% · 반경 12px · 레이블 "카카오 로그인".
 *   심볼은 공식 리소스(kakao-symbol.svg)를 바꾸지 않고 쓴다.
 * - Google: "Sign in with Google branding guidelines"
 *   (https://developers.google.com/identity/branding-guidelines).
 *   라이트 테마 채움 #FFFFFF · 테두리 #747775 1px · 글자 #1F1F1F 14px Medium ·
 *   로고 왼쪽 12px · 로고와 글자 사이 10px · 글자 오른쪽 12px 이상 · 공식 "G"(google-g.svg) 20px.
 *   문구는 "Sign in with Google"의 한국어 표기 "Google 로그인".
 *   Google Sans는 앱에 없어 사이트 글꼴(Pretendard)로 나온다.
 *
 * 사용자 요청에 따라 두 제공자의 서체도 사이트 글꼴(Pretendard)과 14px/500으로 통일한다.
 */
const SPEC: Record<ProviderPath, { box: string; logo: string; logoSize: number; label: string }> = {
  kakao: {
    box: 'bg-[#fee500] text-[rgba(0,0,0,0.85)]',
    logo: '/design/auth/kakao-symbol.svg',
    logoSize: 18,
    label: '카카오 로그인',
  },
  google: {
    box: 'border border-[#747775] bg-[#ffffff] text-[#1f1f1f]',
    logo: '/design/auth/google-g.svg',
    logoSize: 20,
    label: 'Google 로그인',
  },
}

export function SocialLoginButton({
  provider,
  className,
  ...props
}: { provider: ProviderPath } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const spec = SPEC[provider]
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'flex h-[48px] w-full items-center justify-center gap-(--space-10) rounded-12 px-(--space-12)',
        'type-kr-body-14-medium-lh18p2 font-sans whitespace-nowrap',
        'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
        // 누르면 살짝 눌린다(색·모양은 제공자 가이드 그대로, 2026-10-31)
        'transition-transform duration-150 ease-out enabled:active:scale-[0.96]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-violet',
        spec.box,
        className,
      )}
    >
      <Image
        src={spec.logo}
        alt=""
        width={spec.logoSize}
        height={spec.logoSize}
        unoptimized
        className="shrink-0"
      />
      <span>{spec.label}</span>
    </button>
  )
}
