'use client'

import type { CSSProperties } from 'react'
import { cx } from './cx'
import { formatPercent } from './format'

/**
 * Figma `v3/SliderRow` — 항목 이름 · 값 · 슬라이더 · 양 끝 문구.
 * Wireframe v3.2 "직접 조절(P3-68): 값 %"에 따라 값은 %로 보인다(기본 formatPercent).
 *
 * 2026-10-30 단순화: 항목별 되돌리기(⟲)는 없앴다. 되돌리기는 패널의 "처음으로"·이력 되돌리기 하나로 모은다.
 * 이름은 왼쪽, 값은 오른쪽 끝에 두고, 값은 원본(0)이 아닐 때만 보라로 칠한다(보라는 바뀐 값에만).
 * 2026-10-31: 값은 줄마다 같은 자리(오른쪽 위)·같은 크기에 둔다. 아래 가운데 값은 없앴다.
 * 여러 줄인 묶음(코끝)은 묶음 이름을 위에 한 번(SliderGroupTitle), 줄마다 작은 항목 이름(tier="sub": 돌출·높이)을 단다.
 */

export interface SliderRowProps {
  label: string
  /** 부위 그룹 안에서 짧은 화면 이름과 구분할 접근성 이름 */
  ariaLabel?: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  minLabel?: string
  maxLabel?: string
  formatValue?: (value: number) => string
  disabled?: boolean
  /** main = 묶음 이름(15px), sub = 묶음 안 항목 이름(13px, 흐리게). 여러 줄인 묶음에서 쓴다 */
  tier?: 'main' | 'sub'
  /** 줄 사이를 좁힌다(이름 줄 · 트랙 · 양 끝 문구 간격 20 → 8). 한 화면에 여러 줄을 담을 때 쓴다 */
  compact?: boolean
  className?: string
}

export function SliderRow({
  label,
  ariaLabel = label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  minLabel = '작게',
  maxLabel = '크게',
  formatValue = formatPercent,
  disabled,
  tier = 'main',
  compact = false,
  className,
}: SliderRowProps) {
  const display = formatValue(value)
  const position = (v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100)
  // 0이 원본인 양쪽 범위는 가운데(0)에서 값까지만 칠한다. 한쪽 범위는 왼쪽 끝부터 칠한다
  const origin = min < 0 && max > 0 ? position(0) : 0
  const fillFrom = Math.min(origin, position(value))
  const fill = Math.max(origin, position(value))
  const changed = Math.round(value * 100) !== 0
  const valueOutput = (
    <output
      aria-live="polite"
      className={cx(
        // 값은 랜딩 슬라이더와 같은 고정폭 숫자(v6). 원본(0)이 아닐 때만 보라
        'min-w-[44px] text-right font-mono text-[13px] leading-[16px] tabular-nums',
        changed ? 'text-brand-violet' : 'text-text-muted',
      )}
    >
      {display}
    </output>
  )

  return (
    <div
      className={cx(
        'flex w-full flex-col',
        compact ? 'gap-(--space-8)' : 'gap-(--space-20)',
        className,
      )}
    >
      {/* 이름 줄: 이름 · 값. 값은 줄마다 같은 자리에 둔다 */}
      <div
        className={cx(
          'flex items-center justify-between gap-(--space-8)',
          tier === 'sub' ? 'h-[20px]' : 'h-[24px]',
        )}
      >
        <span
          className={cx(
            'whitespace-nowrap',
            tier === 'sub'
              ? 'text-[13px] font-medium text-muted-soft'
              : 'text-[15px] font-semibold tracking-[-0.015em] text-ink-2',
          )}
        >
          {label}
        </span>
        {valueOutput}
      </div>

      {/* 트랙·손잡이 모양은 components.css의 slider-range */}
      <div className="relative h-[4px] w-full">
        <input
          type="range"
          className="slider-range"
          style={{ '--fill-from': `${fillFrom}%`, '--fill': `${fill}%` } as CSSProperties}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-valuetext={display}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>

      <div className="type-kr-caption-9-regular-lh11p7 flex h-[13px] items-start justify-between whitespace-nowrap text-text-muted">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}

/** 여러 줄인 묶음의 이름(코끝). 묶음 이름 줄과 같은 글씨로, 값 없이 한 번만 둔다 */
export function SliderGroupTitle({ children }: { children: string }) {
  return (
    <span className="flex h-[24px] items-center text-[15px] font-semibold tracking-[-0.015em] whitespace-nowrap text-ink-2">
      {children}
    </span>
  )
}
