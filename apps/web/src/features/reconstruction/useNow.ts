'use client'

import { useEffect, useState } from 'react'

/**
 * 지금 시각(ms)을 `intervalMs`마다 다시 센다. 경과 시간 표시용.
 * 마운트 뒤에만 센다(서버 렌더와 첫 화면이 어긋나지 않게). 그 전에는 null.
 */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
