'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  holdHandoffTarget,
  isHandoffPending,
  releaseHandoffTarget,
  useHandoff,
} from '@/shared/state/handoff'
import { cx, LightSphere, Tooltip } from '@/shared/ui'
import { FaceViewer } from './FaceViewerLoader'
import { toolButton } from './toolButton'
import { ExpressionTracking, useExpressionTracking } from '@/features/expression/ExpressionControl'
import type { CompareSide, FaceViewerProps, ViewRequest } from './types'
import { useViewerFrame } from '@/app/preview/use-viewer-frame'
import { DEFAULT_LIGHTING } from './lighting'
import { SIMULATION_NOTICE, ViewerHints } from './ViewerHints'
import { DEFAULT_VIEW_PRESET, type ViewPreset } from './viewPresets'
import { gateWheelToModel } from './wheelZoomArea'

/**
 * 3D 뷰어 + 모서리 도구(2026-10-30 사용자 피드백으로 다시 정리).
 *
 * - 3D 하나만 그린다. 하나로/나란히 보기, 정면·45°·측면 버튼, 시점 처음으로(정육면체)는 없앴다. 시점은 드래그로 바꾼다.
 * - 오른쪽 위: `원본 보기` 아이콘(누르고 있는 동안 헤어 없는 원본, 떼면 수정한 모델과 헤어, -839) · 조명 구.
 * - 왼쪽 위: 코 구조 조절(리그가 있을 때만).
 * - 아래: 조작 힌트 + 참고용 안내 한 줄.
 *
 * 상담 패널·슬라이더 패널 배치는 화면(작업실·실험실)이 맡는다. 이 컴포넌트는 부모 크기를 채운다.
 */
export interface FaceStageProps extends Pick<
  FaceViewerProps,
  | 'meshUrl'
  | 'rigUrl'
  | 'weights'
  | 'onStatusChange'
  | 'onUnsupportedCodes'
  | 'onSupportedCodes'
  | 'onNosePreviewCheck'
  | 'onEyeReview'
  | 'onFaceProfile'
  | 'pauseFaceProfile'
  | 'pointStrokes'
  | 'noseHandleControls'
  | 'onNoseHandlePreview'
  | 'onNoseHandleCommit'
  | 'eyeEdit'
  | 'hairUrl'
  | 'onHairStatus'
  | 'hairProbe'
> {
  /** 표정 트래킹 리그 주소(모델 상세의 `expressionUrl`). 없으면 표정 트래킹 버튼이 없다 */
  expressionRigUrl?: string | null
  /** 원본 보기 버튼. 끄면 수정한 모델만 보인다 */
  compare?: boolean
  /**
   * 원본 보기를 바깥(편집실 도구 줄의 CompareHoldButton)에서 누르고 있는지.
   * 주면 무대 안 원본 보기 버튼은 그리지 않는다(2026-10-31)
   */
  holding?: boolean
  /** 처음 시점. 기본 45°(Figma) */
  defaultView?: ViewPreset
  comparisonView?: ViewRequest
  /** 왼쪽 위 작은 문구. 없으면 비워 둔다 */
  eyebrow?: ReactNode
  className?: string
  /** 상담 카드에서 누른 효과. nonce가 바뀌면 같은 항목도 다시 찾는다 */
  inspectChange?: { codes: string[]; nonce: number } | null
  /**
   * 3D를 어디까지 번지게 그릴지. `page`면 큰 화면에서 페이지 끝까지(머리줄·가장자리는 그라데이션으로 옅게) 번진다.
   * 기본 `stage`는 무대 안에서만(2026-10-30)
   */
  bleed?: 'stage' | 'page'
  /**
   * 휠 확대를 이 무대 칸(화면 배치상 3D 자리) 안에서만 받는다(-788). `bleed="page"`면 캔버스가 페이지 끝까지 번져
   * 조절 패널 옆 여백에서 굴린 휠까지 확대가 됐다. 칸 안이면 머리 위든 빈 곳이든 확대하고, 밖이면 페이지가 넘어간다
   */
  zoomOnlyInStage?: boolean
}

