'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { DotsThreeVerticalIcon } from '@phosphor-icons/react'
import { cx } from './cx'

/**
 * 항목 메뉴(⋮, 2026-10-31). 작업실 모델·시안 카드의 이름 바꾸기·삭제를 버튼 둘 대신 메뉴 하나로 모은다.
 *
 * - 세로 점 세 개 버튼을 누르면 버튼 쪽(오른쪽 위)에서 작은 메뉴가 펼쳐진다(0.96 → 1, 150ms).
 * - 메뉴가 열리면 첫 항목에 초점, 위·아래 방향키로 옮기고 Escape·바깥 누름으로 닫는다(닫히면 버튼으로 초점).
 * - 삭제처럼 되돌리기 어려운 항목은 `danger`로 위험 색. 확인 창은 부르는 쪽이 띄운다.
 */
export interface ItemMenuAction {
  label: string
  onSelect: () => void
  danger?: boolean
}

export function ItemMenu({
  label,
  actions,
  className,
}: {
  /** 버튼 이름(예: '내 모델 메뉴') */
  label: string
  actions: ItemMenuAction[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const items = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
      ]
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
      event.preventDefault()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', keys)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', keys)
    }
  }, [open])

  return (
    <div className={cx('pf-item-menu', className)} ref={root}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="pf-item-menu-trigger"
        onClick={() => setOpen((value) => !value)}
      >
        <DotsThreeVerticalIcon size={18} weight="bold" />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className="pf-item-menu-list">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              data-danger={action.danger ? '' : undefined}
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
                action.onSelect()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
