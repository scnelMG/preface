import { Suspense } from 'react'
import { JobDetail } from '@/features/admin/JobDetail'
import { Loading } from '@/features/admin/parts'

export const metadata = { title: '작업 상세' }

/** 관리자 작업 상세. `params`는 `<Suspense>` 안에서만 읽는다(apps/web/AGENTS.md "동적 라우트") */
export default function AdminJobPage({ params }: PageProps<'/admin/jobs/[jobId]'>) {
  return (
    <Suspense fallback={<Loading label="작업을 불러오는 중이에요" />}>
      <Detail params={params} />
    </Suspense>
  )
}

async function Detail({ params }: { params: PageProps<'/admin/jobs/[jobId]'>['params'] }) {
  const { jobId } = await params
  return <JobDetail jobId={jobId} />
}
