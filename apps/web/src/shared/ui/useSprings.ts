'use client'
import { useEffect, useRef } from 'react'

/**
 * 조작 카드 공용 스프링. 감쇠·반응(Apple Fluid Interfaces의 damping·response)으로 정한다.
 * 목표가 바뀌면 지금 화면의 값·속도에서 이어서 움직인다(중간에 다시 눌러도 끊기지 않는다).
 * React 상태를 매 프레임 바꾸지 않고 `onFrame`으로 요소 스타일을 직접 쓴다.
 */
export interface SpringOptions {
  /** 1이면 넘침 없음 */
  damping?: number
  /** 목표에 닿는 빠르기(초). 지속 시간이 아니다 */
  response?: number
}

export function useSprings<K extends string>(
  targets: Record<K, number> | null,
  onFrame: (values: Record<K, number>, velocities: Record<K, number>) => void,
  { damping = 1, response = 0.32 }: SpringOptions = {},
) {
  const state = useRef<{ x: Record<string, number>; v: Record<string, number> } | null>(null)
  const frame = useRef(0)
  const draw = useRef(onFrame)
  useEffect(() => {
    draw.current = onFrame
  })
  const key = targets ? JSON.stringify(targets) : ''
  useEffect(() => {
    if (!targets) return
    const goal = targets as Record<string, number>
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // 처음이거나 동작 줄이기면 바로 놓는다
    if (!state.current || reduce) {
      state.current = {
        x: { ...goal },
        v: Object.fromEntries(Object.keys(goal).map((k) => [k, 0])),
      }
      draw.current(state.current.x as Record<K, number>, state.current.v as Record<K, number>)
      return
    }
    const stiffness = ((2 * Math.PI) / response) ** 2
    const friction = (4 * Math.PI * damping) / response
    let last = performance.now()
    cancelAnimationFrame(frame.current)
    const tick = (now: number) => {
      const s = state.current!
      // 탭이 숨었다 돌아오면 큰 dt로 튀지 않게 자른다
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now
      let moving = false
      for (const k of Object.keys(goal)) {
        const x = s.x[k] ?? goal[k]
        const v = s.v[k] ?? 0
        const a = -stiffness * (x - goal[k]) - friction * v
        const nv = v + a * dt
        const nx = x + nv * dt
        s.v[k] = nv
        s.x[k] = nx
        if (Math.abs(nx - goal[k]) > 0.05 || Math.abs(nv) > 0.5) moving = true
      }
      if (!moving)
        for (const k of Object.keys(goal)) {
          s.x[k] = goal[k]
          s.v[k] = 0
        }
      draw.current(s.x as Record<K, number>, s.v as Record<K, number>)
      if (moving) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
    // key가 targets의 값 비교를 대신한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, damping, response])
}
