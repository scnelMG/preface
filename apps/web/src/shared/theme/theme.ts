'use client'

import { useSyncExternalStore } from 'react'
import { THEME_STORAGE_KEY } from './initScript'

/**
 * 화면 밝기(2026-10-31). 기본은 밝은 화면(개발 서버와 같은 색), 머리줄 버튼으로 어두운 화면을 고를 수 있다.
 *
 * - 고른 값은 이 기기에만 남는다(localStorage). 서버로 보내지 않는다.
 * - `<html data-theme="dark">`가 붙으면 shared/design/system.css의 어두운 토큰과 shared/theme/dark.css가 쓰인다.
 * - 첫 그림이 깜빡이지 않게 layout.tsx가 `THEME_INIT_SCRIPT`(initScript.ts)로 하이드레이션 전에 같은 값을 먼저 붙인다.
 */
export type Theme = 'light' | 'dark'

const CHANGE_EVENT = 'preface:theme'

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
  try {
    if (theme === 'dark') localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    else localStorage.removeItem(THEME_STORAGE_KEY)
  } catch {
    // 저장소를 못 써도(사생활 보호 창 등) 이번 화면에서는 바뀐다
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  // 하이드레이션은 서버 값(light)으로 그린다. 구독 직후 한 번 다시 읽게 해 저장된 dark를 놓치지 않는다
  queueMicrotask(onChange)
  return () => window.removeEventListener(CHANGE_EVENT, onChange)
}

/** 지금 화면 밝기. 서버 그림에서는 기본(light)으로 본다 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'light')
}
