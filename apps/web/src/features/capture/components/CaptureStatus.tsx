import type { ReactNode } from 'react'
import { Icon, type IconName } from '@/shared/ui'

/**
 * 가운데 정렬 상태 화면. Figma `SCR-17 ④ 업로드 완료`(286:2553)의 모양을 빌려
 * 연결 중·연결 종료 화면에도 쓴다(Figma에 따로 그린 화면이 없다).
 */
export function CaptureStatus({
  icon,
  title,
  body,
  action,
  busy,
}: {
  icon: IconName
  title: string
  body?: ReactNode
  action?: ReactNode
  /** 진행 중이면 스크린 리더가 바뀐 문구를 읽게 한다 */
  busy?: boolean
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center text-center"
      role="status"
      aria-busy={busy || undefined}
    >
      {/* 테두리 없는 옅은 원(2026-10-31) */}
      <span className="flex size-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--pf-ink)_6%,transparent)] text-text-ink">
        <Icon name={icon} size={28} />
      </span>
      <h1 className="mt-(--space-14) text-[24px] leading-[1.3] font-[650] tracking-[-0.03em] break-keep text-text-ink">
        {title}
      </h1>
      {body ? (
        <p className="mt-(--space-12) type-kr-body-13-regular-lh16p9 break-keep text-text-paragraph">
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-(--space-24) w-full">{action}</div> : null}
    </div>
  )
}
