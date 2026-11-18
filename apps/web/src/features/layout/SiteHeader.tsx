'use client'

import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { useAuthStore } from '@/features/auth/store'
import { useLogout } from '@/features/auth/useLogout'
import { NotificationPopover } from '@/features/notifications/NotificationPopover'
import { useUnreadNotifications } from '@/features/notifications/unread'
import { PreviewNav } from '@/app/preview/preview-nav'
import type { NavKey } from '@/shared/ui/Header'

/**
 * 레이아웃에 붙이는 헤더. 로그인 상태(auth 스토어)와 현재 경로를 읽어 PreviewNav에 넘긴다.
 * "로그인" 버튼은 PreviewNav가 직접 로그인 모달 신호(useLoginPrompt)를 보낸다.
 * 회원 프로필 메뉴의 "로그아웃"은 내 정보 화면과 같은 useLogout을 쓴다.
 * 안 읽은 알림 점은 회원일 때만 묻는다(API-NOTI-01 unreadCount, 주기는 features/notifications/unread.ts).
 * 종 아이콘은 알림 팝업(NotificationPopover: 최근 몇 개 + 전체 보기 /notifications)을 연다.
 *
 * usePathname()은 동적 라우트에서 요청 때만 알 수 있다. cacheComponents가 켜져 있어 <Suspense> 밖에서
 * 쓰면 빌드가 막힌다(apps/web/AGENTS.md "동적 라우트는 <Suspense>가 필요하다"). 그래서 감싸 두고,
 * 기다리는 동안에는 현재 메뉴 표시 없는 같은 모양의 헤더를 보여 준다.
 */
function activeOf(pathname: string): NavKey | null {
  if (pathname === '/') return 'main'
  if (pathname.startsWith('/services')) return 'services'
  if (pathname.startsWith('/studio')) return 'studio'
  return null
}

/**
 * 휴대폰(md 미만)에서 헤더를 숨기는 편집 화면: 실험실(`/simulations/…`)과 체험 실험실(`/lab`)(S15P31B204-573).
 * 메인의 `체험하기`처럼 화면 전체를 3D와 조절 시트에 쓴다. 뒤로 가기·저장은 실험실 툴바가 맡는다. PC는 그대로 둔다.
 */
export function hidesHeaderOnPhone(pathname: string): boolean {
  return pathname === '/lab' || pathname.startsWith('/lab/') || pathname.startsWith('/simulations/')
}

function useHeaderState() {
  const status = useAuthStore((s) => s.status)
  const me = useAuthStore((s) => s.me)
  const member = status === 'member' ? { nickname: me?.nickname ?? '회원' } : null
  const unread = useUnreadNotifications(member !== null)
  const { logout, pending } = useLogout()
  return {
    member,
    unread,
    onLogout: () => void logout(),
    loggingOut: pending,
  }
}

function ConnectedHeader() {
  const pathname = usePathname()
  const state = useHeaderState()
  return (
    <div
      className={hidesHeaderOnPhone(pathname) ? 'preface-preview max-md:hidden' : 'preface-preview'}
    >
      <PreviewNav
        connected
        workspace={activeOf(pathname) === 'studio'}
        member={!!state.member}
        nickname={state.member?.nickname}
        unread={state.unread}
        onLogout={state.onLogout}
        loggingOut={state.loggingOut}
        notificationsActive={pathname.startsWith('/notifications')}
        notificationPanel={NotificationPopover}
      />
    </div>
  )
}

function FallbackHeader() {
  const state = useHeaderState()
  return (
    <div className="preface-preview">
      <PreviewNav
        connected
        member={!!state.member}
        nickname={state.member?.nickname}
        unread={state.unread}
        onLogout={state.onLogout}
        loggingOut={state.loggingOut}
        notificationPanel={NotificationPopover}
      />
    </div>
  )
}

export function SiteHeader() {
  return (
    <Suspense fallback={<FallbackHeader />}>
      <ConnectedHeader />
    </Suspense>
  )
}
