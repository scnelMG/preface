import Link from 'next/link'
import { type ReactNode, useId } from 'react'
import { Button, cx, Icon } from '@/shared/ui'

/**
 * 내 정보 화면(SCR-12·SCR-03)의 공용 조각. Figma `Wireframe v3.2 최종` SCR-12(265:1942 · 265:2112).
 * 2026-10-31 새 모양: 흰 카드 없이 모델카락 선으로만 나눈다. 넓은 화면은 구역마다 왼쪽에 이름·한 줄 설명,
 * 오른쪽에 내용(설정 화면의 두 칸 구성). 좁은 화면은 이름 → 내용으로 쌓는다.
 * 공통으로 옮길 후보: Section·Row(설정 목록), Switch(토글 — 디자인 시스템에 아직 없다).
 */

/** 840 폭 가운데 단. Mobile은 좌우 5% */
export function PageColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[840px] flex-col px-[5%] pt-(--space-24) pb-[72px] md:px-(--space-24) md:pt-[56px]">
      {children}
    </div>
  )
}

export function PageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col">
      <h1 className="text-[clamp(32px,3vw,44px)] leading-[1.15] font-[650] tracking-[-0.035em] text-text-ink">
        {title}
      </h1>
      {description ? (
        <p className="mt-(--space-12) max-w-[52ch] text-[15px] leading-[1.6] break-keep text-text-paragraph">
          {description}
        </p>
      ) : null}
    </header>
  )
}

/** 구역(계정·알림·동의·내 데이터): 위 머리카락 선, 왼쪽 이름·설명, 오른쪽 줄 목록 */
export function Section({
  label,
  description,
  children,
}: {
  label: string
  /** 이름 아래 흐린 한 줄 */
  description?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-(--space-40) gap-y-(--space-6) border-t border-line-default pt-(--space-20) md:grid-cols-[200px_minmax(0,1fr)] md:pt-(--space-24)"
    >
      <div className="flex flex-col gap-(--space-4) md:pt-(--space-14)">
        <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em] text-text-ink">
          {label}
        </h2>
        {description ? (
          <p className="text-[13px] leading-[1.5] break-keep text-text-muted">{description}</p>
        ) : null}
      </div>
      <Card>{children}</Card>
    </section>
  )
}

/** 줄 목록. 줄 사이에만 머리카락 선(상자 없음) */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col divide-y divide-line-default', className)}>
      {children}
    </div>
  )
}

/** 이름 — 값 한 줄 */
export function Row({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-(--space-16) py-(--space-14) text-[14.5px] leading-snug">
      <span className="shrink-0 text-text-paragraph">{label}</span>
      <span className="min-w-0 truncate text-right text-text-ink tabular-nums">{children}</span>
    </div>
  )
}

const ACTION_ROW =
  'group flex min-h-[52px] w-full items-center justify-between gap-(--space-16) py-(--space-14) text-left text-[14.5px] font-medium leading-snug text-text-ink'

/** 다른 화면으로 넘어가는 줄(오른쪽 꺾쇠) */
export function ActionRow({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link href={href} className={ACTION_ROW}>
      <span>{children}</span>
      <Icon
        name="CaretRight"
        size={16}
        className="shrink-0 text-text-body transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/** 토글 스위치. Figma SCR-12 `알림 설정` — 짙은 바탕 40×24 + 흰 손잡이 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange?: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="flex min-h-[44px] cursor-pointer items-center gap-(--space-8) disabled:cursor-not-allowed"
    >
      <span className="type-kr-body-12-regular-lh15p6 text-text-body">
        {checked ? 'ON' : 'OFF'}
      </span>
      <span
        aria-hidden
        className={cx(
          'flex h-6 w-10 items-center rounded-full p-0.75 transition-colors',
          checked ? 'justify-end bg-text-ink' : 'justify-start bg-line-default',
          disabled && 'opacity-40',
        )}
      >
        <span className="size-4.5 rounded-full bg-bg-surface" />
      </span>
    </button>
  )
}

/** 불러오기 실패 + 다시 불러오기 */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-(--space-8) py-(--space-16)">
      <p role="alert" className="type-kr-body-13-regular-lh16p9 text-text-body">
        {message}
      </p>
      <Button variant="text" trailingIcon={null} onClick={onRetry}>
        다시 불러오기
      </Button>
    </div>
  )
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="py-(--space-18) type-kr-body-13-regular-lh16p9 text-text-body">
      {children}
    </p>
  )
}
