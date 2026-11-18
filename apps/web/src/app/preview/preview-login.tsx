'use client'

import { Modal } from '@/shared/ui/Modal'
import { LoginOptions } from '@/features/auth/LoginPanel'
import { useLoginPrompt } from '@/shared/state/loginPrompt'

/** 기존 소셜 인증 동작을 그대로 사용하고 프로토타입의 표면·서체만 맞춘다. */
export function PreviewLogin() {
  const open = useLoginPrompt((state) => state.open)
  const close = useLoginPrompt((state) => state.close)
  const returnTo = useLoginPrompt((state) => state.returnTo)
  return (
    <Modal open={open} onClose={close} title="작업을 이어가세요." className="pp-login-dialog">
      {open && (
        <LoginOptions
          returnTo={
            returnTo ??
            (typeof window === 'undefined'
              ? null
              : window.location.pathname + window.location.search)
          }
          onBrowse={close}
          className="pp-login-options"
        />
      )}
    </Modal>
  )
}
