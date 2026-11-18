import { Suspense } from 'react'
import { LoginScreen } from '@/features/auth/LoginScreen'

export const metadata = { title: '로그인' }

/**
 * 로그인 화면. 로그인 모달(P3-09)과 같은 내용을 화면 하나로 보여 준다.
 * 콜백 실패·동의 취소·가입 거절·가입 시간 만료 때 돌아오는 곳이다.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  )
}
