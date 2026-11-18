'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FAIL_MESSAGES } from '@/features/reconstruction/failMessages'
import { Segmented, type SegmentedOption } from '@/shared/ui'
import { getReconstructionQueue, getReconstructionSummary } from './api'
import {
  formatDateTime,
  formatDuration,
  formatRate,
  labelOf,
  shortId,
  STATUS_LABELS,
} from './format'
import {
  LoadError,
  Loading,
  Mono,
  PageTitle,
  Section,
  Stat,
  TABLE,
  TableScroll,
  TD,
  TH,
  useAdminResource,
} from './parts'
import { ADMIN_PATHS } from './paths'
import type { QueueEntry, ReconstructionSummary, SummaryPeriod } from './types'

/**
 * 세부 구간 평균은 Grafana `Preface 3D 작업` 대시보드가 맡는다(docs/guides/ec2-server.md "모니터링",
 * infra/ec2/monitoring/grafana/dashboards/preface-reconstruction.json). Grafana는 개발 주소에만 있고 로그인이 필요하다.
 */
export const GRAFANA_RECONSTRUCTION_URL =
  'https://preface.example.com:8080/grafana/d/preface-reconstruction'

const PERIODS: readonly SegmentedOption<SummaryPeriod>[] = [
  { value: 'today', label: '오늘' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
]

/** 한눈에 보기(/admin): 기간별 요약 + 지금 기다리는 작업 */
export function Dashboard() {
  const [period, setPeriod] = useState<SummaryPeriod>('today')
  return (
    <>
      <PageTitle
        aside={
          <Segmented
            label="기간"
            mode="toggle"
            size="sm"
            options={PERIODS}
            value={period}
            onChange={setPeriod}
          />
        }
      >
        한눈에 보기
      </PageTitle>
      <SummaryBlock period={period} />
      <QueueBlock />
    </>
  )
}

function SummaryBlock({ period }: { period: SummaryPeriod }) {
  const { state, reload } = useAdminResource(
    (signal) => getReconstructionSummary(period, signal),
    [period],
  )
  if (state.kind === 'loading') return <Loading label="요약을 불러오는 중이에요" />
  if (state.kind === 'error') return <LoadError message={state.message} onRetry={reload} />
  return <SummaryView summary={state.data} />
}

export function SummaryView({ summary }: { summary: ReconstructionSummary }) {
  const { durationMs } = summary
  const overTarget = (ms: number | null) => ms !== null && ms > durationMs.targetMs
  const target = `목표 ${formatDuration(durationMs.targetMs)}`
  return (
    <>
      <Section
        title="3D 생성"
        aside={
          <p className="type-caption text-muted-soft">
            {formatDateTime(summary.from)} ~ {formatDateTime(summary.to)}
          </p>
        }
      >
        <div className="grid grid-cols-2 gap-(--space-12) md:grid-cols-5">
          <Stat label="전체" value={summary.total} />
          <Stat
            label="실패율"
            value={formatRate(summary.failureRate)}
            hint={summary.failureRate === null ? '끝난 작업이 없어요' : '실패 / 끝난 작업'}
          />
          <Stat
            label="평균 걸린 시간"
            value={formatDuration(durationMs.avg)}
            hint={target}
            tone={overTarget(durationMs.avg) ? 'danger' : undefined}
          />
          <Stat
            label="p95 걸린 시간"
            value={formatDuration(durationMs.p95)}
            hint={target}
            tone={overTarget(durationMs.p95) ? 'danger' : undefined}
          />
          <Stat
            label="멈춘 작업"
            value={summary.stuckCount}
            hint={`${summary.stuckThresholdMinutes}분 넘게 그대로`}
            tone={summary.stuckCount > 0 ? 'danger' : undefined}
          />
        </div>
      </Section>

      <div className="grid gap-x-(--space-24) md:grid-cols-2">
        <Section title="상태별">
          <TableScroll label="상태별 작업 수">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    상태
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    작업 수
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.counts).map(([status, count]) => (
                  <tr key={status}>
                    <td className={TD}>
                      {labelOf(STATUS_LABELS, status)} <Mono className="text-faint">{status}</Mono>
                    </td>
                    <td className={`${TD} pf-mono text-right`}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Section>

        <Section title="많이 난 실패">
          {summary.failCodes.length === 0 ? (
            <p className="type-caption text-muted-soft">이 기간에 실패가 없어요.</p>
          ) : (
            <TableScroll label="실패 코드별 수">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>
                      실패 코드
                    </th>
                    <th scope="col" className={TH}>
                      사용자에게 보인 이유
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      수
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summary.failCodes.map(({ code, count }) => (
                    <tr key={code}>
                      <td className={TD}>
                        <Link
                          href={`${ADMIN_PATHS.jobs}?${new URLSearchParams({ status: 'FAILED', failCode: code })}`}
                          className="pf-mono underline underline-offset-2"
                        >
                          {code}
                        </Link>
                      </td>
                      <td className={TD}>
                        {(FAIL_MESSAGES as Record<string, { reason: string } | undefined>)[code]
                          ?.reason ?? '-'}
                      </td>
                      <td className={`${TD} pf-mono text-right`}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Section>
      </div>

      <p className="type-caption mt-(--space-12) text-muted-soft">
        구간별 평균은{' '}
        <a
          href={GRAFANA_RECONSTRUCTION_URL}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Grafana 3D 작업 대시보드
        </a>
        에서 봐요(개발 주소, 로그인 필요).
      </p>
    </>
  )
}

function QueueBlock() {
  const { state, reload } = useAdminResource((signal) => getReconstructionQueue(signal), [])
  return (
    <Section
      title="지금 기다리는 작업"
      aside={
        <button
          type="button"
          className="type-label text-muted-soft hover:text-ink"
          onClick={reload}
        >
          새로 고침
        </button>
      }
    >
      {state.kind === 'loading' && <Loading label="대기열을 불러오는 중이에요" />}
      {state.kind === 'error' && <LoadError message={state.message} onRetry={reload} />}
      {state.kind === 'ok' && (
        <div className="grid gap-x-(--space-24) gap-y-(--space-16) md:grid-cols-2">
          <QueueTable title="추출 대기" entries={state.data.extract} />
          <QueueTable title="GPU 대기" entries={state.data.gpu} />
        </div>
      )}
    </Section>
  )
}

export function QueueTable({ title, entries }: { title: string; entries: QueueEntry[] }) {
  return (
    <div>
      <h3 className="type-caption text-ink-2">
        {title} <span className="pf-mono text-muted-soft">{entries.length}</span>
      </h3>
      <div className="mt-(--space-8)">
        {entries.length === 0 ? (
          <p className="type-caption text-muted-soft">기다리는 작업이 없어요.</p>
        ) : (
          <TableScroll label={title}>
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={TH}>
                    순번
                  </th>
                  <th scope="col" className={TH}>
                    작업
                  </th>
                  <th scope="col" className={TH}>
                    사용자
                  </th>
                  <th scope="col" className={TH}>
                    들어온 시각
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    기다린 시간
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.jobId}>
                    <td className={`${TD} pf-mono`}>{entry.position ?? '추출 중'}</td>
                    <td className={TD}>
                      <Link
                        href={ADMIN_PATHS.job(entry.jobId)}
                        title={entry.jobId}
                        className="pf-mono underline underline-offset-2"
                      >
                        {shortId(entry.jobId)}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Link
                        href={ADMIN_PATHS.user(entry.userId)}
                        title={entry.userId}
                        className="pf-mono underline underline-offset-2"
                      >
                        {shortId(entry.userId)}
                      </Link>
                    </td>
                    <td className={TD}>{formatDateTime(entry.queuedAt)}</td>
                    <td className={`${TD} pf-mono text-right`}>{formatDuration(entry.waitedMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </div>
    </div>
  )
}
