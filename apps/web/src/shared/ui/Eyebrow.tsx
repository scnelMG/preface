import Image from 'next/image'
import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Figma `v3/Eyebrow` — 제목 위의 작은 영문 문구. Dot=true면 앞에 보라색 점이 붙는다.
 * 점은 Figma 원본 그림(public/design/accent-dot.svg, 7px, #8655CC)을 그대로 쓴다.
 */
export function Eyebrow({
  children,
  dot = true,
  className,
}: {
  children: ReactNode
  dot?: boolean
  className?: string
}) {
  return (
    <p
      className={cx(
        'flex items-center',
        dot && 'gap-(--space-10)',
        'type-en-caption-10-medium-ls1p8-lh13 whitespace-nowrap text-text-body',
        className,
      )}
    >
      {dot ? (
        <Image
          src="/design/accent-dot.svg"
          alt=""
          width={7}
          height={7}
          unoptimized
          className="shrink-0"
        />
      ) : null}
      <span>{children}</span>
    </p>
  )
}
