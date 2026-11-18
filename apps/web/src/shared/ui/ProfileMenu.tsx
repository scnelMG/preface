'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * Figma `v3/ProfileButton` — 이름 첫 글자 동그라미 + (Desktop) "○○님" + 더보기.
 * Wireframe v3.2는 헤더 프로필 버튼 → SCR-12 내 정보다. 로그아웃도 어디서나 할 수 있게
 * 누르면 작은 메뉴(내 정보 · 로그아웃)를 연다. Figma에는 메뉴가 없어 모양은 디자인 토큰으로만 잡았다.
 * 동그라미 색 #eae7e0은 Figma에서도 변수로 묶여 있지 않다.
 *
 * 접근성: 펼침 버튼(aria-expanded·aria-controls) + 링크·버튼 목록(disclosure 패턴).
 * Tab으로 차례대로 옮겨 가고, Esc·바깥 누르기·메뉴 밖으로 포커스가 나가면 닫는다. Esc는 프로필 버튼으로 포커스를 돌려준다.
 */
export function ProfileMenu({
  nickname,
  onLogout,
  loggingOut = false,
  href = '/me',
}: {
  nickname: string
  onLogout: () => void
  loggingOut?: boolean
  href?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const initial = nickname.trim().charAt(0) || '?'

  useEffect(() => {
    if (!open) return
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && rootRef.current?.contains(target))
    function onPointerDown(event: PointerEvent) {
      if (outside(event.target)) setOpen(false)
    }
    function onFocusIn(event: FocusEvent) {
      if (outside(event.target)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const itemClass =
    'flex min-h-[44px] w-full cursor-pointer items-center gap-(--space-8) rounded-5 px-(--space-12) text-left type-kr-body-12-regular-lh15p6 text-text-ink hover:bg-bg-warm disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${nickname}님, 계정 메뉴`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[28px] cursor-pointer items-center gap-(--space-4) px-(--space-6) text-text-ink md:h-[32px] md:gap-[9px]"
      >
        <span
          aria-hidden
          className="type-kr-caption-10-regular-lh13 md:type-kr-caption-11-regular-lh14p3 flex size-[26px] items-center justify-center rounded-full bg-[#eae7e0] md:size-[30px]"
        >
          {initial}
        </span>
        <span className="type-kr-body-12-regular-lh15p6 hidden whitespace-nowrap md:inline">
          {nickname}님
        </span>
        <Icon name="DotsThree" size={17} />
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="absolute top-full right-0 z-20 mt-(--space-8) min-w-[160px] rounded-7 border border-line-default bg-bg-surface p-(--space-4) shadow-[0_8px_15px_rgba(0,0,0,0.08)]"
      >
        <ul className="flex flex-col gap-(--space-2)">
          <li>
            <Link href={href} onClick={() => setOpen(false)} className={itemClass}>
              <Icon name="User" size={16} />내 정보
            </Link>
          </li>
          <li>
            <button
              type="button"
              disabled={loggingOut}
              aria-busy={loggingOut}
              onClick={() => {
                setOpen(false)
                onLogout()
              }}
              className={itemClass}
            >
              <Icon name="SignOut" size={16} />
              {loggingOut ? '로그아웃하는 중…' : '로그아웃'}
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
