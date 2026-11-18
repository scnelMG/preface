import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Figma `v3/Tag` — 카드 위의 작은 영문 표시(예: QUICK START).
 * 글자(Pretendard Medium 7px · 줄 간격 9 · 자간 0.6)와 색(#dedcd6, #918a7f)은 Figma에서도 토큰이 아니다.
 */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[19px] items-start rounded-5 border border-[#dedcd6] px-(--space-6) py-(--space-5)',
        'text-[7px] leading-[9px] font-medium tracking-[0.6px] whitespace-nowrap text-[#918a7f]',
        className,
      )}
    >
      {children}
    </span>
  )
}
