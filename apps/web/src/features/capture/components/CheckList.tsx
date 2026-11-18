import { cx, Icon } from '@/shared/ui'

/**
 * Figma `안내 목록`·`체크 안내` — 체크 표시 목록(SCR-17①, SCR-07 공통).
 * 2026-10-31: 흰 카드 상자를 빼고 줄만 남겼다(새 촬영 안내와 같은 상자 없는 모양).
 */
export function CheckList({
  items,
  label,
  className,
}: {
  items: string[]
  label?: string
  className?: string
}) {
  return (
    <ul aria-label={label} className={cx('flex w-full flex-col gap-(--space-8)', className)}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-(--space-10)">
          <Icon name="Check" size={15} className="mt-[3px] shrink-0 text-text-ink" />
          <span className="text-[14px] leading-[1.5] break-keep text-text-ink">{item}</span>
        </li>
      ))}
    </ul>
  )
}
