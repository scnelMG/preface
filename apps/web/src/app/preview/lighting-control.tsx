'use client'

import type { KeyboardEvent, PointerEvent } from 'react'

import type { ViewerLighting } from '@/features/viewer/types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const keyDirections: Record<string, readonly [number, number]> = {
  ArrowLeft: [-5, 0],
  ArrowRight: [5, 0],
  ArrowUp: [0, 5],
  ArrowDown: [0, -5],
}

export function LightingControl({
  value,
  onChange,
}: {
  value: ViewerLighting
  onChange: (value: ViewerLighting) => void
}) {
  const x = (value.azimuth + 90) / 180
  const y = 1 - (value.elevation + 60) / 140

  function move(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    onChange({
      ...value,
      azimuth: Math.round(
        clamp(((event.clientX - rect.left) / rect.width - 0.2) / 0.6, 0, 1) * 180 - 90,
      ),
      elevation: Math.round(
        80 - clamp(((event.clientY - rect.top) / rect.height - 0.2) / 0.6, 0, 1) * 140,
      ),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const direction = keyDirections[event.key]
    if (!direction) return
    event.preventDefault()
    onChange({
      ...value,
      azimuth: clamp(value.azimuth + direction[0], -90, 90),
      elevation: clamp(value.elevation + direction[1], -60, 80),
    })
  }

  return (
    <div className="pp-light-control">
      <button
        type="button"
        className="pp-light-pad"
        aria-label={`조명 위치. 방향 ${value.azimuth}도, 높이 ${value.elevation}도. 드래그하거나 방향키로 조절하세요.`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
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
        <svg className="pp-light-direction" viewBox="0 0 44 44" fill="none" aria-hidden="true">
          {/* 원 안의 경선·적도 없이 원 하나 위에 빛의 점만 둔다(2026-10-30) */}
          <circle cx="22" cy="22" r="18" />
        </svg>
        <span
          className="pp-light-source"
          style={{ left: `${20 + x * 60}%`, top: `${20 + y * 60}%` }}
        />
      </button>
      <span className="pp-light-label" aria-hidden="true">
        조명
      </span>
    </div>
  )
}
