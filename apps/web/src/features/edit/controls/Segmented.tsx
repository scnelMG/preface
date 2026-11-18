'use client'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './controls.css'
import { useSprings } from '@/shared/ui/useSprings'

/**
 * 하나를 고르는 줄(쌍꺼풀 모양). 칸마다 작은 선 그림(선택) + 이름. 레일과 같은 흰 알약이 스프링으로 미끄러지고,
 * 카드 폭에 맞춰 같은 너비 칸으로 편다. native radio라 화살표 키로 고른다.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string
  /** glyph: 칸 위의 작은 선 그림(이름만으로 모양이 안 떠오르는 고르기) */
  options: readonly { value: T; label: string; glyph?: ReactNode; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const name = useId()
  const list = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const node = list.current
    if (!node) return
    const measure = () => {
      const active = node.querySelector<HTMLElement>('input:checked')?.closest('label') ?? null
      setBox(active ? { x: active.offsetLeft, w: active.offsetWidth } : null)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [value, options.length])
  useSprings(box, ({ x, w }) => {
    const el = thumb.current
    if (!el) return
    el.style.width = `${w}px`
    el.style.transform = `translateX(${x}px)`
  })
  return (
    <div ref={list} role="radiogroup" aria-label={label} data-block="" className="cc-rail">
      <span ref={thumb} aria-hidden="true" className="cc-rail-thumb" style={{ width: 0 }} />
      {options.map((option) => (
        <label key={option.value} className="cc-rail-item">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled || option.disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.glyph ? (
            <span aria-hidden="true" className="cc-seg-glyph">
              {option.glyph}
            </span>
          ) : null}
          {option.label}
        </label>
      ))}
    </div>
  )
}
