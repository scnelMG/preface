import { Suspense } from 'react'
import { ReconstructionWaiting } from '@/features/reconstruction/waiting/ReconstructionWaiting'

export const metadata = { title: '3D 생성' }

/**
 * SCR-08 3D 생성 대기. 상태 폴링·화면은 `ReconstructionWaiting`이 맡는다.
 *
 * `cacheComponents`가 켜져 있어서 `params`는 `<Suspense>` 안에서만 읽을 수 있다.
 * 바깥은 정적 셸로 먼저 나가고 안쪽이 스트리밍된다(apps/web/AGENTS.md "동적 라우트는 <Suspense>가 필요하다").
 */
export default function ReconstructionPage({ params }: PageProps<'/reconstructions/[jobId]'>) {
  return (
    <Suspense fallback={<p className="sr-only">작업 정보를 불러오는 중</p>}>
      <Waiting params={params} />
    </Suspense>
  )
}

async function Waiting({ params }: { params: PageProps<'/reconstructions/[jobId]'>['params'] }) {
  const { jobId } = await params
  return <ReconstructionWaiting jobId={jobId} />
}
