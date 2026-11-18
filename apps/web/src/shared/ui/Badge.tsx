import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * Figma `v3/Badge` — 서비스 체험 가능 여부. Status: Partial · Planned · Preview.
 * 문구 기본값도 Figma 그대로다. 다른 문구가 필요하면 children으로 넘긴다.
 * Available(이용 가능)은 Figma에 없던 상태다. 기능을 다 연 서비스(S15P31B204-747)에 쓰고 모양은 Partial과 같다.
 * 2026-10-31: 테두리 없이. 체험할 수 있는 상태(Partial·Preview)는 옅은 잉크 면 + 잉크 글자, 예정은 흐린 글자만.
 * size="sm"은 `v3/LabServiceRow` 안의 작은 배지다(글자 8px, 여백 6·4).
 */
export type BadgeStatus = 'available' | 'partial' | 'planned' | 'preview'

const STATUS = {
  available: {
    box: 'bg-[color-mix(in_srgb,var(--pf-ink)_6%,transparent)] text-text-ink',
    icon: 'Check',
    label: '이용 가능',
  },
  partial: {
    box: 'bg-[color-mix(in_srgb,var(--pf-ink)_6%,transparent)] text-text-ink',
    icon: 'Check',
    label: '일부 체험',
  },
  preview: {
    box: 'bg-[color-mix(in_srgb,var(--pf-ink)_6%,transparent)] text-text-ink',
    icon: 'Check',
    label: '체험 가능',
  },
  planned: {
    box: 'text-muted',
    icon: 'Clock',
    label: '예정',
  },
} as const

export function Badge({
  status,
  size = 'md',
  children,
  className,
}: {
  status: BadgeStatus
  size?: 'md' | 'sm'
  children?: ReactNode
  className?: string
}) {
  const s = STATUS[status]
  return (
    <span
      className={cx(
        'inline-flex h-6 shrink-0 items-center gap-(--space-4) rounded-full',
        size === 'md' ? 'px-(--space-8)' : 'px-(--space-6)',
        s.box,
        className,
      )}
    >
      <Icon name={s.icon} size={10} className="shrink-0" />
      <span
        className={cx(
          'whitespace-nowrap',
          size === 'md' ? 'text-[11.5px] font-medium' : 'text-[10.5px] font-medium',
        )}
      >
        {children ?? s.label}
      </span>
    </span>
  )
}
