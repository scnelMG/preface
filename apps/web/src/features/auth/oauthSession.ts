import type { ProviderPath } from './types'

/**
 * 소셜 로그인 왕복(우리 화면 → 제공자 → 콜백) 동안 남겨 둘 값.
 *
 * 페이지를 떠났다 돌아오므로 메모리가 아니라 sessionStorage에 둔다(탭 하나 범위, 탭을 닫으면 사라진다).
 * 토큰은 여기 두지 않는다. state와 돌아갈 경로만 둔다.
 */

const STATE_KEY = 'preface.oauth.state'
const RETURN_TO_KEY = 'preface.oauth.returnTo'

/** FE 콜백 주소. BE 허용 목록이 `{origin}/oauth/{kakao,google}`이다(application-local.yml, docs/guides/ec2-server.md) */
export function callbackUri(provider: ProviderPath, origin = window.location.origin): string {
  return `${origin}/oauth/${provider}`
}

const URL_BASE = 'https://placeholder.invalid'

/**
 * 같은 사이트 안의 경로만 돌아갈 곳으로 받는다. `//evil.com`, `https://…` 같은 외부 주소는 버린다(open redirect 방지).
 * 콜백·가입 화면으로 돌아가면 다시 흐름이 꼬이므로 그 경로도 버린다.
 *
 * 브라우저 URL 해석은 탭·줄바꿈을 지우고 `\`를 `/`로 읽는다. 그래서 `"/\t/evil.com"`도 `//evil.com`이 되어 밖으로 나간다.
 * 제어 문자·공백·역슬래시는 어디에 있든 버리고, 마지막으로 실제로 해석해 출처가 그대로인지 한 번 더 본다.
 * `?returnTo=` 값은 URLSearchParams가 먼저 풀어 주므로(`%09` → 탭) 여기에는 풀린 값이 들어온다.
 * 풀리지 않은 `/%09/evil.com` 같은 문자열은 경로 글자 그대로 남아 같은 사이트 안이므로 받는다.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  // 제어 문자(0x00–0x1F, 0x7F)·공백·역슬래시
  if (/[\x00-\x20\x7f\\]/.test(value)) return null
  try {
    if (new URL(value, URL_BASE).origin !== URL_BASE) return null
  } catch {
    return null
  }
  const path = value.split(/[?#]/)[0]
  if (path.startsWith('/oauth/') || path === '/signup' || path === '/login') return null
  return value
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function saveOAuthStart(state: string, returnTo: string | null): void {
  const s = storage()
  if (!s) return
  s.setItem(STATE_KEY, state)
  const safe = safeReturnTo(returnTo)
  if (safe) s.setItem(RETURN_TO_KEY, safe)
  else s.removeItem(RETURN_TO_KEY)
}

/** 콜백에서 한 번 꺼내고 지운다(state는 1회용) */
export function takeOAuthState(): string | null {
  const s = storage()
  if (!s) return null
  const value = s.getItem(STATE_KEY)
  s.removeItem(STATE_KEY)
  return value
}

/** 로그인·가입을 마친 뒤 돌아갈 경로. 가입 동의 화면을 거치므로 가입이 끝날 때까지 남겨 둔다 */
export function peekReturnTo(): string | null {
  return safeReturnTo(storage()?.getItem(RETURN_TO_KEY))
}

export function clearReturnTo(): void {
  storage()?.removeItem(RETURN_TO_KEY)
}
