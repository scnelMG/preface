'use client'

import { useEffect, useRef } from 'react'
import { useHandoff, type HandoffRect } from '@/shared/state/handoff'

/** 떠오른 모양(작업실에서 집어 든 느낌) */
const LIFTED = 'translateY(-6px) scale(1.03)'
const EASE_FLY = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** 시안을 만들고 편집실이 열리기까지 이보다 오래 걸리면 그 자리에서 사라진다 */
const LIFT_TIMEOUT = 6500
/** 도착한 뒤 3D 준비를 이만큼만 기다린다 */
const READY_TIMEOUT = 3000

/**
 * 화면 사이 모델 이어주기 층(2026-10-31). 루트 레이아웃에 하나 둔다(작업실 → 편집실·체험 실험실, 레이아웃이 달라도 이어진다).
 * 고른 모델 그림을 화면 위에 띄워: 떠오름(lift) → 편집실 3D 자리로 날아감(fly, FLIP) → 진짜 3D가 준비되면 사라짐(leave).
 * 상태는 shared/state/handoff. 움직임 줄이기면 작업실에서 시작하지 않는다(이 층도 그리지 않는다).
 */
export function HandoffLayer() {
  const phase = useHandoff((s) => s.phase)
  const image = useHandoff((s) => s.image)
  const from = useHandoff((s) => s.from)
  const to = useHandoff((s) => s.to)
  const ready = useHandoff((s) => s.ready)
  const element = useRef<HTMLImageElement>(null)
  const flown = useRef(false)

  // 떠오름 + 너무 오래 걸리면 취소
  useEffect(() => {
    if (phase !== 'lift') return
    flown.current = false
    element.current?.animate([{ transform: 'none' }, { transform: LIFTED }], {
      duration: 260,
      easing: 'ease-out',
      fill: 'forwards',
    })
    const timer = window.setTimeout(() => useHandoff.getState().cancel(), LIFT_TIMEOUT)
    return () => window.clearTimeout(timer)
  }, [phase])

  // 날아가기: 도착 자리에 놓고, 출발 자리에서 거꾸로 당겨 온다(FLIP)
  useEffect(() => {
    const node = element.current
    if (phase !== 'fly' || !node || !from || !to) return
    const flight = node.animate(
      [{ transform: `${invert(from, to)} ${LIFTED}` }, { transform: 'none' }],
      { duration: 680, easing: EASE_FLY, fill: 'forwards' },
    )
    let timer = 0
    flight.finished
      .then(() => {
        flown.current = true
        if (useHandoff.getState().ready) useHandoff.getState().cancel()
        else timer = window.setTimeout(() => useHandoff.getState().cancel(), READY_TIMEOUT)
      })
      .catch(() => {})
    return () => window.clearTimeout(timer)
  }, [phase, from, to])

  // 도착한 뒤 3D가 준비되면 사라진다
  useEffect(() => {
    if (ready && flown.current) useHandoff.getState().cancel()
  }, [ready])

  // 사라지기: 진짜 3D 위에서 옅어진다
  useEffect(() => {
    const node = element.current
    if (phase !== 'leave') return
    if (!node) {
      useHandoff.getState().clear()
      return
    }
    const fade = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 320,
      easing: 'ease-out',
      fill: 'forwards',
    })
    fade.finished.then(() => useHandoff.getState().clear()).catch(() => {})
  }, [phase])

  if (phase === 'idle' || !image || !from) return null
  const box = phase === 'lift' || !to ? from : to
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 화면에서 바로 뜬 그림(data 주소)
    <img
      ref={element}
      src={image}
      alt=""
      aria-hidden="true"
      className="pf-handoff"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    />
  )
}

/** 도착 자리(to)에 놓인 요소를 출발 자리(from)처럼 보이게 하는 변환 */
function invert(from: HandoffRect, to: HandoffRect) {
  const sx = from.width / to.width
  const sy = from.height / to.height
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`
}
