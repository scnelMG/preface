'use client'

import { useEffect, useId, useState, type RefObject } from 'react'
import { Button, cx } from '@/shared/ui'
import type { TutorialStep } from './steps'

/**
 * 단계별 말풍선 + 대상 하이라이트. 컨테이너(`position: relative`) 안에 겹쳐 그린다.
 *
 * - 화면을 막지 않는다(비모달). 안내를 보면서 바로 모델을 돌리고 슬라이더를 움직일 수 있어야 한다.
 *   그래서 어두운 가림막 없이 대상 둘레에 보라색 테두리만 두르고, 테두리는 누르기를 통과시킨다.
 * - 말풍선은 대상 아래에, 자리가 없으면 위에, 둘 다 없으면 대상 안쪽 아래에 붙인다.
 * - 접근성: 말풍선은 `role="dialog"`(비모달), 단계가 바뀌면 `aria-live`로 읽어 준다. Esc는 건너뛰기.
 *
 * Figma Wireframe v3.2 최종에 코치마크 프레임이 없어 디자인 시스템 토큰·Button으로 만들었다.
 * 공통으로 옮길 후보(다른 화면 튜토리얼이 생기면 `shared/ui`로).
 */
export interface CoachmarkProps {
  steps: readonly TutorialStep[]
  step: number
  /** 말풍선·하이라이트 좌표의 기준. `position: relative`여야 한다 */
  container: RefObject<HTMLElement | null>
  /** 단계 id로 하이라이트할 요소를 찾는다. 없으면 말풍선만 컨테이너 위쪽에 띄운다 */
  getTarget: (id: string) => HTMLElement | null
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  className?: string
}

interface Layout {
  /** 컨테이너 기준 대상 상자 */
  top: number
  left: number
  width: number
  height: number
  containerWidth: number
  containerHeight: number
}

const BUBBLE_WIDTH = 320
/** 말풍선 높이 어림값. 자리 판단에만 쓴다 */
const BUBBLE_HEIGHT = 180
const GAP = 12
/** 하이라이트 테두리를 대상보다 조금 크게 */
const RING_PAD = 4
const ARROW_INSET = 20

function measure(container: HTMLElement, target: HTMLElement | null): Layout {
  const box = container.getBoundingClientRect()
  const rect = target?.getBoundingClientRect()
  return {
    top: rect ? rect.top - box.top : 0,
    left: rect ? rect.left - box.left : 0,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    containerWidth: box.width,
    containerHeight: box.height,
  }
}

function sameLayout(a: Layout | null, b: Layout) {
  return (
    !!a &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.containerWidth === b.containerWidth &&
    a.containerHeight === b.containerHeight
  )
}

