'use client'

import { useState, useSyncExternalStore } from 'react'
import {
  DEV_AUTH_QUERY,
  type DevAuthMode,
  installMockApi,
  readDevAuthMode,
  writeDevAuthMode,
} from './mockApi'

/**
 * 개발 서버 전용 회원·게스트 보기 전환(S15P31B204-460). 루트 layout이 개발 모드에서만 그린다.
 *
 * 가짜 API는 모듈을 읽을 때 바로 건다. AuthBootstrap의 세션 복구(effect)보다 먼저 걸려야 한다.
 */
function bootstrap(): DevAuthMode | null {
  // 운영 번들에 모듈이 남더라도 가짜 API는 절대 걸지 않는다
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const requested = url.searchParams.get(DEV_AUTH_QUERY)
  if (requested === 'member' || requested === 'guest') {
    writeDevAuthMode(requested)
    url.searchParams.delete(DEV_AUTH_QUERY)
    window.history.replaceState(window.history.state, '', url.toString())
  }
  const mode = readDevAuthMode()
  if (mode) installMockApi(mode)
  return mode
}

const initialMode = bootstrap()

const OPTIONS: { value: DevAuthMode | null; label: string; hint: string }[] = [
  { value: null, label: '실제', hint: '실제 백엔드로 요청' },
  { value: 'guest', label: '게스트', hint: '비로그인 화면' },
  { value: 'member', label: '회원', hint: '예시 회원 데이터' },
]

const subscribe = () => () => {}

export function DevAuthView() {
  const [open, setOpen] = useState(false)
  // 서버 HTML은 모드를 모른다. 하이드레이션이 끝난 뒤 저장된 모드를 그린다
  const mode = useSyncExternalStore(
    subscribe,
    () => initialMode,
    () => null,
  )

  const choose = (value: DevAuthMode | null) => {
    if (value === initialMode) return
    writeDevAuthMode(value)
    // 메모리의 토큰·스토어를 비우려고 새로 읽는다. 주소에 남은 `devAuth`가 고른 값을 덮지 않게 뺀다
    const url = new URL(window.location.href)
    url.searchParams.delete(DEV_AUTH_QUERY)
    window.location.replace(url.toString())
  }

  const current = OPTIONS.find((option) => option.value === mode) ?? OPTIONS[0]

  return (
    <div
      className="fixed right-4 bottom-4 z-[9999] flex items-center gap-1 rounded-full border border-line-default bg-white/90 p-1 text-[12px] leading-none text-text-ink shadow-[0_6px_24px_rgba(0,0,0,0.08)] backdrop-blur"
      data-dev-auth-view
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full px-3 py-2 text-text-muted hover:text-text-ink"
        title="개발 서버에서만 보이는 보기 전환"
      >
        DEV · {current.label}
      </button>
      {open &&
        OPTIONS.map((option) => {
          const active = option.value === mode
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => choose(option.value)}
              aria-pressed={active}
              title={option.hint}
              className={
                active
                  ? 'rounded-full bg-text-ink px-3 py-2 text-white'
                  : 'rounded-full px-3 py-2 hover:bg-bg-surface'
              }
            >
              {option.label}
            </button>
          )
        })}
    </div>
  )
}
