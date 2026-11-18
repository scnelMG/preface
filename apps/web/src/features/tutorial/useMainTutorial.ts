'use client'

import { useRef, useState, type PointerEvent } from 'react'
import { LOOK_GESTURES, MAIN_TUTORIAL_STEPS, type LookGesture, type MainStepId } from './steps'
import { MAIN_TUTORIAL_STORAGE_KEY } from './storage'
import { useStepTutorial, type StepTutorial } from './useStepTutorial'

/** 누른 자리에서 이만큼(px) 움직여야 끌기로 본다. 그냥 누르기는 체크하지 않는다 */
const DRAG_THRESHOLD = 6

export interface MainTutorial extends StepTutorial<MainStepId> {
  /** 1단계에서 해 본 조작 */
  looked: ReadonlySet<LookGesture>
  /** 1단계 조작을 해 봤다고 알린다. 넷 다 해 보면 다음 단계로 넘어간다 */
  markLook: (...gestures: LookGesture[]) => void
}

/** 메인 체험 튜토리얼 진행(REQ-F-09). 기록은 `preface.tutorial.v2`에 기기별로 남는다 */
export function useMainTutorial(): MainTutorial {
  const tutorial = useStepTutorial(MAIN_TUTORIAL_STEPS, MAIN_TUTORIAL_STORAGE_KEY)
  const [looked, setLooked] = useState<ReadonlySet<LookGesture>>(() => new Set())

  function markLook(...gestures: LookGesture[]) {
    if (!tutorial.active || tutorial.current.id !== 'look') return
    const fresh = gestures.filter((gesture) => !looked.has(gesture))
    if (fresh.length === 0) return
    const updated = new Set([...looked, ...fresh])
    setLooked(updated)
    if (LOOK_GESTURES.every((gesture) => updated.has(gesture))) tutorial.signal('look')
  }

  return { ...tutorial, looked, markLook }
}

/**
 * 3D 위 끌기·휠을 보고 어떤 조작을 했는지 알려 준다. 캔버스를 감싼 요소에 붙인다(캡처 단계라 3D 조작을 막지 않는다).
 * FaceViewer 조작과 맞춘다: 마우스 왼쪽 회전·휠 확대·오른쪽(또는 Ctrl·Shift+왼쪽) 이동, 터치 한 손가락 회전·두 손가락 확대·이동.
 */
export function useLookGestures(mark: (...gestures: LookGesture[]) => void) {
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  const release = (event: PointerEvent) => {
    pointers.current.delete(event.pointerId)
  }

  return {
    onPointerDownCapture(event: PointerEvent) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    },
    onPointerMoveCapture(event: PointerEvent) {
      const start = pointers.current.get(event.pointerId)
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return
      if (event.pointerType === 'mouse') {
        const modified = event.ctrlKey || event.metaKey || event.shiftKey
        if (event.buttons & 2 || (event.buttons & 1 && modified)) mark('pan')
        else if (event.buttons & 1) mark('rotate')
      } else if (pointers.current.size >= 2) {
        mark('zoom', 'pan')
      } else {
        mark('rotate')
      }
    },
    onPointerUpCapture: release,
    onPointerCancelCapture: release,
    onWheelCapture() {
      mark('zoom')
    },
  }
}
