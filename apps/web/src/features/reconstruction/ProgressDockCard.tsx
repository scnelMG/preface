'use client'

import Link from 'next/link'
import { studioHref } from '@/features/studio/heads'
import { cx, Icon } from '@/shared/ui'
import { failMessagesOf } from './failMessages'
import { elapsedSince, elapsedText, stageCaption, stageFraction } from './stage'
import { STAGE_COUNT, type ReconstructionJob } from './types'
import { useNow } from './useNow'

/** 화면 하단 고정 위치. Figma 설명: 데스크톱 우측 하단 24px, 모바일 하단 16px */
export const DOCK_POSITION_CLASS =
  'fixed inset-x-(--space-16) bottom-(--space-16) z-40 md:inset-x-auto md:right-(--space-24) md:bottom-(--space-24) md:w-85'

/**
 * Figma `v3/ProgressDock`(315:2736) — 3D 생성 중 다른 화면 하단에 고정되는 진행 팝업의 카드 모양(2026-10-31 v4로 다시 그림).
 * 화면 위치(고정)는 `ProgressDock`이 정한다. 이 컴포넌트는 표시만 한다.
 *
 * - Desktop 340px: 아이콘·문구·열기 화살표, 진행 바, 경과 시간 줄
 * - Mobile(화면 폭 - 32px): 경과 시간 줄이 없다
 * - 누르면 3D 생성 대기 화면(`/reconstructions/[jobId]`)으로 간다. 닫기는 없다(Figma 설명)
 * - 진행은 단계로만 보여 준다. %는 쓰지 않는다(명세서 결정)
 *
 * 공통으로 옮길 후보: Figma에서는 디자인 시스템 컴포넌트지만 `shared/ui`를 이 줄에서 고치지 않아 여기 둔다.
 */
export interface ProgressDockCardProps {
  job: ReconstructionJob
  className?: string
}

export function ProgressDockCard({ job, className }: ProgressDockCardProps) {
  const caption = stageCaption(job)
  const fraction = stageFraction(job)

  return (
    // v4(2026-10-31): 테두리 없는 흰 면 + 떠 있는 그림자. 진행은 왼쪽 잉크 링(단계만큼 찬다) 하나로 — 대기 화면 진행 표시와 같은 잉크.
    // 보라 아이콘 원·보라 글씨·보라 막대는 걷었다. 2026-11-01부터 링(단계만큼)과 가운데 '작업 중' 점은 보라 포인트(사용자 결정).
    // 모양은 refine.css `.pf-dock*`
    <Link
      href={`/reconstructions/${job.jobId}`}
      aria-label={`내 모델을 만들고 있어요. ${caption}. 진행 화면 열기`}
      className={cx('pf-dock', className)}
    >
      <span
        role="progressbar"
        aria-label="3D 생성 단계"
        aria-valuemin={0}
        aria-valuemax={STAGE_COUNT}
        aria-valuenow={job.stageIndex ?? 0}
        aria-valuetext={caption}
        className="pf-dock-ring"
      >
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r={RING_R} className="pf-dock-track" />
          {/* 단계가 바뀔 때만 움직이는 값이라 길이만 인라인으로 준다 */}
          <circle
            cx="20"
            cy="20"
            r={RING_R}
            className="pf-dock-arc"
            style={{ strokeDashoffset: RING_LENGTH * (1 - fraction) }}
          />
        </svg>
        <span className="pf-dock-dot" />
      </span>
      <span className="pf-dock-text">
        <span className="pf-dock-title">내 모델을 만들고 있어요</span>
        <span className="pf-dock-caption">{caption}</span>
        <Elapsed job={job} />
      </span>
      <Icon name="CaretRight" size={16} className="pf-dock-caret" />
    </Link>
  )
}

/**
 * 실패 카드(2026-11-01 사용자 결정). 진행 카드와 같은 자리·같은 구성 [링 | 제목·이유 | ›]에서 링은 실패한 단계까지 보라로
 * 찬 채 멈추고, 가운데 '작업 중' 점 자리에 링과 같은 굵기의 X가 그려진다. 색은 진행 카드와 같은 보라 포인트(진행=점, 실패=X).
 * 진행을 보던 곳에서 결과도 본다. 진행 카드처럼 닫기 없이, 누르면 실패 안내(SCR-09)로 간다.
 * 실패 안내를 보면 확인으로 쳐서 다시 띄우지 않는다(`acknowledgeFailure`). 이유는 첫 실패 코드 문구 하나만 보인다.
 */
