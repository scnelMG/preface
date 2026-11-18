'use client'

import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { create } from 'zustand'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * Figma `v3/Toast` — 짙은 바탕 + 체크 아이콘 + 한 줄 문구. Desktop·Mobile 두 크기.
 *
 * 쓰는 법: 어디서든 `toast('저장했어요')`. 레이아웃에 붙일 필요가 없다.
 * 처음 부를 때 <body> 끝에 토스트 자리를 하나 만들어 스스로 붙는다.
 * (루트 layout.tsx를 여러 작업이 함께 고치지 않으려는 선택이다.)
 *
 * Figma 값: 바탕 #2b2d26, 글자 #f1f1e7, 아이콘 CheckCircle #bba5ce, 반경 5, 그림자 0 8 15 rgba(0,0,0,.13).
 * 세 색은 Figma에서도 변수로 묶여 있지 않다.
 * Figma에는 화면 위치와 "되돌리기" 같은 버튼이 없다. 위치는 화면 아래 가운데로 두고,
 * FN-EDIT-04("reset은 확인 없이 실행하고 되돌리기 토스트")를 위해 action을 선택으로 받는다.
 */
export interface ToastOptions {
  /** 기본 3000ms */
  duration?: number
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
}

interface ToastState {
  items: ToastItem[]
  push: (item: ToastItem) => void
  remove: (id: number) => void
}

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (item) => set((state) => ({ items: [...state.items, item] })),
  remove: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}))

let nextId = 1
let root: Root | null = null

function ensureMounted() {
  if (root || typeof document === 'undefined') return
  const host = document.createElement('div')
  host.dataset.toaster = ''
  document.body.appendChild(host)
  root = createRoot(host)
  root.render(<Toaster />)
}

export function toast(message: string, options: ToastOptions = {}): number {
  ensureMounted()
  const id = nextId++
  useToastStore.getState().push({ id, message, ...options })
  return id
}

/** 띄운 토스트를 바로 걷는다. 같은 종류 알림을 새 것으로 바꿀 때 쓴다(이미 사라졌으면 아무 일도 없다) */
export function dismissToast(id: number) {
  useToastStore.getState().remove(id)
}

/** 테스트용. 붙여 둔 토스트 자리를 걷는다 */
export function __resetToaster() {
  root?.unmount()
  root = null
  document.querySelectorAll('[data-toaster]').forEach((el) => el.remove())
  useToastStore.setState({ items: [] })
}

function ToastView({ item }: { item: ToastItem }) {
  const remove = useToastStore((s) => s.remove)

  useEffect(() => {
    const timer = setTimeout(() => remove(item.id), item.duration ?? 3000)
    return () => clearTimeout(timer)
  }, [item.id, item.duration, remove])

  return (
    <div
      // v4(2026-10-31): 잉크 알약 + 떠 있는 그림자, 아래에서 살짝 떠오른다(움직임 줄이기면 바로). 예전 올리브색을 걷었다
      className={cx(
        'flex min-h-11 items-center gap-(--space-10) rounded-full bg-ink py-(--space-10) pr-(--space-18) pl-(--space-14) text-on-ink shadow-(--pf-shadow-pop)',
        'motion-safe:animate-[pf-rise_260ms_var(--pf-ease-out)_both]',
      )}
    >
      <Icon name="CheckCircle" size={18} className="shrink-0 opacity-80" />
      <p className="text-[13.5px] font-medium whitespace-nowrap">{item.message}</p>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick()
            remove(item.id)
          }}
          className="ml-(--space-4) text-[13.5px] font-semibold text-on-ink underline underline-offset-3 decoration-on-ink/40 hover:decoration-on-ink"
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  )
}

export function Toaster() {
  const items = useToastStore((s) => s.items)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-(--space-24) z-50 flex flex-col items-center gap-(--space-8) px-(--space-20)"
    >
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto">
          <ToastView item={item} />
        </div>
      ))}
    </div>
  )
}
