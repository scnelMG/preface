'use client'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './controls.css'
import { useSprings } from '@/shared/ui/useSprings'

export interface RailItem<T extends string> {
  value: T
  label: ReactNode
  /** 막힌 칸(눌러도 바뀌지 않고 onBlocked를 부른다) */
  disabled?: boolean
  /** 칸 옆 작은 글자(예: 예정) */
  note?: string
}

/**
 * 부위·편집 방식 탭. 흰 표시 면이 스프링으로 미끄러지고, 빨리 움직이는 동안 진행 방향으로 늘어난다.
 * role=tablist/tab. 막힌 칸도 누를 수 있게 두고(aria-disabled) 누르면 onBlocked로 알린다.
 */
export function ControlRail<T extends string>({
  label,
  items,
  value,
  onChange,
  onBlocked,
  size = 'md',
  variant = 'pill',
  className,
}: {
  label: string
  items: readonly RailItem<T>[]
  value: T
  onChange: (value: T) => void
  onBlocked?: (item: RailItem<T>) => void
  size?: 'sm' | 'md'
  /** pill: 흰 유리 알약(편집 방식). quiet: 글자 + 미끄러지는 밑줄(부위). 한 카드에 알약을 겹쳐 쌓지 않는다 */
  variant?: 'pill' | 'quiet'
  className?: string
}) {
  const list = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const node = list.current
    if (!node) return
    const measure = () => {
      const active = node.querySelector<HTMLElement>('[aria-selected="true"]')
      setBox(active ? { x: active.offsetLeft, w: active.offsetWidth } : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [value, items])
  useSprings(box, ({ x, w }, { x: vx }) => {
    const el = thumb.current
    if (!el) return
    // 빨리 움직일수록 진행 방향으로 늘어난다(액체처럼). 최대 18px
    const stretch = Math.min(18, Math.abs(vx) * 0.012)
    el.style.width = `${w + stretch}px`
    el.style.transform = `translateX(${x - (vx < 0 ? stretch : 0)}px)`
  })
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      data-size={size}
      data-variant={variant}
      className={['cc-rail', className].filter(Boolean).join(' ')}
    >
      <span ref={thumb} aria-hidden="true" className="cc-rail-thumb" style={{ width: 0 }} />
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          aria-disabled={item.disabled || undefined}
          onClick={() => (item.disabled ? onBlocked?.(item) : onChange(item.value))}
          className="cc-rail-item"
        >
          <span className="cc-rail-label">
            {item.label}
            {item.note ? <span className="cc-note">{item.note}</span> : null}
          </span>
        </button>
      ))}
    </div>
  )
}
