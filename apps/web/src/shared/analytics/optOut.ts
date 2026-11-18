/**
 * 이 브라우저에서 이용 분석을 끄는 표시. 팀원 테스트 기록이 운영 통계에 섞이지 않게 쓴다.
 *
 * - `?analytics=off`로 한 번 들어오면 브라우저 저장소에 남겨, 그 뒤로는 GA4·Clarity를 불러오지 않는다.
 *   `?analytics=on`이면 지운다. 표시는 서버로 보내지 않는다(처리방침 "화면 편의 정보").
 * - 저장소가 막혀 있으면(사생활 보호 모드 등) 주소에 붙은 그 화면에서만 끈다.
 */

/** localStorage 항목 이름 */
export const ANALYTICS_OFF_ITEM = 'preface.analytics.off'

const PARAM = 'analytics'

/** 저장소가 막혀도, 주소에서 지운 뒤 이 탭에서는 계속 끈다. 새로고침하면 사라진다 */
let offInMemory = false

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function paramValue(search: string): string | null {
  return new URLSearchParams(search).get(PARAM)
}

/** 화면을 그리며 읽는다(부수 효과 없음). 주소 값이 저장된 값보다 먼저다 */
export function isAnalyticsOff(search: string): boolean {
  const param = paramValue(search)
  if (param === 'off') return true
  if (param === 'on') return false
  if (offInMemory) return true
  try {
    return storage()?.getItem(ANALYTICS_OFF_ITEM) === '1'
  } catch {
    return false
  }
}

/**
 * 주소의 `?analytics=off|on`을 저장소에 옮기고 주소에서 지운다. 바꿨으면 결과(off·on)를, 주소에 없으면 null을 준다.
 * 다른 쿼리는 그대로 둔다.
 */
export function applyAnalyticsParam(): 'off' | 'on' | null {
  const param = paramValue(window.location.search)
  if (param !== 'off' && param !== 'on') return null
  offInMemory = param === 'off'
  try {
    if (param === 'off') storage()?.setItem(ANALYTICS_OFF_ITEM, '1')
    else storage()?.removeItem(ANALYTICS_OFF_ITEM)
  } catch {
    // 저장이 막혀도 이번 화면에서는 주소 값대로 동작했다
  }
  const url = new URL(window.location.href)
  url.searchParams.delete(PARAM)
  // App Router는 history.replaceState를 라우터 상태와 맞춰 준다
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  return param
}

/** 테스트용 */
export function resetAnalyticsOff(): void {
  offInMemory = false
  try {
    storage()?.removeItem(ANALYTICS_OFF_ITEM)
  } catch {
    // 지우지 못해도 메모리 기록은 지웠다
  }
}
