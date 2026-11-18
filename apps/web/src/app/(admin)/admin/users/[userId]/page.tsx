import type { Metadata } from 'next'
import { Suspense } from 'react'
import { UserModelsPage } from '@/features/admin/models/UserModelsPage'

/**
 * 관리자 사용자별 생성 모델·S3 조회(S15P31B204-655). ADMIN 확인은 `(admin)` 레이아웃(-654)이 맡는다.
 *
 * 얼굴 데이터라 검색 색인을 막고, 서명 URL 요청(S3)에 이 주소가 Referer로 새지 않게 한다.
 * `params`는 `<Suspense>` 안에서만 읽는다(apps/web/AGENTS.md "동적 라우트는 <Suspense>가 필요하다").
 */
export const metadata: Metadata = {
  title: '관리자 · 사용자 모델',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function AdminUserModelsPage({ params }: PageProps<'/admin/users/[userId]'>) {
  return (
    <Suspense fallback={<p className="sr-only">사용자 정보를 불러오는 중</p>}>
      <UserModelsFromParams params={params} />
    </Suspense>
  )
}

async function UserModelsFromParams({
  params,
}: {
  params: PageProps<'/admin/users/[userId]'>['params']
}) {
  const { userId } = await params
  return <UserModelsPage key={userId} userId={userId} />
}
