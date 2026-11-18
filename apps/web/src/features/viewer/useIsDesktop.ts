'use client'

import { useSyncExternalStore } from 'react'

/** apps/web/AGENTS.md "브레이크포인트": md(768px) 이상을 Desktop으로 본다 */
const DESKTOP_QUERY = '(min-width: 768px)'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * 화면이 Desktop 폭인지. 서버 렌더에서는 Desktop으로 본다(Figma 기본 프레임).
 * 모바일은 3D 뷰를 하나만 그려야 해서(FN-EDIT-01 수용 3) CSS가 아니라 JS로 갈라야 한다.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  )
}
