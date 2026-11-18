import { Suspense } from 'react'
import { CallbackStatus, OAuthCallback } from '@/features/auth/OAuthCallback'

export const metadata = { title: '카카오 로그인' }

/** 카카오 OAuth 콜백. BE 허용 목록(`preface.auth.allowed-redirect-uris`)의 `{origin}/oauth/kakao`와 같아야 한다 */
export default function KakaoCallbackPage() {
  return (
    <Suspense fallback={<CallbackStatus />}>
      <OAuthCallback provider="kakao" />
    </Suspense>
  )
}