export function FaceStage({
  meshUrl,
  rigUrl,
  expressionRigUrl,
  weights,
  onStatusChange,
  onUnsupportedCodes,
  onSupportedCodes,
  onNosePreviewCheck,
  onEyeReview,
  onFaceProfile,
  pauseFaceProfile,
  pointStrokes,
  noseHandleControls,
  onNoseHandlePreview,
  onNoseHandleCommit,
  eyeEdit,
  hairUrl,
  onHairStatus,
  hairProbe,
  compare = true,
  holding: holdingOutside,
  defaultView = DEFAULT_VIEW_PRESET,
  comparisonView,
  eyebrow,
  className,
  inspectChange,
  bleed = 'stage',
  zoomOnlyInStage = false,
}: FaceStageProps) {
  // 편집실은 1060px부터 3D·조절 카드를 나란히 둔다. 그보다 좁으면 위아래로 쌓여 무대 안에서만 그린다
  const wide = useWideLayout()
  const pageBleed = bleed === 'page' && wide
  const [lighting, setLighting] = useState({ ...DEFAULT_LIGHTING })
  // 표정 트래킹: 버튼은 왼쪽 위 첫 줄, 미리보기는 그 아래에 둔다(표정 옵션이 든 리그일 때만 보인다)
  const tracking = useExpressionTracking(expressionRigUrl ?? null)
  const { slot, canvas, frame } = useViewerFrame(pageBleed ? '.preface-app' : '.pf-face-stage')
  const [holdingHere, setHolding] = useState(false)
  const holding = holdingOutside ?? holdingHere
  const [pointEditing, setPointEditing] = useState(false)
  const [view] = useState<ViewRequest>({ preset: defaultView, nonce: 0 })
  const section = useRef<HTMLElement>(null)

  // 무대 칸 사각형은 휠마다 잰다(페이지가 넘어가거나 창 크기가 바뀌면 칸이 움직인다). 판정은 메인 체험의 머리 사각형과 같은 도구
  useEffect(() => {
    const area = canvas.current
    if (!zoomOnlyInStage || !area) return
    return gateWheelToModel(area, () => section.current?.getBoundingClientRect() ?? null, 0)
  }, [zoomOnlyInStage, canvas])

  // 작업실에서 머리가 날아오는 중이면 3D 자리(보이는 칸 가운데, 높이의 82%)를 알려 준다(shared/state/handoff)
  const landedHere = useRef(false)
  useEffect(() => {
    holdHandoffTarget()
    const slotElement = section.current?.querySelector('.pf-editor-canvas')
    const from = useHandoff.getState().from
    if (isHandoffPending() && slotElement && from) {
      const rect = slotElement.getBoundingClientRect()
      const height = rect.height * 0.82
      const width = height * (from.width / from.height)
      useHandoff.getState().land({
        left: rect.left + (rect.width - width) / 2,
        top: rect.top + (rect.height - height) / 2,
        width,
        height,
      })
      landedHere.current = true
    }
    // 3D가 뜨기 전에 이 화면을 떠나면(뒤로 가기 등) 날아온 그림이 다음 화면에 잔상으로 남았다(-600).
    // 이 자리에 내려앉은 그림만 지운다(다른 화면의 3D가 사라질 때 작업실에서 막 뜬 그림을 지우지 않게)
    return () => {
      if (landedHere.current) releaseHandoffTarget()
    }
  }, [])
  // 3D가 준비되면 겹친 그림이 사라진다
  const reportStatus = useCallback(
    (status: Parameters<NonNullable<FaceViewerProps['onStatusChange']>>[0]) => {
      if (status !== 'loading') useHandoff.getState().finish()
      onStatusChange?.(status)
    },
    [onStatusChange],
  )
  const [lastInspectNonce, setLastInspectNonce] = useState(0)
  if (inspectChange && inspectChange.nonce !== lastInspectNonce) {
    setLastInspectNonce(inspectChange.nonce)
    setPointEditing(false)
    setHolding(false)
  }
  const side: CompareSide = compare && holding && !pointEditing ? 'before' : 'after'
  const highlightedPart = inspectChange?.codes.some((code) => code === 'nose.alar_width')
    ? '콧볼'
    : inspectChange?.codes.some((code) => code.startsWith('nose.tip_'))
      ? '코끝'
      : '콧대'
  const canPointEdit =
    rigUrl && onNoseHandleCommit && noseHandleControls?.some((control) => !control.unavailable)

  return (
    <section
      ref={section}
      aria-label="3D 뷰어"
      data-bleed={pageBleed ? 'page' : 'stage'}
      className={cx('pf-face-stage relative flex size-full min-h-0 flex-col', className)}
    >
      <div className="pf-editor-canvas relative min-h-0 flex-1" ref={slot}>
        <div className="pf-editor-bleed" ref={canvas}>
          <FaceViewer
            lighting={lighting}
            viewportFrame={frame}
            enablePan
            meshUrl={meshUrl}
            rigUrl={rigUrl}
            expressionRig={tracking.rig}
            weights={weights}
            layout="single"
            showing={side}
            view={comparisonView ?? view}
            onStatusChange={reportStatus}
            onUnsupportedCodes={onUnsupportedCodes}
            onSupportedCodes={onSupportedCodes}
            onNosePreviewCheck={onNosePreviewCheck}
            onEyeReview={onEyeReview}
            onFaceProfile={onFaceProfile}
            pauseFaceProfile={pauseFaceProfile}
            pointStrokes={pointStrokes}
            noseHandleControls={noseHandleControls}
            highlightCodes={side === 'after' ? inspectChange?.codes : undefined}
            pointEditEnabled={pointEditing}
            onNoseHandlePreview={onNoseHandlePreview}
            onNoseHandleCommit={onNoseHandleCommit}
            eyeEdit={eyeEdit}
            hairUrl={hairUrl}
            onHairStatus={onHairStatus}
            // 원본 보기를 누르고 있는 동안은 헤어도 빼고 원래 얼굴만 보인다(S15P31B204-839). 처음으로는 헤어를 그대로 둔다
            hairHidden={side === 'before'}
            hairProbe={hairProbe}
          />
        </div>

        {/* 왼쪽 위: 작은 문구 · 표정 트래킹 · 코 구조 조절. 위 끝을 맞춘다: 버튼(40 px)은 오른쪽 위 줄(40 px)과 가운데가
            맞고, 표정 트래킹을 켜면 그 자리를 미리보기가 대신해 아래로 자란다 */}
        <div className="absolute top-(--space-12) left-(--space-12) z-10 flex items-start gap-(--space-8) md:top-(--space-16) md:left-(--space-16)">
          {eyebrow ? (
            <p className="type-caption flex h-10 items-center whitespace-nowrap text-muted-soft">
              {eyebrow}
            </p>
          ) : null}
          <ExpressionTracking tracking={tracking} />
          {canPointEdit ? (
            <button
              type="button"
              data-tutorial="point-edit"
              aria-pressed={pointEditing}
              onClick={() => setPointEditing((value) => !value)}
              className="inline-flex min-h-[40px] items-center rounded-full px-(--space-12) text-[13px] font-medium text-muted-soft transition-colors duration-(--pf-dur-ui) hover:text-ink aria-pressed:bg-ink/6 aria-pressed:text-ink"
            >
              코 구조 조절
            </button>
          ) : null}
        </div>

        {/* 오른쪽 위: 원본 보기(누르고 있는 동안) · 조명 구 */}
        <div className="absolute top-(--space-12) right-(--space-12) z-10 flex h-10 items-center gap-(--space-6) md:top-(--space-16) md:right-(--space-16)">
          {compare && holdingOutside === undefined ? (
            <CompareHoldButton
              active={side === 'before'}
              disabled={pointEditing}
              onHoldChange={setHolding}
              align="end"
            />
          ) : null}
          <LightSphere value={lighting} onChange={setLighting} size={28} />
        </div>

        {/* 원본을 보는 동안만 작은 칩으로 알린다 */}
        <p
          role="status"
          className={cx(
            'type-caption pointer-events-none absolute top-[64px] right-(--space-12) z-10 rounded-full bg-ink px-(--space-10) py-(--space-4) text-on-ink transition-opacity duration-(--pf-dur-ui) md:top-[72px] md:right-(--space-16)',
            side === 'before' ? 'opacity-100' : 'opacity-0',
          )}
        >
          {side === 'before' ? '원본' : ''}
        </p>
      </div>

      <footer className="pf-stage-tools flex flex-col items-center gap-(--space-4) px-(--space-12) pt-(--space-8) pb-(--space-12) text-center">
        {/* 평소에는 아이콘 힌트, 코 구조 조절·상담 표시 중일 때만 한 줄 안내 */}
        {pointEditing || inspectChange ? (
          <p className="type-caption text-muted-soft">
            {pointEditing
              ? '코 점을 누르면 움직일 수 있는 방향이 보여요. 콧볼은 좌우 함께 바뀌어요.'
              : `${highlightedPart}의 표시된 부위를 확인하고, 원본 보기를 누르고 있으면 원본과 비교돼요.`}
          </p>
        ) : (
          <>
            <ViewerHints />
            <p className="type-caption text-faint">{SIMULATION_NOTICE}</p>
          </>
        )}
      </footer>
    </section>
  )
}

