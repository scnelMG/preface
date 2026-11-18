'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from '@/shared/ui/cx'

/** 슬라이더를 놓을 때(native change) 이력 한 단계로 묶는다. 입력 중에는 화면만 바뀐다. */
export function CommitOnRelease({
  onCommit,
  disabled,
  children,
  className,
}: {
  onCommit: () => void
  disabled?: boolean
  children: ReactNode
  /** 묶음 사이 간격 등 덧씌울 클래스(기본 간격 24) */
  className?: string
}) {
  const ref = useRef<HTMLFieldSetElement>(null)
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })
  useEffect(() => {
    const node = ref.current
    const listener = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'range')
        commit.current()
    }
    node?.addEventListener('change', listener)
    return () => node?.removeEventListener('change', listener)
  }, [])
  return (
    <fieldset
      ref={ref}
      disabled={disabled}
      className={cx('flex min-w-0 flex-col gap-(--space-24)', className)}
    >
      {children}
    </fieldset>
  )
}
