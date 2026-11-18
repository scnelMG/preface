import { AccountPage } from '@/features/account/AccountPage'

export const metadata = { title: '내 정보' }

/** SCR-12 내 정보·설정 + SCR-14 탈퇴 확인(API-AUTH-04·05·09·11). 동의 개별 철회(SCR-13)는 두지 않는다 */
export default function MePage() {
  return <AccountPage />
}
