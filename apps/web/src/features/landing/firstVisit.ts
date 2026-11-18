'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthStatus } from '@/features/auth/store'

/**
 * 처음 온 비로그인 사용자를 메인(`/`)에서 랜딩(`/about`)으로 한 번 보낸다(S15P31B204-277 후속, 2026-10-26 결정).
 * 헤더에 "소개" 메뉴를 두지 않는 대신 첫 방문에 랜딩을 보여 준다.
 *
 * - 기기별 localStorage에 방문 기록을 남긴다. 서버에 보내지 않고, `/`의 서버 응답도 바꾸지 않는다(검색 엔진·공유 링크).
 * - 저장소가 막혀 있어도(사생활 보호 모드 등) 화면은 동작한다. 쓰기에 실패하면 이 탭의 메모리에만 기억한다.
 * - 키 이름에 버전을 넣는다. 랜딩을 크게 바꿔 다시 보여 주려면 `v2`로 올린다.
 */
export const FIRST_VISIT_STORAGE_KEY = 'preface.visited.v1'

/** localStorage에 못 쓴 기록. 새로고침하면 사라진다 */
let visitedInMemory = false

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // 일부 브라우저는 저장소를 막으면 접근만 해도 SecurityError를 던진다
    return null
  }
}

export function hasVisited(): boolean {
  if (visitedInMemory) return true
  try {
    return storage()?.getItem(FIRST_VISIT_STORAGE_KEY) != null
  } catch {
    // 읽지 못하면 처음 방문으로 본다. 보낸 뒤에는 메모리 기록으로 다시 보내지 않는다
    return false
  }
}

export function markVisited(): void {
  visitedInMemory = true
  try {
    storage()?.setItem(FIRST_VISIT_STORAGE_KEY, '1')
  } catch {
    // 저장이 막혀도 이번 탭에서는 다시 보내지 않는다(메모리 기록)
  }
}

/** 테스트용 */
export function clearVisited(): void {
  visitedInMemory = false
  try {
    storage()?.removeItem(FIRST_VISIT_STORAGE_KEY)
  } catch {
    // 지우지 못해도 메모리 기록은 지웠다
  }
}

/** 랜딩에 도착하면 방문으로 기록한다. `/about`을 직접 연 사람도 이후 메인에서 다시 보내지 않는다 */
export function useMarkVisited() {
  useEffect(() => {
    markVisited()
  }, [])
}

/**
 * 메인에서 쓴다. 세션 복구 중(loading)에는 판단을 미룬다(회원이 랜딩으로 튀지 않게).
 * 상태가 정해지면 방문으로 기록하고, 처음 온 비로그인(anonymous)만 `/about`으로 바꿔 보낸다.
 * 회원·가입 동의 중(signup)도 기록해, 나중에 로그아웃해 메인에 와도 랜딩으로 보내지 않는다.
 */
export function useFirstVisitRedirect(status: AuthStatus) {
  const router = useRouter()

  useEffect(() => {
    if (status === 'loading') return
    const firstVisit = !hasVisited()
    markVisited()
    if (firstVisit && status === 'anonymous') router.replace('/about')
  }, [status, router])
}
