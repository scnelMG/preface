import type { ReactNode } from 'react'
import { cx, Icon } from '@/shared/ui'

/**
 * Figma `원본 파일 안내`(SCR-07 업로드 전용 세션). 2026-10-31: 상자 없이 아이콘 + 흐린 한 줄.
 */
export function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('flex w-full items-start gap-(--space-8)', className)}>
      <Icon name="Info" size={15} className="mt-[2px] shrink-0 text-text-muted" />
      <span className="flex-1 text-[12.5px] leading-[1.55] break-keep text-text-muted">
        {children}
      </span>
    </p>
  )
}
