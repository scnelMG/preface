'use client'

import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { useAuthStore } from '@/features/auth/store'
import { Button, Modal } from '@/shared/ui'
import { MattermostNotify } from './MattermostNotify'
import { useMattermostNotifyAvailable } from './mattermostAvailability'

/**
 * Mattermost 알림 신청 안내(S15P31B204-544). Mattermost를 아직 연결하지 않은 회원에게 계정마다 한 번 띄운다.
 * 새 회원은 가입을 마치고 처음 보는 화면에서, 이미 가입한 회원은 배포 뒤 처음 들어온 화면에서 보게 된다 — 한 컴포넌트로 둘 다 잡는다.
 *
 * - 3D 생성이 몇 분 걸려, 화면을 떠나 있어도 완성을 알 수 있는 방법을 처음에 알린다. 3D 대기 화면의 입력칸(-524)과 같은 칸을 쓴다.
 * - 서버가 `mattermostUsername`을 내려주지 않으면(옛 서버, `undefined`) 띄우지 않는다. 등록 전이면 `null`이다.
 * - 촬영 화면(`/m/`)·로그인·가입·법적 문서에서는 띄우지 않는다. 그 화면의 할 일을 막지 않게.
 * - [나중에 할게요]를 누르거나 연결하면 이 기기에서 다시 띄우지 않는다(계정별 localStorage). 저장이 막혀도 이 탭에서는 다시 띄우지 않는다.
 */
export const MM_ONBOARDING_KEY_PREFIX = 'preface.mm-onboarding.v1:'

export const MM_ONBOARDING = {
  title: '3D가 완성되면 Mattermost로 알려 드릴까요?',
  body: '3D를 만드는 데 몇 분 걸려요. 화면을 떠나 있어도 완성되면 SSAFY Mattermost DM으로 알려 드려요.',
  later: '나중에 할게요',
  laterHint: '내 정보 → 알림에서 언제든 켤 수 있어요.',
} as const

const HIDDEN_PREFIXES = ['/m/', '/login', '/signup', '/oauth', '/legal', '/s/']

const memory = new Set<string>()
const listeners = new Set<() => void>()

function seen(userId: string): boolean {
  if (memory.has(userId)) return true
  try {
    return window.localStorage.getItem(MM_ONBOARDING_KEY_PREFIX + userId) !== null
  } catch {
    return false
  }
}

function markSeen(userId: string, how: 'later' | 'linked') {
  memory.add(userId)
  try {
    window.localStorage.setItem(MM_ONBOARDING_KEY_PREFIX + userId, how)
  } catch {
    // 저장이 막혀도 이 탭에서는 다시 띄우지 않는다(메모리 기록)
  }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function MattermostOnboarding() {
  const pathname = usePathname() ?? ''
  const status = useAuthStore((s) => s.status)
  const me = useAuthStore((s) => s.me)
  const available = useMattermostNotifyAvailable()
  const userId = me?.id ?? null
  const alreadySeen = useSyncExternalStore(
    subscribe,
    () => (userId ? seen(userId) : true),
    () => true,
  )
  const [closed, setClosed] = useState(false)

  if (
    closed ||
    alreadySeen ||
    !available ||
    status !== 'member' ||
    !me ||
    me.mattermostUsername !== null ||
    HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return null
  }

  function later() {
    if (me) markSeen(me.id, 'later')
    setClosed(true)
  }

  return (
    // 닫기(X)·ESC·바깥 누르기도 [나중에 할게요]와 같이 다시 띄우지 않는다
    <Modal open onClose={later} title={MM_ONBOARDING.title}>
      <p className="type-kr-body-13-regular-lh16p9 break-keep text-text-paragraph">
        {MM_ONBOARDING.body}
      </p>
      <div className="mt-(--space-16)">
        <MattermostNotify
          heading={false}
          username={null}
          onChange={(mattermostUsername) => {
            useAuthStore.getState().setMe({ ...me, mattermostUsername })
            if (mattermostUsername) {
              markSeen(me.id, 'linked')
              setClosed(true)
            }
          }}
        />
      </div>
      <div className="mt-(--space-20) flex flex-col gap-(--space-6)">
        <Button variant="secondary" trailingIcon={null} className="w-full" onClick={later}>
          {MM_ONBOARDING.later}
        </Button>
        <p className="text-center text-[12.5px] break-keep text-text-muted">
          {MM_ONBOARDING.laterHint}
        </p>
      </div>
    </Modal>
  )
}
