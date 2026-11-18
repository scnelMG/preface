'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'

/**
 * 2~3개 중 하나 고르기(2026-10-30). 상자·회색 홈 없이 글자만 두고, 고른 칸에만 옅은 잉크 알약(7%)이 깔린다. 검정 면을 늘리지 않는다.
 *
 * Emil Kowalski의 "Tabs with perfect color transitions": 같은 목록을 한 벌 더 그려 활성 모양(옅은 바탕·잉크 글자)으로 칠하고,
 * clip-path로 고른 칸만 보이게 자른다. 칸을 바꾸면 잘린 창이 미끄러져, 글자 색이 두 상태로 겹쳐 보이지 않고 한 번에 바뀐다.
 * clip-path transition은 중간에 다시 눌러도 이어서 움직인다(인터럽트 가능). 동작 줄이기면 바로 바뀐다.
 *
 * mode `tabs`: role=tablist/tab + aria-selected(화면 전환). `toggle`: role=group + aria-pressed(값 고르기).
 */
export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  /** 칸 옆 작은 글자(예: 예정) */
  hint?: ReactNode
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  mode = 'tabs',
  size = 'md',
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** 읽기 프로그램 이름 */
  label: string
  mode?: 'tabs' | 'toggle'
  size?: 'sm' | 'md'
  className?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [clip, setClip] = useState<string | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[data-active="true"]')
      if (!active) return
      const left = active.offsetLeft
      const right = list.offsetWidth - (left + active.offsetWidth)
      setClip(`inset(0 ${right}px 0 ${left}px round 999px)`)
    }
    measure()
    // 글꼴이 늦게 와 폭이 바뀌어도 다시 잰다(jsdom 등 ResizeObserver가 없으면 한 번만)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [value, options])

  const item = cx(
    'inline-flex items-center justify-center gap-(--space-4) rounded-full font-medium tracking-[-0.01em] whitespace-nowrap',
    size === 'sm' ? 'h-8 px-(--space-12) text-[13px]' : 'h-9 px-(--space-14) text-[14px]',
  )

  return (
    <div className={cx('relative inline-flex', className)}>
      <div
        ref={listRef}
        role={mode === 'tabs' ? 'tablist' : 'group'}
        aria-label={label}
        className="flex items-center"
      >
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              data-active={active}
              role={mode === 'tabs' ? 'tab' : undefined}
              aria-selected={mode === 'tabs' ? active : undefined}
              aria-pressed={mode === 'toggle' ? active : undefined}
              onClick={() => onChange(option.value)}
              className={cx(
                item,
                'text-muted-soft transition-colors duration-(--pf-dur-ui) hover:text-ink-2',
              )}
            >
              {option.label}
              {option.hint ? <span className="text-[11px] font-normal">{option.hint}</span> : null}
            </button>
          )
        })}
      </div>
      {/* 활성 모양 한 벌. 고른 칸만 보이게 잘라 둔다(장식, 누르기는 아래 진짜 버튼으로 통과) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center bg-ink/[0.07] transition-[clip-path] duration-250 ease-(--pf-ease-out) motion-reduce:transition-none"
        style={{ clipPath: clip ?? 'inset(0 100% 0 0 round 999px)' }}
      >
        {options.map((option) => (
          <span key={option.value} className={cx(item, 'text-ink')}>
            {option.label}
            {option.hint ? <span className="text-[11px] font-normal">{option.hint}</span> : null}
          </span>
        ))}
      </div>
    </div>
  )
}
