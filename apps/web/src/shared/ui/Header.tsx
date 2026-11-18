import Image from 'next/image'
import Link from 'next/link'
import { Button } from './Button'
import { cx } from './cx'
import { Icon } from './Icon'
import { ProfileMenu } from './ProfileMenu'

/**
 * Figma `v3/Header` — Device(Desktop·Mobile) × Auth(Guest·Member) × Active(메인·내 작업실).
 * 기기 구분은 화면 폭(md, 768px)으로 한다. Desktop 높이 76·폭 1360, Mobile 높이 70.
 * 상태(로그인 여부·현재 경로)를 알지 못하는 표시 전용 컴포넌트다. 연결은 SiteHeader가 한다.
 */

export type NavKey = 'main' | 'services' | 'studio'

export const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: 'main', label: '메인', href: '/' },
  { key: 'services', label: '서비스', href: '/services' },
  { key: 'studio', label: '내 작업실', href: '/studio' },
]

/** 워드마크 "preface°" — Pretendard Bold, 도(°)는 brand-violet-soft */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="Preface 홈" className={cx('shrink-0 text-text-ink', className)}>
      <span className="type-en-title-26-bold-ls-2-lh26 md:type-en-title-34-bold-ls-2p7-lh34">
        preface
      </span>
      <span className="text-[26px] leading-[26px] font-normal text-brand-violet-soft md:text-[32px] md:leading-[34px]">
        °
      </span>
    </Link>
  )
}

/**
 * Figma `v3/NotificationButton` — 시각 40px, 누르는 영역 44px(Figma 설명).
 * 안 읽은 알림이 있으면 Figma 원본 그림(public/design/bell-unread.svg, 종 + 보라 점)을 쓴다.
 */
export function NotificationButton({
  unread,
  href = '/notifications',
}: {
  unread: boolean
  href?: string
}) {
  return (
    <Link
      href={href}
      aria-label={unread ? '알림, 새 알림 있음' : '알림'}
      className="flex size-[44px] shrink-0 items-center justify-center rounded-full text-text-ink"
    >
      {unread ? (
        <Image src="/design/bell-unread.svg" alt="" width={40} height={40} unoptimized />
      ) : (
        <Icon name="Bell" size={20} />
      )}
    </Link>
  )
}

function NavLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'relative flex h-[69px] items-center px-[3px] whitespace-nowrap md:h-[75px] md:px-(--space-5)',
        'type-kr-caption-10-regular-lh13 md:type-kr-body-13-regular-lh16p9',
        active ? 'text-brand-violet-text' : 'text-text-muted',
      )}
    >
      {label}
      {active ? (
        <span
          aria-hidden
          className="absolute inset-x-[5px] bottom-[-1px] h-[2px] bg-brand-violet md:inset-x-(--space-5)"
        />
      ) : null}
    </Link>
  )
}

export interface HeaderProps {
  active: NavKey | null
  /** 비로그인이면 null */
  member: { nickname: string } | null
  unread?: boolean
  onLoginClick: () => void
  /** 회원 프로필 메뉴의 "로그아웃" */
  onLogout: () => void
  loggingOut?: boolean
}

export function Header({
  active,
  member,
  unread = false,
  onLoginClick,
  onLogout,
  loggingOut = false,
}: HeaderProps) {
  return (
    <header className="w-full px-(--space-20) md:px-(--space-40)">
      <div className="mx-auto flex h-[70px] w-full max-w-page items-center justify-between border-b border-line-default md:h-[76px]">
        <Wordmark />
        <nav
          aria-label="주요 메뉴"
          className="flex items-start gap-(--space-6) md:gap-(--space-32)"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.key}
              label={item.label}
              href={item.href}
              active={item.key === active}
            />
          ))}
        </nav>
        <div className="flex items-center gap-(--space-4) md:gap-[30.1px]">
          <NotificationButton unread={member ? unread : false} />
          {member ? (
            <ProfileMenu nickname={member.nickname} onLogout={onLogout} loggingOut={loggingOut} />
          ) : (
            <>
              {/* Button이 inline-flex를 갖고 있어 hidden과 부딪힌다. 보이기·숨기기는 감싸개에서 한다 */}
              <span className="md:hidden">
                <Button variant="text" layout="wrapped" onClick={onLoginClick}>
                  로그인
                </Button>
              </span>
              <span className="hidden md:block">
                <Button variant="text" layout="inline" onClick={onLoginClick}>
                  로그인
                </Button>
              </span>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
