'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { failMessagesOf } from '@/features/reconstruction/failMessages'
import { cx } from '@/shared/ui'
import { getReconstructionDetail } from './api'
import {
  formatDateTime,
  formatDuration,
  labelOf,
  NO_RECORD,
  segmentRows,
  STAGE_LABELS,
  STATUS_LABELS,
} from './format'
import {
  LoadError,
  Loading,
  Mono,
  PageTitle,
  Section,
  TABLE,
  TableScroll,
  TD,
  TH,
  useAdminResource,
} from './parts'
import { ADMIN_PATHS } from './paths'
import { StageSection } from './StagePanels'
import type { AdminJobDetail, JobFailure } from './types'

/** 작업 상세(/admin/jobs/{jobId}): 6단계 진행 바·단계 패널, 실패, 구간별 시간, 이전 실패, 입력 정보 */
export function JobDetail({ jobId }: { jobId: string }) {
  const { state, reload } = useAdminResource(
    (signal) => getReconstructionDetail(jobId, signal),
    [jobId],
  )
  if (state.kind === 'loading') return <Loading label="작업을 불러오는 중이에요" />
  if (state.kind === 'error') {
    return (
      <>
        <PageTitle>작업 상세</PageTitle>
        <div className="mt-(--space-16)">
          {state.notFound ? (
            <LoadError message="작업을 찾지 못했어요. 다른 환경(운영·개발)의 작업인지 확인해 주세요." />
          ) : (
            <LoadError message={state.message} onRetry={reload} />
          )}
        </div>
      </>
    )
  }
  return <JobDetailView detail={state.data} />
}

