'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuthStore } from '@/features/auth/store'
import { ApiError } from '@/shared/api/ApiError'
import { PRIVATE_TEXT } from '@/shared/analytics/privateMedia'
import { ADMIN_FORBIDDEN_CODE, getAdminMe } from './api'
import { AdminHeader } from './AdminHeader'
import type { AdminMe } from './types'

/**
 * 관리자 화면 문지기(S15P31B204-654). `(admin)` 레이아웃이 `AuthGate` 안에 붙인다.
 *
 * - 비로그인: 바깥 `AuthGate`가 회원 화면과 같이 로그인 모달을 띄운다(여기까지 오지 않는다)
 * - 로그인했지만 관리자가 아님(403, `ADM_001`): "관리자만 볼 수 있어요" 화면
 * - 관리자: 머리줄(메뉴·사용자 조회·운영 | 개발 탭)과 내용을 그린다
 *
 * 관리자 정보(`environment` 등)는 `useAdminMe()`로 하위 화면이 읽는다.
 * 화면 전체를 세션 녹화에서 가린다(사용자 ID·작업 기록, REQ-N-24). 분석 자체도 `/admin`에서는 켜지 않는다(shared/analytics/config.ts).
 */
const AdminMeContext = createContext<AdminMe | null>(null)

/** 관리자 화면 안에서만 쓴다. 문지기를 통과한 뒤라 항상 값이 있다 */
export function useAdminMe(): AdminMe {
  const me = useContext(AdminMeContext)
  if (!me) throw new Error('useAdminMe는 AdminGate 안에서만 쓸 수 있어요')
  return me
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; me: AdminMe }

export function AdminGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    getAdminMe(controller.signal)
      .then((me) => setState({ kind: 'ok', me }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) {
          // 세션이 끝났다. 회원 화면과 같이 로그인 모달로 돌린다(AuthGate)
          useAuthStore.getState().signOut()
          return
        }
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.code === ADMIN_FORBIDDEN_CODE)
        ) {
          setState({ kind: 'forbidden' })
          return
        }
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : '관리자 정보를 불러오지 못했어요.',
        })
      })
    return () => controller.abort()
  }, [attempt])

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center py-(--space-40)" role="status">
        <span className="pf-loader" aria-hidden="true" />
        <span className="sr-only">관리자 권한을 확인하는 중이에요</span>
      </div>
    )
  }

  if (state.kind === 'forbidden') {
    return (
      <Blocked title="관리자만 볼 수 있어요">
        이 화면은 관리자 계정으로만 열려요. 다른 계정으로 로그인했다면 로그아웃한 뒤 다시 들어와
        주세요.
      </Blocked>
    )
  }

  if (state.kind === 'error') {
    return (
      <Blocked title="관리자 정보를 불러오지 못했어요">
        <span className="block">{state.message}</span>
        <button
          type="button"
          className="btn-ghost mt-(--space-16)"
          onClick={() => {
            setState({ kind: 'loading' })
            setAttempt((n) => n + 1)
          }}
        >
          다시 시도
        </button>
      </Blocked>
    )
  }

  return (
    <AdminMeContext.Provider value={state.me}>
      <div className="flex flex-1 flex-col" {...PRIVATE_TEXT}>
        <AdminHeader me={state.me} />
        <main className="mx-auto flex w-full max-w-page flex-1 flex-col px-(--space-16) pt-(--space-24) pb-(--space-40) md:px-(--space-32)">
          {children}
        </main>
      </div>
    </AdminMeContext.Provider>
  )
}

function Blocked({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col items-center justify-center px-(--space-16) py-(--space-40) text-center">
      <h1 className="type-headline text-ink">{title}</h1>
      <p className="type-lead mt-(--space-12) text-ink-2">{children}</p>
      <Link href="/" className="type-label mt-(--space-24) text-muted-soft underline">
        메인으로 가기
      </Link>
    </main>
  )
}
