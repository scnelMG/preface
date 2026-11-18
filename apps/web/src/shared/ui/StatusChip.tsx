import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * Figma `v3/StatusChip` — 변경 요청의 반영 여부. Done=false "검토 전", Done=true "반영됨".
 * 색(#eae4db, #8b7970, #e3e9df, #596a51)은 Figma에서도 변수로 묶여 있지 않다.
 */
export function StatusChip({
  done,
  children,
  className,
}: {
  done: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-4 px-(--space-6) pt-[5.2px] pb-[4.1px]',
        done ? 'gap-(--space-4) bg-[#e3e9df] text-[#596a51]' : 'bg-[#eae4db] text-[#8b7970]',
        className,
      )}
    >
      {done ? <Icon name="Check" size={10} className="shrink-0" /> : null}
      <span className="type-kr-caption-9-regular-lh11p7 whitespace-nowrap">
        {children ?? (done ? '반영됨' : '검토 전')}
      </span>
    </span>
  )
}