export function JobDetailView({ detail }: { detail: AdminJobDetail }) {
  return (
    <>
      <PageTitle
        aside={
          <Link href={ADMIN_PATHS.jobs} className="type-label text-muted-soft hover:text-ink">
            작업 목록으로
          </Link>
        }
      >
        작업 상세
      </PageTitle>
      <p className="type-caption mt-(--space-4) break-all text-muted-soft">
        <Mono>{detail.jobId}</Mono>
      </p>

      <Section title="요약">
        <dl className="grid grid-cols-1 gap-x-(--space-24) gap-y-(--space-8) sm:grid-cols-2 lg:grid-cols-3">
          <Item label="사용자">
            <Mono className="break-all">{detail.userId}</Mono>{' '}
            <Link
              href={ADMIN_PATHS.user(detail.userId)}
              className="type-label whitespace-nowrap text-accent underline underline-offset-2"
            >
              이 사용자의 모델 보기
            </Link>
          </Item>
          <Item label="상태">
            <span className={detail.status === 'FAILED' ? 'text-status-danger' : undefined}>
              {labelOf(STATUS_LABELS, detail.status)}
            </span>
          </Item>
          <Item label="단계">{labelOf(STAGE_LABELS, detail.stage)}</Item>
          <Item label="만든 시각">{formatDateTime(detail.createdAt)}</Item>
          <Item label="끝난 시각">{formatDateTime(detail.finishedAt)}</Item>
          <Item label="전체 걸린 시간">{formatDuration(detail.durationMs)}</Item>
          <Item label="추출 시도">{detail.extractAttempts ?? NO_RECORD}</Item>
          <Item label="3D 모델">
            {detail.faceModelId ? <Mono className="break-all">{detail.faceModelId}</Mono> : '-'}
          </Item>
        </dl>
      </Section>

      <Section title="생성 단계">
        <StageSection key={detail.jobId} detail={detail} />
      </Section>

      {detail.failure && (
        <Section title="실패">
          <FailureBlock failure={detail.failure} />
        </Section>
      )}

      <Section title="구간별 시간">
        <SegmentTable detail={detail} />
      </Section>

      <Section title="이 사용자의 이전 실패">
        {detail.previousFailures.length === 0 ? (
          <p className="type-caption text-muted-soft">이전 실패가 없어요.</p>
        ) : (
          <ul className="flex flex-col gap-(--space-6)">
            {detail.previousFailures.map((previous) => (
              <li
                key={previous.jobId}
                className="type-caption flex flex-wrap gap-x-(--space-12) text-ink-2"
              >
                <span>{formatDateTime(previous.createdAt)}</span>
                <Link
                  href={ADMIN_PATHS.job(previous.jobId)}
                  className="pf-mono underline underline-offset-2"
                >
                  {previous.jobId}
                </Link>
                <Mono className="text-status-danger">{previous.codes.join(', ') || '-'}</Mono>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="입력 정보">
        <InputBlock input={detail.input} />
      </Section>
    </>
  )
}

/** 구간 표. 가장 오래 걸린 구간을 강조하고, 기록이 없는 구간은 "기록 없음"으로 보인다 */
export function SegmentTable({
  detail,
}: {
  detail: Pick<AdminJobDetail, 'segments' | 'slowestSegment'>
}) {
  const rows = segmentRows(detail)
  return (
    <TableScroll label="구간별 시간">
      <table className={TABLE}>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              구간
            </th>
            <th scope="col" className={TH}>
              시작
            </th>
            <th scope="col" className={TH}>
              끝
            </th>
            <th scope="col" className={`${TH} text-right`}>
              걸린 시간
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-slowest={row.slowest || undefined}
              data-missing={row.missing || undefined}
              className={cx(row.slowest && 'bg-accent-soft', row.missing && 'text-faint')}
            >
              <th
                scope="row"
                className={cx(TD, 'font-normal', row.slowest && 'font-semibold text-ink')}
              >
                {row.label}
                {row.attempt !== null && row.attempt > 1 && (
                  <span className="ml-(--space-4) text-muted-soft">({row.attempt}번째 시도)</span>
                )}
                {row.status && row.status !== 'SUCCEEDED' && (
                  <span className="ml-(--space-4) text-status-danger">{row.status}</span>
                )}
                {row.slowest && <span className="ml-(--space-6) text-accent">가장 오래 걸림</span>}
              </th>
              {row.missing ? (
                <td className={cx(TD, 'text-faint')} colSpan={3}>
                  {NO_RECORD}
                </td>
              ) : (
                <>
                  <td className={TD}>{row.startedAt}</td>
                  <td className={TD}>{row.finishedAt}</td>
                  <td
                    className={cx(
                      TD,
                      'pf-mono text-right',
                      row.slowest && 'font-semibold text-ink',
                    )}
                  >
                    {row.duration}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}

/**
 * 실패 정보. 사용자 문구는 BE가 준 `userMessage`를 쓰고, 없으면 사용자 화면과 같은 FE 문구 사전으로 만든다.
 * 내부 상세는 관리자에게만 보인다.
 */
export function FailureBlock({ failure }: { failure: JobFailure }) {
  const userMessages = failure.userMessage
    ? [failure.userMessage]
    : failMessagesOf(failure.codes).map((m) => `${m.reason}. ${m.fix}`)
  return (
    <div className="rounded-12 border border-hairline bg-surface p-(--space-16)">
      <dl className="grid grid-cols-1 gap-x-(--space-24) gap-y-(--space-12) md:grid-cols-2">
        <Item label="실패 단계">{labelOf(STAGE_LABELS, failure.stage)}</Item>
        <Item label="실패 코드">
          <Mono className="text-status-danger">
            {failure.codes.length ? failure.codes.join(', ') : '-'}
          </Mono>
        </Item>
        <Item label="사용자에게 보인 문구">
          {userMessages.map((message) => (
            <span key={message} className="block">
              {message}
            </span>
          ))}
        </Item>
        <Item label="내부 상세">
          {failure.detail ? (
            <pre className="pf-mono overflow-x-auto break-all whitespace-pre-wrap text-ink-2">
              {failure.detail}
            </pre>
          ) : (
            NO_RECORD
          )}
        </Item>
      </dl>
    </div>
  )
}

function InputBlock({ input }: { input: AdminJobDetail['input'] }) {
  if (!input) return <p className="type-caption text-muted-soft">{NO_RECORD}</p>
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-(--space-24) gap-y-(--space-8) md:grid-cols-4">
        <Item label="영상 길이">{formatDuration(input.videoDurationMs)}</Item>
        <Item label="촬영 방법">{input.captureMethod ?? NO_RECORD}</Item>
        <Item label="기기">{input.deviceModel ?? NO_RECORD}</Item>
        <Item label="프레임 수">{input.frameCount ?? NO_RECORD}</Item>
      </dl>
      {input.quality != null && (
        <details className="mt-(--space-12)">
          <summary className="type-label cursor-pointer text-ink-2">품질 확인 결과(원본)</summary>
          <pre className="type-caption pf-mono mt-(--space-8) max-h-96 overflow-auto rounded-12 border border-hairline bg-surface p-(--space-12) text-ink-2">
            {JSON.stringify(input.quality, null, 2)}
          </pre>
        </details>
      )}
    </>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-(--space-2)">
      <dt className="type-caption text-muted-soft">{label}</dt>
      <dd className="type-caption text-ink">{children}</dd>
    </div>
  )
}
