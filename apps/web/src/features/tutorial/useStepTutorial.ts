'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TutorialStep } from './steps'
import { useTutorial, type Tutorial } from './useTutorial'

const DEFAULT_DELAY = 700

export interface StepTutorial<Id extends string = string> extends Tutorial {
  /** 이 기기에서 처음이라 안내를 띄울 차례다(화면 준비 여부는 부르는 쪽이 본다) */
  active: boolean
  steps: readonly TutorialStep<Id>[]
  current: TutorialStep<Id>
  /** 지금 단계를 해 봤다. 잠시 뒤 저절로 넘어간다 */
  stepDone: boolean
  /** 그 단계의 행동을 해 봤다고 알린다. 지금 단계가 아니면 무시한다 */
  signal: (id: Id) => void
}

/**
 * 해 보면 넘어가는 단계 안내(메인·편집실 공통, 2026-11-03).
 * 기록(완료·건너뛰기)은 `useTutorial`이 기기별 localStorage에 남긴다.
 */
export function useStepTutorial<Id extends string>(
  steps: readonly TutorialStep<Id>[],
  storageKey: string,
): StepTutorial<Id> {
  const tutorial = useTutorial(steps.length, storageKey)
  const [doneStep, setDoneStep] = useState<number | null>(null)
  const active = tutorial.status === 'active'
  const current = steps[tutorial.step]
  const { step, next, goTo: moveTo } = tutorial
  const delay = current?.advanceDelay ?? DEFAULT_DELAY

  // 해 본 단계는 잠시 뒤 넘긴다. 그사이 `다음`을 눌러 먼저 넘겼으면(단계가 바뀌면) 취소된다
  useEffect(() => {
    if (doneStep === null || doneStep !== step) return
    const timer = setTimeout(() => {
      setDoneStep(null)
      next()
    }, delay)
    return () => clearTimeout(timer)
  }, [doneStep, step, next, delay])

  // 단계를 골라 옮기면 해 본 표시를 지운다. 다시 그 단계로 와도 저절로 넘어가지 않고 새로 해 볼 수 있다
  const goTo = useCallback(
    (target: number) => {
      setDoneStep(null)
      moveTo(target)
    },
    [moveTo],
  )

  function signal(id: Id) {
    if (active && current?.id === id && doneStep !== step) setDoneStep(step)
  }

  return { ...tutorial, goTo, active, steps, current, stepDone: doneStep === step, signal }
}
