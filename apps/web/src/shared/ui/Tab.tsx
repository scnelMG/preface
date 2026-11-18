'use client'

import { createContext, useContext, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'

/**
 * Figma `v3/Tab` — Style: Count · Pill · Bar · Icon · Stack, State: Selected · Default.
 * 한 목록 안의 탭은 같은 Style을 쓴다고 보고 TabList에서 정한다.
 *
 * 접근성: role=tablist/tab, aria-selected, 좌우 화살표·Home·End로 이동하며 선택한다.
 * Bar의 Default 상태는 Figma에 없다. 다른 Style의 Default처럼 밑줄 없이 흐린 글자로 둔다.
 * 토큰이 아닌 색(#978e82, #aaa094, #8c65b6 …)은 Figma에서도 변수로 묶여 있지 않다.
 */
export type TabVariant = 'count' | 'pill' | 'bar' | 'icon' | 'stack'

interface TabsContextValue {
  variant: TabVariant
  value: string
  onChange: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('Tab은 TabList 안에서만 쓴다')
  return ctx
}

/** 탭 사이 간격은 Figma 컴포넌트에 없고 화면마다 다르다. 쓰는 쪽이 className으로 준다 */
export function TabList({
  variant,
  value,
  onChange,
  children,
  className,
  ...aria
}: {
  variant: TabVariant
  value: string
  onChange: (value: string) => void
  children: ReactNode
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    )
    const current = tabs.findIndex((tab) => tab === document.activeElement)
    if (current < 0) return
    event.preventDefault()
    const last = tabs.length - 1
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight'
            ? (current + 1) % tabs.length
            : (current - 1 + tabs.length) % tabs.length
    tabs[next].focus()
    tabs[next].click()
  }

  return (
    <TabsContext.Provider value={{ variant, value, onChange }}>
      <div
        role="tablist"
        className={cx('flex items-end', className)}
        onKeyDown={onKeyDown}
        {...aria}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
}

const SELECTED_LINE = 'border-b-2 border-neutral-charcoal'

export function Tab({
  value,
  children,
  count,
  icon,
  disabled,
  className,
}: {
  value: string
  children: ReactNode
  /** Count·Stack·Bar 스타일의 숫자 */
  count?: number | string
  /** Icon 스타일의 아이콘 */
  icon?: IconName
  disabled?: boolean
  className?: string
}) {
  const { variant, value: selectedValue, onChange } = useTabs()
  const selected = value === selectedValue

  let box: string
  let content: ReactNode

  switch (variant) {
    case 'count':
      box = cx(
        'h-[50px] items-center gap-[9px] pt-[15px] pb-[18.1px]',
        selected ? SELECTED_LINE : 'border-b-2 border-transparent',
      )
      content = (
        <>
          <span
            className={cx(
              'type-kr-body-13-regular-lh16p9',
              selected ? 'text-neutral-charcoal' : 'text-[#978e82]',
            )}
          >
            {children}
          </span>
          {count !== undefined ? (
            <span
              className={cx(
                'type-en-caption-9-regular-lh11p7 self-start pt-[1.5px]',
                selected ? 'text-[#8c65b6]' : 'text-[#aaa094]',
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      )
      break
    case 'stack':
      box = cx(
        'h-[42px] items-start gap-(--space-7) pt-[12.2px] pb-[14.2px]',
        selected ? SELECTED_LINE : 'border-b-2 border-transparent',
      )
      content = (
        <>
          <span
            className={cx(
              'type-kr-body-12-regular-lh15p6',
              selected ? 'text-neutral-charcoal' : 'text-[#978e82]',
            )}
          >
            {children}
          </span>
          {count !== undefined ? (
            <span
              className={cx(
                'type-en-caption-9-regular-lh11p7',
                selected ? 'text-[#8c65b6]' : 'text-[#aaa094]',
              )}
            >
              {count}
            </span>
          ) : null}
        </>
      )
      break
    case 'pill':
      box = cx(
        'h-[23px] items-center justify-center rounded-3 py-(--space-5)',
        // 선택은 보라 대신 흰 칩으로 구분한다(메인 남성·여성 고르기와 같은 모양, 2026-10-30)
        selected
          ? 'bg-bg-card px-[7px] text-text-ink shadow-[0_1px_3px_rgba(38,38,41,0.08)]'
          : 'px-(--space-8) text-text-muted',
      )
      content = <span className="type-kr-caption-9-regular-lh11p7 text-center">{children}</span>
      break
    case 'bar':
      box = cx(
        'flex-col items-start pt-[15px] pb-(--space-24)',
        selected ? 'border-b-2 border-text-ink' : 'border-b-2 border-transparent',
      )
      content = (
        <span
          className={cx(
            'type-kr-body-13-regular-lh16p9',
            selected ? 'text-text-ink' : 'text-[#978e82]',
          )}
        >
          {children}
          {count !== undefined ? (
            <span className="text-[10px] leading-[16.9px] text-[#999a8f]">{count}</span>
          ) : null}
        </span>
      )
      break
    case 'icon':
      box = cx(
        'h-[41px] items-center justify-center gap-(--space-4) pt-[13px] pb-(--space-14)',
        selected
          ? 'border-b-2 border-text-ink pr-[22.1px] pl-(--space-22) text-text-ink'
          : 'border-b-2 border-transparent px-[11.5px] text-[#8c8880]',
      )
      content = (
        <>
          {icon ? <Icon name={icon} size={13} className="shrink-0" /> : null}
          <span className="type-kr-caption-10-regular-lh13">{children}</span>
        </>
      )
      break
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={cx(
        'relative inline-flex shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40',
        box,
        className,
      )}
    >
      {content}
    </button>
  )
}