export function Coachmark({
  steps,
  step,
  container,
  getTarget,
  onNext,
  onBack,
  onSkip,
  className,
}: CoachmarkProps) {
  const current = steps[step]
  const titleId = useId()
  const bodyId = useId()
  const [layout, setLayout] = useState<Layout | null>(null)
  const isLast = step === steps.length - 1

  // 대상 위치를 따라간다. 접기·펼치기, 창 크기, 스크롤에 맞춰 다시 잰다
  useEffect(() => {
    const root = container.current
    if (!root || !current) return
    const target = getTarget(current.id)
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const next = measure(root, target)
        setLayout((prev) => (sameLayout(prev, next) ? prev : next))
      })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(root)
    if (target) observer?.observe(target)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [container, getTarget, current])

  // 두 번째 단계부터는 대상이 화면 밖이면 보이게 끌어온다(모바일). 첫 단계는 페이지를 갑자기 움직이지 않는다
  useEffect(() => {
    if (step === 0 || !current) return
    getTarget(current.id)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [step, current, getTarget])

  // Esc = 건너뛰기. 컨테이너 안에 포커스가 있을 때만(다른 모달의 Esc를 가로채지 않는다)
  useEffect(() => {
    const root = container.current
    if (!root) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onSkip()
    }
    root.addEventListener('keydown', onKeyDown)
    return () => root.removeEventListener('keydown', onKeyDown)
  }, [container, onSkip])

  if (!current) return null

  const bubbleWidth = Math.min(BUBBLE_WIDTH, layout?.containerWidth || BUBBLE_WIDTH)
  const bubbleLeft = layout
    ? Math.max(0, Math.min(layout.left, layout.containerWidth - bubbleWidth))
    : 0
  const targetBottom = layout ? layout.top + layout.height : 0
  const containerHeight = layout?.containerHeight ?? 0
  const placement: 'below' | 'above' | 'inside' = !layout
    ? 'below'
    : containerHeight - targetBottom - GAP >= BUBBLE_HEIGHT
      ? 'below'
      : layout.top - GAP >= BUBBLE_HEIGHT
        ? 'above'
        : 'inside'
  const bubbleStyle =
    placement === 'below'
      ? { top: targetBottom + GAP }
      : placement === 'above'
        ? { bottom: containerHeight - layout!.top + GAP }
        : { bottom: containerHeight - targetBottom + GAP }
  // 꼬리는 대상 가운데를 가리키되 말풍선 모서리 밖으로 나가지 않게
  const arrowLeft = layout
    ? Math.max(
        ARROW_INSET,
        Math.min(layout.left + layout.width / 2 - bubbleLeft, bubbleWidth - ARROW_INSET),
      )
    : ARROW_INSET

  return (
    <div className={cx('pointer-events-none absolute inset-0 z-10', className)}>
      {layout && layout.width > 0 ? (
        <div
          aria-hidden
          data-testid="coachmark-highlight"
          // v4(2026-10-31): 보라 선 하나 + 옅은 번짐(두꺼운 고리 대신)
          className="absolute rounded-(--pf-radius-md) shadow-[0_0_0_1.5px_var(--pf-accent),0_0_0_7px_var(--pf-accent-soft)] transition-[top,left,width,height] duration-200 ease-(--pf-ease-out)"
          style={{
            top: layout.top - RING_PAD,
            left: layout.left - RING_PAD,
            width: layout.width + RING_PAD * 2,
            height: layout.height + RING_PAD * 2,
          }}
        />
      ) : null}

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="pointer-events-auto absolute flex flex-col gap-(--space-12) rounded-(--pf-radius-lg) bg-surface p-(--space-18) shadow-(--pf-shadow-pop) motion-safe:animate-[pf-rise_220ms_var(--pf-ease-out)_both]"
        style={{ ...bubbleStyle, left: bubbleLeft, width: bubbleWidth }}
      >
        {placement !== 'inside' ? (
          <span
            aria-hidden
            className={cx(
              'absolute size-(--space-10) rotate-45 bg-surface',
              placement === 'below' ? '-top-(--space-5)' : '-bottom-(--space-5)',
            )}
            style={{ left: arrowLeft - 5 }}
          />
        ) : null}

        <div className="flex items-center justify-between gap-(--space-8)">
          <p className="text-[12px] font-semibold text-muted tabular-nums">
            {step + 1} / {steps.length}
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="-mr-(--space-6) min-h-8 rounded-full px-(--space-8) text-[12.5px] font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            건너뛰기
          </button>
        </div>

        <div className="flex flex-col gap-(--space-6)">
          <h3
            id={titleId}
            className="text-[15.5px] leading-[1.35] font-[650] tracking-[-0.015em] text-ink"
          >
            {current.title}
          </h3>
          <p id={bodyId} className="text-[13.5px] leading-[1.55] break-keep text-ink-2">
            {current.body}
          </p>
        </div>

        <div className="flex items-center justify-end gap-(--space-8)">
          {step > 0 ? (
            <button
              type="button"
              onClick={onBack}
              className="min-h-10 rounded-full px-(--space-14) text-[13.5px] font-medium text-ink-2 transition-colors duration-150 hover:bg-ink/5 hover:text-ink"
            >
              이전
            </button>
          ) : null}
          <Button
            variant="ink"
            trailingIcon={isLast ? 'Check' : 'ArrowRight'}
            onClick={onNext}
            data-coachmark="next"
          >
            {isLast ? '완료' : '다음'}
          </Button>
        </div>
      </div>

      {/* 단계가 바뀔 때 읽어 준다. 말풍선 자체는 aria-live로 두지 않는다(버튼까지 다시 읽혀 시끄럽다) */}
      <p aria-live="polite" className="sr-only">
        {`${steps.length}단계 중 ${step + 1}단계, ${current.title}. ${current.body}`}
      </p>
    </div>
  )
}
