import { create } from 'zustand'

/**
 * 화면 사이 모델 이어주기(2026-10-31). 작업실에서 고른 모델이 편집실 3D 자리로 날아가 이어진다.
 *
 *   start(작업실: 고른 모델 그림 + 화면 위치) → 'lift'(그 자리에서 살짝 떠오름)
 *     → land(편집실: 3D 자리) → 'fly'(그 자리로 날아감)
 *     → finish(편집실 3D 준비됨) → 'leave'(겹친 그림이 사라지며 진짜 3D가 드러남) → 'idle'
 *   cancel(): 시안을 못 만들었거나 너무 오래 걸리면 그 자리에서 사라진다.
 *   releaseHandoffTarget(): 도착한 편집실이 사라지면(3D가 뜨기 전에 뒤로 가기 등) 그림을 바로 지운다(-600).
 *
 * 그림은 이 탭 메모리의 data 주소다(개인 얼굴 그림이라 저장·전송하지 않는다). 그리는 쪽은 shared/ui/HandoffLayer.
 */
export interface HandoffRect {
  left: number
  top: number
  width: number
  height: number
}

type Phase = 'idle' | 'lift' | 'fly' | 'leave'

interface HandoffState {
  phase: Phase
  image: string | null
  from: HandoffRect | null
  to: HandoffRect | null
  /** 편집실 3D가 이미 준비됐다(날아가는 중에 준비되면 도착하자마자 사라진다) */
  ready: boolean
  start: (image: string, from: HandoffRect) => void
  land: (to: HandoffRect) => void
  finish: () => void
  cancel: () => void
  clear: () => void
}

export const useHandoff = create<HandoffState>((set, get) => ({
  phase: 'idle',
  image: null,
  from: null,
  to: null,
  ready: false,
  start: (image, from) => set({ phase: 'lift', image, from, to: null, ready: false }),
  land: (to) => {
    if (get().phase === 'lift') set({ phase: 'fly', to })
  },
  finish: () => {
    const { phase } = get()
    if (phase === 'fly' || phase === 'lift') set({ ready: true })
  },
  cancel: () => {
    if (get().phase !== 'idle') set({ phase: 'leave' })
  },
  clear: () => set({ phase: 'idle', image: null, from: null, to: null, ready: false }),
}))

/** 이어주기를 기다리는 중인가(편집실이 도착 자리를 알릴지 정한다) */
export const isHandoffPending = () => useHandoff.getState().phase === 'lift'

let pendingRelease = 0

/**
 * 머리가 내려앉은 편집실 3D 자리가 사라졌다(뒤로 가기·다른 메뉴, 화면 보관으로 숨겨짐 포함).
 * 떠 있던 그림이 다음 화면(작업실) 위에 잔상으로 남지 않게 옅어지기 없이 바로 지운다(-600).
 * 개발 모드(StrictMode)는 effect를 떼었다 바로 다시 붙이므로 한 박자 미루고, 다시 붙으면 `holdHandoffTarget`이 취소한다.
 */
export function releaseHandoffTarget() {
  window.clearTimeout(pendingRelease)
  pendingRelease = window.setTimeout(() => {
    pendingRelease = 0
    if (useHandoff.getState().phase !== 'idle') useHandoff.getState().clear()
  }, 0)
}

/** 도착 자리가 다시 붙었다(개발 모드의 다시 붙이기). 미뤄 둔 지우기를 취소한다 */
export function holdHandoffTarget() {
  window.clearTimeout(pendingRelease)
  pendingRelease = 0
}
