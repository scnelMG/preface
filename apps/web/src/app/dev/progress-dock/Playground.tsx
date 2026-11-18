'use client'

import { useState } from 'react'
import { announceFinished } from '@/features/reconstruction/ProgressDock'
import {
  DOCK_POSITION_CLASS,
  FailedDockCard,
  ProgressDockCard,
  SucceededDockCard,
} from '@/features/reconstruction/ProgressDockCard'
import { useReconstructionStore } from '@/features/reconstruction/store'
import { fakeJob } from '@/features/reconstruction/testing'
import { STAGE_ORDER, type ReconstructionJob } from '@/features/reconstruction/types'
import { Button } from '@/shared/ui'

/** 가짜 작업. createdAt은 화면을 연 시각 기준 2분 10초 전으로 둔다 */
function sample(overrides: Partial<ReconstructionJob>, createdAt: string): ReconstructionJob {
  return fakeJob({ createdAt, ...overrides })
}

const STATES: { label: string; job: Partial<ReconstructionJob> }[] = [
  {
    label: '추출 대기(waiting, stage null, 순번 3)',
    job: {
      status: 'QUEUED',
      stage: null,
      stageIndex: null,
      queuePosition: 3,
      waiting: true,
      startedAt: null,
    },
  },
  {
    label: '프레임 추출 중(QUEUED, 1단계, waiting false)',
    job: {
      status: 'QUEUED',
      stage: 'FRAME_SELECT',
      stageIndex: 1,
      waiting: false,
      startedAt: null,
    },
  },
  {
    label: 'GPU 대기(waiting, 2단계, 순번 1)',
    job: {
      status: 'QUEUED',
      stage: 'QUALITY_CHECK',
      stageIndex: 2,
      queuePosition: 1,
      waiting: true,
      startedAt: null,
    },
  },
  {
    label: '첫 단계 보고 전(RUNNING, stage null)',
    job: { status: 'RUNNING', stage: null, stageIndex: null },
  },
  ...STAGE_ORDER.map((stage, i) => ({
    label: `${i + 1}/4 단계`,
    job: { status: 'RUNNING' as const, stage, stageIndex: i + 1 },
  })),
]

export function Playground() {
  const [createdAt] = useState(() => new Date(Date.now() - 130_000).toISOString())
  const [live, setLive] = useState<number | null>(3)
  // 완성·실패는 announceFinished가 스토어에 남긴다. 이 화면에는 ProgressDock이 없어 직접 그린다
  const failed = useReconstructionStore((s) => s.failed)
  const succeeded = useReconstructionStore((s) => s.succeeded)
  const dismissSuccess = useReconstructionStore((s) => s.dismissSuccess)

  const finish = (status: 'SUCCEEDED' | 'FAILED') => {
    setLive(null)
    useReconstructionStore.setState({ failed: null, succeeded: null })
    const job = sample(
      {
        status,
        failCodes: status === 'FAILED' ? ['QUALITY_ANGLE'] : [],
        faceModelId: status === 'SUCCEEDED' ? 'fm-sample' : null,
      },
      createdAt,
    )
    // 놀이터에서는 몇 번이고 다시 볼 수 있게, 확인 기록과 상관없이 띄운다
    if (status === 'FAILED') useReconstructionStore.setState({ failed: job })
    announceFinished(job, {
      isOnResultPage: false,
      open: () => undefined,
    })
  }

  const liveState = live === null ? null : STATES[live]

  return (
    <main className="mx-auto max-w-page px-(--space-16) py-(--space-40) md:px-(--space-40)">
      <h1 className="type-kr-heading-15-medium-ls-0p5-lh19p5">v3/ProgressDock (개발용)</h1>
      <p className="type-kr-caption-11-regular-lh14p3 mt-(--space-4) text-text-muted">
        Figma 315:2736 · Desktop 340px · Mobile 화면 폭 - 32px(경과 시간 줄 없음) · 가짜 데이터
      </p>

      <section className="mt-(--space-32) border-t border-line-default pt-(--space-24)">
        <h2 className="type-kr-body-13-medium-lh16p9">상태별 카드</h2>
        <div className="mt-(--space-16) grid gap-(--space-24) md:grid-cols-2">
          {STATES.map(({ label, job }) => (
            <div key={label} className="flex flex-col gap-(--space-8)">
              <p className="type-kr-caption-11-regular-lh14p3 text-text-body">{label}</p>
              <ProgressDockCard job={sample(job, createdAt)} className="md:w-85" />
            </div>
          ))}
          <div className="flex flex-col gap-(--space-8)">
            <p className="type-kr-caption-11-regular-lh14p3 text-text-body">
              실패(같은 자리, 빨간 링)
            </p>
            <FailedDockCard
              job={sample({ status: 'FAILED', failCodes: ['QUALITY_ANGLE'] }, createdAt)}
              className="md:w-85"
            />
          </div>
          <div className="flex flex-col gap-(--space-8)">
            <p className="type-kr-caption-11-regular-lh14p3 text-text-body">
              완성(같은 자리, ✕로 닫기)
            </p>
            <SucceededDockCard
              job={sample({ status: 'SUCCEEDED', faceModelId: 'fm-sample' }, createdAt)}
              onDismiss={() => undefined}
              className="md:w-85"
            />
          </div>
        </div>
      </section>

      <section className="mt-(--space-32) border-t border-line-default pt-(--space-24)">
        <h2 className="type-kr-body-13-medium-lh16p9">화면 하단 고정 · 완료 알림</h2>
        <p className="type-kr-caption-11-regular-lh14p3 mt-(--space-4) text-text-muted">
          단계를 바꾸면 오른쪽 아래(모바일은 아래) 팝업이 바뀐다. 완료를 누르면 같은 자리에 완성
          카드가, 실패를 누르면 실패 카드가 남는다.
        </p>
        <div className="mt-(--space-16) flex flex-wrap gap-(--space-8)">
          {STATES.map(({ label }, i) => (
            <Button key={label} variant="secondary" layout="inline" onClick={() => setLive(i)}>
              {label}
            </Button>
          ))}
          <Button variant="primary" layout="inline" onClick={() => finish('SUCCEEDED')}>
            완료
          </Button>
          <Button variant="danger" onClick={() => finish('FAILED')}>
            실패
          </Button>
        </div>
      </section>

      {liveState ? (
        <div className={DOCK_POSITION_CLASS}>
          <ProgressDockCard job={sample(liveState.job, createdAt)} />
        </div>
      ) : succeeded ? (
        <div className={DOCK_POSITION_CLASS}>
          <SucceededDockCard job={succeeded} onDismiss={dismissSuccess} />
        </div>
      ) : failed ? (
        <div className={DOCK_POSITION_CLASS}>
          <FailedDockCard job={failed} />
        </div>
      ) : null}
    </main>
  )
}
