import { SignupConsent } from '@/features/auth/SignupConsent'

export const metadata = { title: '가입 동의' }

/** SCR-02 가입 동의. 가입 토큰(scope=signup)으로만 들어온다(API-AUTH-07·08) */
export default function SignupPage() {
  return <SignupConsent />
}
