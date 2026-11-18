import { Suspense } from 'react'
import { Loading } from '@/features/admin/parts'
import { UserList } from '@/features/admin/users/UserList'

export const metadata = { title: '회원' }

/**
 * 관리자 회원 목록·검색(S15P31B204-708). 검색 색인 차단·분석 끄기는 `(admin)` 레이아웃과 분석 설정(`/admin` 제외)이 맡는다.
 * 검색어를 주소 쿼리로 읽으므로 `<Suspense>` 안에 둔다(apps/web/AGENTS.md).
 */
export default function AdminUsersPage() {
  return (
    <Suspense fallback={<Loading label="회원 목록을 불러오는 중이에요" />}>
      <UserList />
    </Suspense>
  )
}
