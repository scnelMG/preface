import { Suspense } from 'react'
import { CallbackStatus, OAuthCallback } from '@/features/auth/OAuthCallback'

export const metadata = { title: 'Google 로그인' }

/** Google OAuth 콜백. BE 허용 목록(`preface.auth.allowed-redirect-uris`)의 `{origin}/oauth/google`과 같아야 한다 */
export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<CallbackStatus />}>
      <OAuthCallback provider="google" />
    </Suspense>
  )
}
