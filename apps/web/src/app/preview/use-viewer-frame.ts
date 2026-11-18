'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FaceViewerProps } from '@/features/viewer/types'

type ViewportFrame = NonNullable<FaceViewerProps['viewportFrame']>

/**
 * 모든 시안 화면이 같은 크기·중심 기준으로 확장 캔버스를 사용한다.
 * `adjust`는 잰 값(조작 영역 기준)을 화면별로 고친다. 확장 캔버스 크기를 함께 받는다(메인 휴대폰 체험, -526).
 * 조작 영역의 실제 크기도 받는다. 잰 값의 높이는 500px에서 자르므로, 더 크게 그릴 화면은 이 크기로 다시 정한다(메인 데스크톱, -840)
 */
export function useViewerFrame(
  sceneSelector?: string,
  adjust?: (
    frame: ViewportFrame,
    canvas: { width: number; height: number },
    area: { width: number; height: number },
  ) => ViewportFrame,
) {
  const slot = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<FaceViewerProps['viewportFrame']>()
  // 관찰자는 한 번만 만들고, 크기가 바뀔 때 그 순간의 adjust를 읽는다(레이아웃 직후에 갱신해 첫 측정부터 맞춘다)
  const adjustRef = useRef(adjust)
  useLayoutEffect(() => {
    adjustRef.current = adjust
  })
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!slot.current || !canvas.current) return
      const area = slot.current.getBoundingClientRect()
      const scene = sceneSelector ? slot.current.closest(sceneSelector) : null
      if (scene) {
        const bounds = scene.getBoundingClientRect()
        Object.assign(canvas.current.style, {
          left: `${bounds.left - area.left}px`,
          top: `${bounds.top - area.top}px`,
          right: 'auto',
          bottom: 'auto',
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
        })
      }
      const expanded = canvas.current.getBoundingClientRect()
      if (expanded.width <= 0 || expanded.height <= 0) return
      const measured = {
        width: area.width,
        height: Math.min(area.height, 500),
        offsetX: expanded.width / 2 - (area.left - expanded.left + area.width / 2),
        offsetY: expanded.height / 2 - (area.top - expanded.top + area.height / 2),
      }
      const next = adjustRef.current
        ? adjustRef.current(
            measured,
            { width: expanded.width, height: expanded.height },
            { width: area.width, height: area.height },
          )
        : measured
      setFrame((old) =>
        old?.width === next.width &&
        old?.height === next.height &&
        old?.offsetX === next.offsetX &&
        old?.offsetY === next.offsetY
          ? old
          : next,
      )
    })
    if (slot.current) observer.observe(slot.current)
    if (canvas.current) observer.observe(canvas.current)
    const scene = sceneSelector ? slot.current?.closest(sceneSelector) : null
    if (scene) observer.observe(scene)
    return () => observer.disconnect()
  }, [sceneSelector])
  return { slot, canvas, frame }
}
