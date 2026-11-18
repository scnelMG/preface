'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import {
  clearTutorialRecord,
  readTutorialRecord,
  subscribeTutorialRecord,
  TUTORIAL_STORAGE_KEY,
  writeTutorialRecord,
} from './storage'

/**
 * - `checking`: 서버 렌더·첫 하이드레이션. 기기 기록을 아직 못 읽었다. 아무것도 띄우지 않는다(깜빡임 방지)
 * - `active`: 처음 쓰는 기기. 단계 안내를 띄운다
 * - `done`: 이 기기에서 완료했거나 건너뛰었다
 */
export type TutorialStatus = 'checking' | 'active' | 'done'

export interface Tutorial {
  status: TutorialStatus
  /** 0부터 */
  step: number
  total: number
  /** 마지막 단계에서 부르면 완료로 저장한다 */
  next: () => void
  back: () => void
  /** 그 단계로 바로 옮긴다(앞뒤 모두). 마지막 단계로 옮겨도 완료로 남기지 않는다 */
  goTo: (step: number) => void
  skip: () => void
  complete: () => void
  /** 기록을 지우고 처음 단계부터 다시 보여 준다("튜토리얼 다시 보기") */
  restart: () => void
}

/** 서버 스냅샷. 클라이언트 스냅샷(null 또는 기록)과 달라야 하이드레이션 뒤에 다시 읽는다 */
const UNKNOWN = 'unknown'

export function useTutorial(total: number, storageKey: string = TUTORIAL_STORAGE_KEY): Tutorial {
  const record = useSyncExternalStore(
    subscribeTutorialRecord,
    () => readTutorialRecord(storageKey),
    () => UNKNOWN,
  )
  const [step, setStep] = useState(0)

  const status: TutorialStatus = record === UNKNOWN ? 'checking' : record ? 'done' : 'active'

  const complete = useCallback(() => writeTutorialRecord('completed', storageKey), [storageKey])
  const skip = useCallback(() => writeTutorialRecord('skipped', storageKey), [storageKey])
  const next = useCallback(() => {
    if (step >= total - 1) complete()
    else setStep(step + 1)
  }, [step, total, complete])
  const back = useCallback(() => setStep((prev) => Math.max(0, prev - 1)), [])
  const goTo = useCallback(
    (target: number) => setStep(Math.max(0, Math.min(total - 1, Math.trunc(target)))),
    [total],
  )
  const restart = useCallback(() => {
    setStep(0)
    clearTutorialRecord(storageKey)
  }, [storageKey])

  return {
    status,
    step: Math.min(step, total - 1),
    total,
    next,
    back,
    goTo,
    skip,
    complete,
    restart,
  }
}
