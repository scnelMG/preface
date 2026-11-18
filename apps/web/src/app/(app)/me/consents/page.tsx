import { ConsentRecordsPage } from '@/features/account/ConsentRecordsPage'

export const metadata = { title: '동의 기록' }

/** SCR-03 동의 내용·기록 보기(읽기 전용, API-AUTH-09·07) */
export default function ConsentsPage() {
  return <ConsentRecordsPage />
}
