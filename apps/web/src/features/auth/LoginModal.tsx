'use client'

import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { Modal } from '@/shared/ui/Modal'
import { LOGIN_TITLE, LoginOptions } from './LoginPanel'

/**
 * P3-09 로그인 모달. `useLoginPrompt`의 신호(헤더 "로그인", 인증 가드)를 보고 뜬다.
 * `(public)`·`(app)` 레이아웃에 하나씩 붙인다.
 *
 * 돌아갈 곳을 따로 받지 않았으면(헤더 "로그인") 지금 화면으로 돌아온다.
 */
export function LoginModal() {
  const open = useLoginPrompt((s) => s.open)
  const returnTo = useLoginPrompt((s) => s.returnTo)
  const close = useLoginPrompt((s) => s.close)

  return (
    <Modal open={open} onClose={close} title={LOGIN_TITLE}>
      {open ? <LoginOptions returnTo={returnTo ?? currentPath()} onBrowse={close} /> : null}
    </Modal>
  )
}

function currentPath(): string | null {
  if (typeof window === 'undefined') return null
  return window.location.pathname + window.location.search
}