/**
 * 원본 비교 아이콘(2026-10-30). 보정 앱(라이트룸·VSCO)의 전후 비교처럼 사각형을 대각선으로 나눠 한쪽만 칠한다.
 * 아이콘 세트에 맞는 모양이 없어 직접 그린다. 선 굵기·모서리는 Phosphor regular와 맞췄다.
 */
/**
 * 원본 보기(누르고 있는 동안만). 무대 오른쪽 위 또는 편집실 도구 줄(2026-10-31)에 둔다.
 * 말풍선: 아이콘만으로는 '누르고 있으면 원본'이 안 보인다. 누르는 순간 말풍선은 사라진다(Tooltip)
 */
export function CompareHoldButton({
  active,
  disabled,
  onHoldChange,
  align = 'center',
}: {
  active: boolean
  disabled?: boolean
  onHoldChange: (holding: boolean) => void
  align?: 'center' | 'end'
}) {
  return (
    <Tooltip label="누르고 있는 동안 원본" align={align}>
      {(describedBy) => (
        <button
          type="button"
          aria-label="누르고 있는 동안 원본 보기"
          aria-describedby={describedBy}
          aria-pressed={active}
          disabled={disabled}
          className={cx(toolButton({ on: active }), 'touch-none select-none disabled:opacity-40')}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            onHoldChange(true)
            // 손가락이 버튼 밖으로 미끄러져도 뗄 때까지 원본을 유지한다
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }}
          onPointerUp={() => onHoldChange(false)}
          onPointerCancel={() => onHoldChange(false)}
          onLostPointerCapture={() => onHoldChange(false)}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault()
              onHoldChange(true)
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Enter') onHoldChange(false)
          }}
          onBlur={() => onHoldChange(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <BeforeAfterIcon />
        </button>
      )}
    </Tooltip>
  )
}

function BeforeAfterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.5 15.5 15.5 4.5V14a1.5 1.5 0 0 1-1.5 1.5H4.5Z" fill="currentColor" />
    </svg>
  )
}

const WIDE_QUERY = '(min-width: 1060px)'
function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(WIDE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
/** 편집실이 3D와 조절 카드를 나란히 두는 폭인지(service.css의 1060px 기준과 같다) */
function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches,
    () => false,
  )
}
