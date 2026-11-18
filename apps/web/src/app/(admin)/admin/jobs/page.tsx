import { Suspense } from 'react'
import { JobList } from '@/features/admin/JobList'
import { Loading } from '@/features/admin/parts'

export const metadata = { title: '작업 목록' }

/** 관리자 작업 목록. 거르기를 주소 쿼리로 읽으므로 `<Suspense>` 안에 둔다(apps/web/AGENTS.md) */
export default function AdminJobsPage() {
  return (
    <Suspense fallback={<Loading label="작업 목록을 불러오는 중이에요" />}>
      <JobList />
    </Suspense>
  )
}
