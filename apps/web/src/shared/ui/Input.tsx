import type { ComponentProps } from 'react'
import { cx } from './cx'

/**
 * Figma `v3/Input` — Kind: Select · Text · Textarea.
 * Figma에는 라벨이 없다. 화면에서 <label>로 감싸거나 aria-label을 넘긴다.
 * Figma에는 placeholder 색(#757575 등)만 있고 입력된 글자 색이 없어 text-ink로 둔다.
 * 테두리 색(#dfd9cf, #d9d6d0)은 Figma에서도 변수로 묶여 있지 않다.
 */

/** Kind=Select. Figma에 펼침 화살표가 없어 그대로 둔다(오른쪽 여백 25px만 있다) */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cx(
        'h-[32px] min-w-[100px] appearance-none rounded-6 border border-[#dfd9cf] bg-transparent py-(--space-8) pr-[25px] pl-[11px]',
        'type-kr-caption-11-regular-lh14p3 text-[#746a5d]',
        className,
      )}
      {...props}
    />
  )
}

/** Kind=Text. 테두리 없는 한 줄 입력(검색 등) */
export function TextField({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cx(
        'w-full bg-transparent px-(--space-2) py-px',
        'type-kr-body-12-regular-lh15p6 text-text-ink placeholder:text-[#757575]',
        className,
      )}
      {...props}
    />
  )
}

/** Kind=Textarea */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cx(
        'h-[76px] w-full resize-none rounded-7 border border-[#d9d6d0] bg-bg-cream p-(--space-14)',
        'type-kr-body-12-regular-lh22p2 text-text-ink placeholder:text-[#757575]',
        className,
      )}
      {...props}
    />
  )
}