export function FailedDockCard({ job, className }: { job: ReconstructionJob; className?: string }) {
  const reason = failMessagesOf(job.failCodes)[0]?.reason ?? FAILED_FALLBACK
  return (
    <Link
      href={`/reconstructions/${job.jobId}`}
      aria-label={`${FAILED_TITLE}. ${reason}. 이유 보기`}
      className={cx('pf-dock pf-dock-failed', className)}
    >
      <span className="pf-dock-ring" aria-hidden="true">
        <svg viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={RING_R} className="pf-dock-track" />
          {/* 실제로 멈춘 단계까지만 찬 채로 남는다(진행 카드와 같은 계산) */}
          <circle
            cx="20"
            cy="20"
            r={RING_R}
            className="pf-dock-arc"
            style={{ strokeDashoffset: RING_LENGTH * (1 - stageFraction(job)) }}
          />
          {/* 링 안 지름의 약 1/3. pathLength=1로 두 획을 이어 그린다(refine.css pf-dock-draw-x) */}
          <path
            d="M15.5 15.5 L24.5 24.5 M24.5 15.5 L15.5 24.5"
            pathLength={1}
            className="pf-dock-x"
          />
        </svg>
      </span>
      <span className="pf-dock-text">
        <span className="pf-dock-title">{FAILED_TITLE}</span>
        <span className="pf-dock-caption">{reason}</span>
      </span>
      <Icon name="CaretRight" size={16} className="pf-dock-caret" />
    </Link>
  )
}

/**
 * 완성 카드(S15P31B204-909). 다른 화면에서 끝난 성공을 8초 토스트 대신 같은 자리에 남긴다.
 * 구성은 실패 카드와 같은 [링 | 제목·보조 | ✕]: 링은 끝까지 차고, 가운데 점 자리에 같은 굵기의 체크가 그려진다.
 * 카드 전체가 작업실(`studioHref({ faceModelId })`, 새 모델을 가운데 둔다)로 가는 링크다. 모델 id가 없으면 생성 대기 화면으로 간다.
 * 링크 안에 버튼을 둘 수 없어 ✕는 링크 옆(카드 오른쪽 위에 겹쳐) 둔다. 누르거나 ✕를 누르면 `onDismiss`로 내린다.
 */
export function SucceededDockCard({
  job,
  onDismiss,
  className,
}: {
  job: ReconstructionJob
  onDismiss: () => void
  className?: string
}) {
  const href = job.faceModelId
    ? studioHref({ faceModelId: job.faceModelId })
    : `/reconstructions/${job.jobId}`
  return (
    <div className={cx('pf-dock-wrap', className)}>
      <Link
        href={href}
        aria-label={`${SUCCEEDED_TITLE}. ${SUCCEEDED_CAPTION}`}
        className="pf-dock pf-dock-done"
        onClick={onDismiss}
      >
        <span className="pf-dock-ring" aria-hidden="true">
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r={RING_R} className="pf-dock-track" />
            <circle
              cx="20"
              cy="20"
              r={RING_R}
              className="pf-dock-arc"
              style={{ strokeDashoffset: 0 }}
            />
            {/* svg가 링 시작점 때문에 -90° 돌아가 있어 체크는 +90° 돌려 바로 세운다.
                실패 카드의 X와 같은 굵기·같은 긋기 효과(refine.css pf-dock-x, pathLength=1) */}
            <path
              d="M14.5 20.5 L18.5 24.5 L26 16"
              transform="rotate(90 20 20)"
              pathLength={1}
              className="pf-dock-x"
            />
          </svg>
        </span>
        <span className="pf-dock-text">
          <span className="pf-dock-title">{SUCCEEDED_TITLE}</span>
          <span className="pf-dock-caption">{SUCCEEDED_CAPTION}</span>
        </span>
      </Link>
      <button type="button" aria-label="닫기" className="pf-dock-close" onClick={onDismiss}>
        <Icon name="X" size={16} />
      </button>
    </div>
  )
}

const SUCCEEDED_TITLE = '내 모델이 완성됐어요'
const SUCCEEDED_CAPTION = '눌러서 작업실에서 보기'

const FAILED_TITLE = '3D 생성에 실패했어요'
const FAILED_FALLBACK = '이유와 고치는 방법을 확인해 주세요'

const RING_R = 17
const RING_LENGTH = 2 * Math.PI * RING_R

/**
 * "2분 10초 지났어요 · 3분에서 5분 정도 걸려요" — Desktop에만 있다. 1초마다 다시 센다.
 * 대기열(QUEUED)에서는 "3분에서 5분 정도 걸려요"를 붙이지 않는다(`elapsedText`)
 */
function Elapsed({ job }: { job: ReconstructionJob }) {
  const now = useNow(1000)
  const since = elapsedSince(job)
  if (Number.isNaN(since) || now === null) return null
  return <span className="pf-dock-elapsed">{elapsedText(job, now - since)}</span>
}
