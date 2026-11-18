'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightIcon } from '@phosphor-icons/react'
import { cx } from '@/shared/ui'
import type { StepTutorial } from './useStepTutorial'

/**
 * 단계 안내 카드(메인·편집실 공통, 2026-11-03). "쉬고 있을 때는 조용히, 손이 닿을 때만 살아나게"를 따른다.
 *
 * - 카드는 가리키는 버튼·조절 바로 옆에 붙는다. 보라 테두리와 카드가 함께 다음 대상으로 미끄러져 간다.
 *   처음(11/02)에는 무대 아래 한 자리에 두었는데, 대상이 화면 위쪽 도구 줄에 있으면 눈이 위아래를 오가야 했다.
 *   3D 자체를 만지는 단계(`placement: 'stage'`)만 무대 아래 가운데에 둔다.
 * - 자리: 대상이 화면 맨 위(머리줄·도구 줄)면 아래로, 넓은 화면에서 왼쪽에 자리가 있으면 왼쪽(오른쪽 조절 패널을 가리지 않는다),
 *   아니면 아래·위 중 남는 쪽. 창 안을 벗어나지 않는다.
 * - 화면을 막지 않는다(비모달). 어두운 가림막이 없고, 카드를 보면서 바로 해 볼 수 있다.
 * - body에 띄워(fixed) 페이지 구조·넘침 자르기와 상관없이 같은 방식으로 놓인다. 기기 기록을 읽은 뒤(클라이언트)에만
 *   그려지므로 서버 렌더링에서 document를 찾지 않는다.
 * - Esc는 건너뛰기. 다른 창(`dialog[open]`)이 떠 있으면 가로채지 않는다.
 */
export interface TutorialCardProps<Id extends string> {
  tutorial: StepTutorial<Id>
  /** 단계마다 테두리를 두르고 카드를 붙일 요소. 없으면 무대 아래에 카드만 */
  getTarget: (id: Id) => HTMLElement | null
  /** `placement: 'stage'` 단계에서 카드를 붙일 3D 무대 */
  getStage: () => HTMLElement | null
  /** 대상 둘레를 동그랗게(작은 원형 대상) */
  roundTarget?: boolean
  /** 지금 단계의 테두리를 거둔다(해 본 뒤 등) */
  hideRing?: boolean
  /** 다시 잴 때를 알린다(탭이 바뀌어 대상이 달라질 때 등) */
  measureKey?: string
  /** 카드 아래에 덧붙일 내용(메인 1단계의 조작 칩) */
  extra?: ReactNode
  className?: string
}

const STAGE_WIDTH = 480
const TARGET_WIDTH = 340
const EDGE = 16
const GAP = 14
const RING_PAD = 6
/** 넓은 화면(md) 이상에서만 대상 왼쪽에 놓는다 */
const SIDE_MIN_VIEWPORT = 768
/** 조절 패널·3D 위에 겹쳐 뜨므로 비치지 않는 단단한 면(글래스는 뒤 글자가 글자 사이로 비쳤다) */
const CARD_SURFACE = 'var(--pf-surface)'
/** 이보다 위(머리줄·도구 줄)에 있는 대상은 아래에 붙인다 */
const TOOLBAR_ZONE = 160

type Box = { top: number; left: number; width: number; height: number }
type Place = { top: number; left: number; width: number }

function rectOf(element: HTMLElement | null): Box | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** 카드 자리(창 기준). 카드 높이는 그려 본 값을 쓴다 */
export function placeCard(
  mode: 'stage' | 'target',
  target: Box | null,
  stage: Box | null,
  viewport: { width: number; height: number },
  cardHeight: number,
): Place {
  const { width: vw, height: vh } = viewport
  const width = Math.min(mode === 'stage' ? STAGE_WIDTH : TARGET_WIDTH, vw - EDGE * 2)
  const fitLeft = (center: number) => clamp(center - width / 2, EDGE, vw - EDGE - width)
  const fitTop = (top: number) => clamp(top, EDGE, Math.max(EDGE, vh - EDGE - cardHeight))

  if (mode === 'stage' || !target) {
    const area = stage ?? { top: 0, left: 0, width: vw, height: vh }
    const bottom = Math.min(area.top + area.height, vh)
    return {
      width,
      left: fitLeft(area.left + area.width / 2),
      top: fitTop(bottom - EDGE - cardHeight),
    }
  }
  const below = target.top + target.height + GAP
  const above = target.top - GAP - cardHeight
  const nearTop = target.top < Math.min(TOOLBAR_ZONE, vh * 0.25)
  const roomLeft = target.left - GAP - width >= EDGE
  if (!nearTop && roomLeft && vw >= SIDE_MIN_VIEWPORT) {
    return {
      width,
      left: target.left - GAP - width,
      top: fitTop(target.top + target.height / 2 - cardHeight / 2),
    }
  }
  const center = target.left + target.width / 2
  if (nearTop || below + cardHeight <= vh - EDGE || above < EDGE) {
    return { width, left: fitLeft(center), top: fitTop(below) }
  }
  return { width, left: fitLeft(center), top: fitTop(above) }
}

