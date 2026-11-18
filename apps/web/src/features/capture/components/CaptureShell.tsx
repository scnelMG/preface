import type { ReactNode } from 'react'
import { BrandBar, cx } from '@/shared/ui'

/**
 * 휴대폰 업로드 전용 세션 화면의 틀. Figma `top-bar · 로고 + PC와 연결됨`(SCR-17·SCR-05·SCR-07 공통).
 * 업로드 전용 세션에는 일반 헤더(메뉴·알림·프로필)가 없다. 로고와 연결 표시만 둔다.
 *
 * 로고는 메인 머리줄과 같은 BrandBar(2026-10-31).
 */
export function CaptureShell({
  connected,
  children,
  className,
}: {
  /** 업로드 전용 세션이 살아 있으면 "PC와 연결됨" 칩을 보인다 */
  connected: boolean
  children: ReactNode
  /** 본문 여백. Figma 화면마다 위 여백이 다르다 */
  className?: string
}) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-bg-paper">
      {/* 메인 머리줄과 같은 로고(링크 없이: 업로드 세션 밖으로 나가지 않는다) */}
      <BrandBar link={false}>{connected ? <ConnectedChip /> : null}</BrandBar>
      <section className={cx('flex flex-1 flex-col px-[5%] pb-(--space-24)', className)}>
        {children}
      </section>
    </div>
  )
}

function ConnectedChip() {
  return (
    <span className="flex items-center gap-(--space-6) rounded-full border border-line-default bg-bg-card px-(--space-10) py-(--space-6)">
      <span aria-hidden className="size-1.5 rounded-full bg-brand-violet" />
      <span className="type-kr-caption-11-medium-lh14p3 whitespace-nowrap text-text-ink">
        PC와 연결됨
      </span>
    </span>
  )
}
