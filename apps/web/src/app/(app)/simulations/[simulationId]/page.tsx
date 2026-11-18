import { Suspense } from 'react'
import { SimulationLab } from '@/features/edit/lab/SimulationLab'

export const metadata = { title: '내 모델 수정' }

/**
 * 내 모델 수정 · 실험실(유저플로우 07). 회원 전용 — `(app)` 레이아웃의 AuthGate가 지킨다.
 * params는 요청 때만 알 수 있어 <Suspense> 안에서 읽는다(apps/web/AGENTS.md).
 */
export default function SimulationPage({ params }: PageProps<'/simulations/[simulationId]'>) {
  return (
    <Suspense fallback={<div className="h-dvh animate-pulse bg-bg-stone" aria-busy="true" />}>
      <SimulationLabFromParams params={params} />
    </Suspense>
  )
}

async function SimulationLabFromParams({
  params,
}: {
  params: PageProps<'/simulations/[simulationId]'>['params']
}) {
  const { simulationId } = await params
  return <SimulationLab key={simulationId} simulationId={simulationId} />
}
