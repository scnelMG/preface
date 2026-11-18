import type { Vec3 } from './captureQuality'

type Listener = (position: Vec3) => void

/**
 * 나란히 놓인 비교 뷰어끼리 회전을 맞춘다(S15P31B204-706). 한 뷰어가 돌리면 나머지가 같은 위치로 옮긴다.
 * 받는 쪽이 다시 알리면서 생기는 되먹임은 `busy`로 끊는다.
 */
export interface CameraLink {
  subscribe(id: symbol, listener: Listener): () => void
  publish(from: symbol, position: Vec3): void
}

export function createCameraLink(): CameraLink {
  const listeners = new Map<symbol, Listener>()
  let busy = false
  return {
    subscribe(id, listener) {
      listeners.set(id, listener)
      return () => {
        listeners.delete(id)
      }
    },
    publish(from, position) {
      if (busy) return
      busy = true
      try {
        for (const [id, listener] of listeners) if (id !== from) listener(position)
      } finally {
        busy = false
      }
    },
  }
}
