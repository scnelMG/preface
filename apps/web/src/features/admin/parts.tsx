'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { cx } from '@/shared/ui'

/**
 * 관리자 화면 공통 부품. 사용자 조회 화면(S15P31B204-653)도 같이 쓴다.
 */

export type Resource<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; notFound: boolean }
  | { kind: 'ok'; data: T }

/**
 * 관리자 API 하나를 불러온다. `deps`(문자열·숫자)가 바뀌면 이전 요청을 끊고 다시 부른다. `reload()`로 다시 부른다.
 * 타인·없는 리소스는 404(`isNotFound`)로 온다.
 *
 * 받은 결과에 요청 열쇠를 붙여 두고, 열쇠가 지금과 다르면 "불러오는 중"으로 본다(effect 안에서 상태를 비우지 않는다).
 */
export function useAdminResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly (string | number | null | undefined)[],
): { state: Resource<T>; reload: () => void } {
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([...deps, attempt])
  const [result, setResult] = useState<{ key: string; state: Resource<T> } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, state: { kind: 'ok', data } })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setResult({
          key,
          state: {
            kind: 'error',
            message: error instanceof Error ? error.message : '불러오지 못했어요.',
            notFound: error instanceof ApiError && (error.status === 404 || error.isNotFound),
          },
        })
      })
    return () => controller.abort()
    // 부르는 쪽이 load가 기대는 값을 deps로 넘긴다(key에 들어 있다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const state: Resource<T> = result && result.key === key ? result.state : { kind: 'loading' }
  return { state, reload }
}

export function PageTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-(--space-12)">
      <h1 className="type-headline text-ink">{children}</h1>
      {aside}
    </div>
  )
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('mt-(--space-28)', className)} aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-(--space-8)">
        <h2 className="type-label text-ink">{title}</h2>
        {aside}
      </div>
      <div className="mt-(--space-12)">{children}</div>
    </section>
  )
}

export function Loading({ label = '불러오는 중이에요' }: { label?: string }) {
  return (
    <div className="flex justify-center py-(--space-40)" role="status">
      <span className="pf-loader" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-12 border border-hairline bg-surface p-(--space-16)">
      <p className="type-caption text-ink-2">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-(--space-12)" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}

/** 좁은 화면에서 표가 화면을 밀지 않게 표 안에서만 옆으로 넘긴다 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="w-full overflow-x-auto rounded-12 border border-hairline bg-surface"
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  )
}

export const TABLE = 'w-full min-w-max border-collapse text-left'
export const TH =
  'type-caption whitespace-nowrap border-b border-hairline px-(--space-12) py-(--space-10) font-medium text-muted-soft'
export const TD =
  'type-caption whitespace-nowrap border-b border-hairline px-(--space-12) py-(--space-10) text-ink-2'

/** 사용자 ID·작업 ID처럼 긴 값. 고정폭으로 보이고 줄바꿈하지 않는다 */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('pf-mono', className)}>{children}</span>
}

/** 숫자 하나와 이름(요약 카드) */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'danger' | 'accent'
}) {
  return (
    <div className="rounded-12 border border-hairline bg-surface p-(--space-16)">
      <p className="type-caption text-muted-soft">{label}</p>
      <p
        className={cx(
          'pf-mono mt-(--space-4) text-2xl font-semibold',
          tone === 'danger' ? 'text-status-danger' : tone === 'accent' ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="type-caption mt-(--space-4) text-muted-soft">{hint}</p>}
    </div>
  )
}
