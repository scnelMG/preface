'use client'
import { useId, useRef, useState, type ReactNode } from 'react'
import './controls.css'

/**
 * 조작 카드의 값 고르기. 위 줄 `아이콘 이름 … 값`, 아래 줄 슬라이더.
 *
 * - 사이트 슬라이더와 같은 검정 형태: 2px 바탕 줄, 원본에서 바뀐 만큼 잉크로 채움, 14px 검정 손잡이.
 * - 실제 값·키보드·읽기 프로그램은 줄을 덮은 투명 `input[type=range]`가 맡는다(역할 slider).
 *   그래서 바깥의 "손을 뗄 때 저장"(native `change`) 규칙이 그대로 동작한다.
 * - 기본값을 지나가면 걸림: 휴대폰은 5ms 진동(지원할 때만), 손잡이는 한 번 커졌다 돌아온다.
 * - 두 번 누르면 기본값으로 돌아가고 저장한다.
 */
export function RulerFader({
  label,
  ariaLabel = label,
  code,
  icon,
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  onChange,
  onSelect,
  formatValue,
  formatAriaValue = formatValue,
  disabled,
  changed,
  recommended,
}: {
  label: string
  ariaLabel?: string
  code?: string
  /** 이름 앞 작은 선 아이콘(무엇이 어느 방향으로 바뀌는지) */
  icon?: ReactNode
  value: number
  min: number
  max: number
  step?: number
  /** 원본 값. 없으면 양쪽 범위는 0, 한쪽 범위는 min */
  defaultValue?: number
  onChange: (value: number) => void
  onSelect?: () => void
  formatValue: (value: number) => string
  formatAriaValue?: (value: number) => string
  disabled?: boolean
  changed?: boolean
  recommended?: boolean
}) {
  const recommendationId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [detent, setDetent] = useState(0)
  const base = defaultValue ?? (min < 0 && max > 0 ? 0 : min)
  const span = max - min || 1
  const p = Math.max(0, Math.min(1, (value - min) / span))
  const origin = Math.max(0, Math.min(1, (base - min) / span))
  const display = formatValue(value)
  const isChanged = changed ?? Math.abs(value - base) > step / 2
  // 손잡이가 줄 밖으로 반쯤 나가지 않게 손잡이 지름만큼 안쪽에서 움직인다(native range의 손잡이 이동 범위와 같다)
  const at = (t: number) => `calc(${t} * (100% - var(--knob)) + var(--knob) / 2)`

  function update(next: number) {
    // 기본값을 가로지르면 걸림 피드백
    if ((value - base) * (next - base) < 0 || (value !== base && next === base)) {
      setDetent((n) => n + 1)
      // 사용자가 페이지를 한 번이라도 조작한 뒤에만 진동한다(그 전 호출은 브라우저가 막고 콘솔 오류를 남긴다)
      if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive)
        navigator.vibrate?.(5)
    }
    onChange(next)
  }

  return (
    <div
      className="cc-fader"
      data-code={code}
      data-changed={isChanged}
      data-dragging={dragging}
      // 같은 이름의 애니메이션은 다시 재생되지 않아 두 이름을 번갈아 쓴다(요소를 다시 그리면 끌던 입력이 끊긴다)
      data-detent={detent === 0 ? undefined : detent % 2 ? 'a' : 'b'}
      data-disabled={disabled || undefined}
    >
      <div className="cc-fader-head" aria-hidden="true">
        <span className="cc-fader-label">
          {icon ? <span className="cc-icon">{icon}</span> : null}
          {label}
          {recommended ? (
            <span
              id={recommendationId}
              className="type-caption rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent"
            >
              추천
            </span>
          ) : null}
        </span>
        <output className="cc-fader-value">{display}</output>
      </div>
      <div className="cc-ruler">
        <span aria-hidden="true" className="cc-track" />
        <span
          aria-hidden="true"
          className="cc-fill"
          style={{
            left: at(Math.min(origin, p)),
            width: `calc(${Math.abs(p - origin)} * (100% - var(--knob)))`,
          }}
        />
        <span aria-hidden="true" className="cc-bead" style={{ left: at(p) }} />
        <input
          ref={input}
          type="range"
          className="cc-input"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={recommended ? recommendationId : undefined}
          aria-valuetext={formatAriaValue(value)}
          onChange={(event) => update(Number(event.target.value))}
          onFocus={disabled ? undefined : onSelect}
          onPointerDown={() => {
            if (disabled) return
            onSelect?.()
            setDragging(true)
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onBlur={() => setDragging(false)}
          onDoubleClick={() => {
            if (disabled || value === base) return
            update(base)
            // 미리보기가 반영된 뒤 저장(바깥은 native change에서 저장한다)
            requestAnimationFrame(() =>
              input.current?.dispatchEvent(new Event('change', { bubbles: true })),
            )
          }}
        />
        <span aria-hidden="true" className="cc-focus" />
      </div>
    </div>
  )
}
