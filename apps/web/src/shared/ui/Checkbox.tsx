import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * Figma `v3/Checkbox` — 22px. 체크: 바탕 ink + 흰 체크 14px / 해제: 흰 바탕 + 1.5px muted 테두리.
 * Figma 설명: "행 전체를 터치 영역(최소 44px)으로 감싸서 사용." — label 전체가 누르는 영역이고 높이 44px 이상이다.
 * 실제 입력은 숨긴 native checkbox라 키보드(Space)·폼 제출·스크린 리더가 그대로 동작한다.
 */
export function Checkbox({
  children,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { children?: ReactNode }) {
  return (
    <label
      className={cx(
        'inline-flex min-h-[44px] cursor-pointer items-center gap-(--space-10)',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40',
        className,
      )}
    >
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className={cx(
          'grid size-[22px] shrink-0 place-items-center rounded-5 border-[1.5px] border-text-muted bg-bg-surface text-text-on-dark',
          'peer-checked:border-text-ink peer-checked:bg-text-ink',
          // 체크하면 칸이 잉크로 차고 표시가 작게서 제 크기로(2026-10-31). 움직임 줄이기면 바로 바뀐다
          'transition-[background-color,border-color] duration-150 ease-out',
          '[&>svg]:scale-50 [&>svg]:opacity-0 peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100',
          'motion-safe:[&>svg]:transition-[scale,opacity] motion-safe:[&>svg]:duration-200 motion-safe:[&>svg]:ease-[cubic-bezier(0.23,1,0.32,1)]',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-violet',
        )}
      >
        <Icon name="Check" size={14} />
      </span>
      {children ? <span>{children}</span> : null}
    </label>
  )
}
