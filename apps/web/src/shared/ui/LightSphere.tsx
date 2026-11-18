'use client'

import type { KeyboardEvent, PointerEvent } from 'react'
import type { ViewerLighting } from '@/features/viewer/types'
import { cx } from './cx'
import { Tooltip } from './Tooltip'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const AZIMUTH = 90
const ELEVATION: readonly [number, number] = [-60, 80]
const KEY_STEPS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-5, 0],
  ArrowRight: [5, 0],
  ArrowUp: [0, 5],
  ArrowDown: [0, -5],
}

/**
 * 조명 구(2026-10-30). 작은 구 하나에 빛 받는 면이 밝게 칠해지고, 빛이 닿는 점이 찍힌다.
 * 구 위를 누르거나 끌면 그 자리에서 빛이 오고, 방향키로 5°씩 옮긴다. 메인·편집실이 같이 쓴다.
 */
export function LightSphere({
  value,
  onChange,
  size = 32,
  className,
}: {
  value: ViewerLighting
  onChange: (value: ViewerLighting) => void
  size?: number
  className?: string
}) {
  // 구 안의 위치(%): 가운데가 정면 빛, 위로 갈수록 높은 빛
  const x = 50 + (value.azimuth / AZIMUTH) * 32
  const y = 50 - (value.elevation / ELEVATION[1]) * 32

  function move(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = clamp(((event.clientX - rect.left) / rect.width - 0.5) / 0.32, -1, 1)
    const dy = clamp(((event.clientY - rect.top) / rect.height - 0.5) / 0.32, -1, 1)
    onChange({
      ...value,
      azimuth: Math.round(dx * AZIMUTH),
      elevation: Math.round(clamp(-dy * ELEVATION[1], ELEVATION[0], ELEVATION[1])),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = KEY_STEPS[event.key]
    if (!step) return
    event.preventDefault()
    onChange({
      ...value,
      azimuth: clamp(value.azimuth + step[0], -AZIMUTH, AZIMUTH),
      elevation: clamp(value.elevation + step[1], ELEVATION[0], ELEVATION[1]),
    })
  }

  // 말풍선 '조명'(아이콘만으로는 뜻이 안 보인다). 무대 오른쪽 위에 놓이므로 오른쪽 맞춤. 끌기 시작하면 사라진다
  return (
    <Tooltip label="조명" align="end">
      {(describedBy) => (
        <button
          type="button"
          aria-describedby={describedBy}
          aria-label={`조명 위치. 방향 ${value.azimuth}도, 높이 ${value.elevation}도. 끌거나 방향키로 조절하세요.`}
          className={cx(
            'relative shrink-0 touch-none rounded-full shadow-[inset_0_-1px_2px_oklch(0.2_0.01_286/0.2)] transition-transform duration-(--pf-dur-press) ease-(--pf-ease-out) active:scale-95',
            className,
          )}
          style={{
            width: size,
            height: size,
            background: `radial-gradient(circle at ${x}% ${y}%, oklch(0.97 0 0) 0%, oklch(0.8 0.006 286) 28%, oklch(0.42 0.01 286) 80%, oklch(0.3 0.01 286) 100%)`,
          }}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            move(event)
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event)
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-surface shadow-[0_0_3px_oklch(1_0_0/0.9)]"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        </button>
      )}
    </Tooltip>
  )
}