export function TutorialCard<Id extends string>({
  tutorial,
  getTarget,
  getStage,
  roundTarget,
  hideRing,
  measureKey,
  extra,
  className,
}: TutorialCardProps<Id>) {
  const { current, step, total, stepDone, next, goTo, skip, complete } = tutorial
  const titleId = useId()
  const bodyId = useId()
  const card = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(140)
  const [boxes, setBoxes] = useState<{ target: Box | null; stage: Box | null } | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [leaving, setLeaving] = useState<'skip' | 'complete' | null>(null)
  const isLast = step === total - 1
  const mode = current.placement ?? 'target'

  // 대상·무대 위치를 따라간다. 시트 접기·펼치기, 창 크기, 스크롤에 맞춰 다시 잰다
  useEffect(() => {
    const target = getTarget(current.id)
    const stage = getStage()
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setViewport((prev) =>
          prev.width === window.innerWidth && prev.height === window.innerHeight
            ? prev
            : { width: window.innerWidth, height: window.innerHeight },
        )
        setBoxes({ target: rectOf(target), stage: rectOf(stage) })
      })
    }
    update()
    // 두 번째 단계부터 대상이 화면 밖이면 보이게 끌어온다. 첫 단계는 페이지를 갑자기 움직이지 않는다
    if (step > 0) target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    for (const element of [target, stage, document.body]) if (element) observer?.observe(element)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    // 모바일 시트는 transform으로 오르내려 크기 감시에 안 걸린다. 움직임이 끝날 때 다시 잰다
    document.addEventListener('transitionend', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      document.removeEventListener('transitionend', update, true)
    }
  }, [getTarget, getStage, current.id, step, measureKey])

  // 카드 높이(단계마다 글 길이가 달라 자리 계산에 쓴다)
  useLayoutEffect(() => {
    const node = card.current
    if (!node) return
    const measure = () => setCardHeight(node.offsetHeight || 140)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])

  // 끝내기는 카드가 내려가며 사라진 뒤에 기록한다(기록하면 이 컴포넌트가 바로 빠진다)
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => (leaving === 'skip' ? skip() : complete()), 180)
    return () => clearTimeout(timer)
  }, [leaving, skip, complete])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('dialog[open]')) return
      setLeaving('skip')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const place =
    boxes && viewport.width > 0
      ? placeCard(mode, boxes.target, boxes.stage, viewport, cardHeight)
      : null
  const ring = !hideRing && boxes?.target ? boxes.target : null

  return createPortal(
    <div className={cx('pointer-events-none fixed inset-0 z-50', className)} data-testid="tutorial">
      {ring ? (
        <div
          aria-hidden="true"
          data-testid="tutorial-ring"
          className={cx(
            'absolute shadow-[0_0_0_1.5px_var(--pf-accent),0_0_0_6px_var(--pf-accent-soft)]',
            'transition-[top,left,width,height,border-radius,opacity] duration-(--pf-dur-sheet) ease-(--pf-ease-drawer) motion-reduce:transition-none',
            roundTarget
              ? 'rounded-full motion-safe:animate-[pf-ring-breathe_1.8s_var(--pf-ease-out)_infinite]'
              : 'rounded-(--pf-radius-md)',
            leaving && 'opacity-0',
          )}
          style={{
            top: ring.top - RING_PAD,
            left: ring.left - RING_PAD,
            width: ring.width + RING_PAD * 2,
            height: ring.height + RING_PAD * 2,
          }}
        />
      ) : null}

      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cx(
          'glass pointer-events-auto absolute flex flex-col gap-(--space-14) rounded-(--pf-radius-lg) p-(--space-16)',
          // 다음 대상으로는 테두리와 같은 곡선으로 미끄러져 간다
          'transition-[top,left,width,opacity,translate] duration-(--pf-dur-sheet) ease-(--pf-ease-drawer) motion-reduce:transition-none',
          'motion-safe:animate-[pf-rise_var(--pf-dur-sheet)_var(--pf-ease-out)_both]',
          leaving && 'translate-y-(--space-8) opacity-0',
          !place && 'invisible',
        )}
        style={{ ...place, background: CARD_SURFACE }}
      >
        <div className="flex items-center justify-between gap-(--space-12)">
          {/* 진행: 가는 막대. 지난 단계와 지금 단계가 잉크로 차고, 해 본 단계는 보라로.
              막대마다 그 단계로 옮기는 버튼이다(앞뒤 모두). 보이는 막대는 그대로 두고 누르는 자리만 24px 높이로 넓힌다.
              막대 사이 간격은 버튼 좌우 여백이 대신하고, 위아래 음수 여백으로 머리줄 높이를 바꾸지 않는다 */}
          <ol aria-label="단계" className="-my-(--space-6) -ml-(--space-2) flex items-center">
            {Array.from({ length: total }, (_, index) => (
              <li key={index} className="flex">
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  aria-label={`${index + 1}단계로 이동`}
                  aria-current={index === step ? 'step' : undefined}
                  data-tutorial-step={index}
                  className="group flex h-6 items-center rounded-(--pf-radius-sm) px-(--space-2)"
                >
                  <span className="block h-0.5 w-(--space-16) overflow-hidden rounded-full bg-hairline-strong transition-colors duration-(--pf-dur-ui) group-hover:bg-muted-soft">
                    <span
                      className={cx(
                        'block h-full origin-left rounded-full transition-[transform,background-color] duration-(--pf-dur-sheet) ease-(--pf-ease-out)',
                        index === step && stepDone ? 'bg-accent' : 'bg-ink',
                      )}
                      style={{ transform: `scaleX(${index <= step ? 1 : 0})` }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => setLeaving('skip')}
            className="-my-(--space-6) -mr-(--space-6) rounded-full px-(--space-6) py-(--space-6) type-caption text-muted-soft transition-colors duration-(--pf-dur-ui) hover:text-ink"
          >
            건너뛰기
          </button>
        </div>

        <div className="flex items-end justify-between gap-(--space-16)">
          {/* 단계가 바뀌면 글만 살짝 바뀐다. 버튼은 그대로 두어 키보드 초점을 잃지 않는다 */}
          <div
            key={current.id}
            className="min-w-0 motion-safe:animate-[pf-fade_var(--pf-dur-ui)_var(--pf-ease-out)_both]"
          >
            {/* 몇 번째인지는 위 막대가 보여 준다. 읽기 프로그램에만 숫자로 */}
            <h2
              id={titleId}
              className="type-label text-[15px] font-semibold tracking-[-0.015em] text-ink"
            >
              <span className="sr-only">{`${total}단계 중 ${step + 1}단계, `}</span>
              {current.title}
            </h2>
            <p id={bodyId} className="mt-(--space-4) type-caption break-keep text-ink-2">
              {current.body}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (isLast ? setLeaving('complete') : next())}
            data-tutorial-next=""
            className="inline-flex h-9 shrink-0 items-center gap-(--space-6) rounded-full bg-ink px-(--space-14) type-label text-on-ink transition-transform duration-(--pf-dur-press) ease-(--pf-ease-out) active:scale-97"
          >
            {isLast ? '시작하기' : '다음'}
            {isLast ? null : <ArrowRightIcon size={13} weight="bold" aria-hidden="true" />}
          </button>
        </div>

        {extra}
      </div>

      {/* 단계가 바뀔 때 읽어 준다. 카드 자체는 aria-live로 두지 않는다(버튼까지 다시 읽혀 시끄럽다) */}
      <p aria-live="polite" className="sr-only">
        {`${total}단계 중 ${step + 1}단계, ${current.title}. ${current.body}`}
      </p>
    </div>,
    document.body,
  )
}
