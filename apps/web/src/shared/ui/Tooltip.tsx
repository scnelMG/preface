'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * 아이콘 말풍선(2026-10-31). 브라우저 기본 `title` 대신 쓴다 — 모양(잉크 바탕·밝은 글자 12px)이 모델줄과 같다(preview.css .pp-tooltip).
 *
 * 아이콘만 봐서는 뜻을 알기 어려운 것에만 단다(내 작업실 폴더, 처음으로, 원본 보기, 조명 구, QR 새로 만들기).
 * 되돌리기·알림·삭제처럼 아이콘이 곧 뜻인 것에는 달지 않는다.
 *
 * - 마우스(터치 아님)를 올리거나 키보드 초점이 오면 보이고, 누르는 순간(끌기·길게 누르기 포함)·Escape로 사라진다.
 * - 초점으로는 `:focus-visible`(키보드 초점)일 때만 연다(S15P31B204-884). 마우스로 누르면 브라우저가 링크에 초점을 주는데,
 *   머리줄은 화면을 옮겨도 남아 초점이 그대로 있고, 다른 창에 갔다 돌아오면 focus가 다시 와 올린 적 없는 말풍선이 떠 있었다.
 * - 말풍선 id를 children에 넘겨 aria-describedby로 잇는다.
 * - align="end"는 오른쪽 끝을 맞춘다(화면 오른쪽 가장자리의 버튼이 밖으로 넘치지 않게).
 */
export function Tooltip({
  label,
  children,
  disabled = false,
  align = 'center',
}: {
  label: string
  children: (descriptionId: string | undefined) => ReactNode
  disabled?: boolean
  align?: 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  useEffect(() => {
    if (!open) return
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  return (
    <span
      className={cx('pp-tooltip', align === 'end' && 'pp-tooltip-end')}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setOpen(true)
      }}
      onPointerLeave={() => setOpen(false)}
      onPointerDown={() => setOpen(false)}
      onFocus={(event) => {
        if (isKeyboardFocus(event.target)) setOpen(true)
      }}
      onBlur={() => setOpen(false)}
    >
      {children(open && !disabled ? id : undefined)}
      {open && !disabled && (
        <span role="tooltip" id={id} className="pp-tooltip-label">
          <span>{label}</span>
        </span>
      )}
    </span>
  )
}

/** 키보드로 온 초점인지. `:focus-visible`을 모르는 브라우저에서는 예전처럼 초점이면 연다 */
function isKeyboardFocus(target: EventTarget): boolean {
  if (!(target instanceof Element)) return true
  try {
    return target.matches(':focus-visible')
  } catch {
    return true
  }
}
