'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { FAIL_MESSAGES } from '@/features/reconstruction/failMessages'
import { listReconstructions } from './api'
import {
  formatDateTime,
  formatDuration,
  labelOf,
  shortId,
  STAGE_LABELS,
  STAGE_OPTIONS,
  STATUS_LABELS,
  STATUS_OPTIONS,
} from './format'
import { filtersFromSearch, searchFromFilters } from './jobFilters'
import {
  LoadError,
  Loading,
  PageTitle,
  TABLE,
  TableScroll,
  TD,
  TH,
  useAdminResource,
} from './parts'
import { ADMIN_PATHS } from './paths'
import type { AdminJobFilters, AdminJobRow, AdminPage } from './types'

const FAIL_CODE_OPTIONS = Object.keys(FAIL_MESSAGES)

/**
 * 작업 목록(/admin/jobs). 거르기는 주소 쿼리에 둔다(`jobFilters.ts`). 줄을 누르면 작업 상세로 간다.
 * `useSearchParams`를 쓰므로 페이지가 `<Suspense>`로 감싼다.
 */
export function JobList() {
  const params = useSearchParams()
  const search = params?.toString() ?? ''
  const filters = filtersFromSearch(new URLSearchParams(search))
  const router = useRouter()

  const go = (next: AdminJobFilters) => {
    const query = searchFromFilters(next)
    router.push(query ? `${ADMIN_PATHS.jobs}?${query}` : ADMIN_PATHS.jobs)
  }

  const { state, reload } = useAdminResource(
    (signal) => listReconstructions(filtersFromSearch(new URLSearchParams(search)), signal),
    [search],
  )

  return (
    <>
      <PageTitle>작업 목록</PageTitle>
      {/* 주소가 바뀌면(뒤로 가기 등) 입력칸도 주소 값으로 다시 채운다 */}
      <FilterForm key={search} initial={filters} onSubmit={(next) => go({ ...next, page: 0 })} />
      <div className="mt-(--space-20)">
        {state.kind === 'loading' && <Loading label="작업 목록을 불러오는 중이에요" />}
        {state.kind === 'error' && <LoadError message={state.message} onRetry={reload} />}
        {state.kind === 'ok' && (
          <JobTable
            page={state.data}
            onRowClick={(jobId) => router.push(ADMIN_PATHS.job(jobId))}
            onPage={(page) => go({ ...filters, page })}
          />
        )}
      </div>
    </>
  )
}

function FilterForm({
  initial,
  onSubmit,
}: {
  initial: AdminJobFilters
  onSubmit: (filters: AdminJobFilters) => void
}) {
  const [draft, setDraft] = useState<AdminJobFilters>(initial)
  const set = (key: keyof AdminJobFilters) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(draft)
  }

  return (
    <form
      aria-label="작업 거르기"
      onSubmit={submit}
      className="mt-(--space-16) grid grid-cols-2 gap-(--space-12) md:grid-cols-4 lg:grid-cols-7"
    >
      <Field label="상태">
        <select
          value={draft.status ?? ''}
          onChange={(e) => set('status')(e.target.value)}
          className={INPUT}
        >
          <option value="">전체</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {labelOf(STATUS_LABELS, status)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="실패 코드">
        <select
          value={draft.failCode ?? ''}
          onChange={(e) => set('failCode')(e.target.value)}
          className={INPUT}
        >
          <option value="">전체</option>
          {FAIL_CODE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </Field>
      <Field label="단계">
        <select
          value={draft.stage ?? ''}
          onChange={(e) => set('stage')(e.target.value)}
          className={INPUT}
        >
          <option value="">전체</option>
          {STAGE_OPTIONS.map((stage) => (
            <option key={stage} value={stage}>
              {labelOf(STAGE_LABELS, stage)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="사용자 ID" className="col-span-2 md:col-span-1">
        <input
          type="search"
          value={draft.userId ?? ''}
          onChange={(e) => set('userId')(e.target.value)}
          className={INPUT}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field label="시작일">
        <input
          type="date"
          value={draft.from ?? ''}
          onChange={(e) => set('from')(e.target.value)}
          className={INPUT}
        />
      </Field>
      <Field label="종료일">
        <input
          type="date"
          value={draft.to ?? ''}
          onChange={(e) => set('to')(e.target.value)}
          className={INPUT}
        />
      </Field>
      <div className="col-span-2 flex items-end gap-(--space-8) md:col-span-1">
        <button type="submit" className="btn-primary min-h-10 flex-1 px-(--space-16) text-sm">
          거르기
        </button>
        <button
          type="button"
          className="type-label min-h-10 px-(--space-8) text-muted-soft hover:text-ink"
          onClick={() => {
            setDraft({})
            onSubmit({})
          }}
        >
          초기화
        </button>
      </div>
    </form>
  )
}

const INPUT =
  'type-caption min-h-10 w-full min-w-0 rounded-8 border border-hairline-strong bg-surface px-(--space-10) text-ink'

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-(--space-4) ${className ?? ''}`}>
      <span className="type-caption text-muted-soft">{label}</span>
      {children}
    </label>
  )
}

export function JobTable({
  page,
  onRowClick,
  onPage,
}: {
  page: AdminPage<AdminJobRow>
  onRowClick: (jobId: string) => void
  onPage: (page: number) => void
}) {
  if (page.items.length === 0) {
    return (
      <p className="type-caption py-(--space-24) text-muted-soft">조건에 맞는 작업이 없어요.</p>
    )
  }
  return (
    <>
      <p className="type-caption mb-(--space-8) text-muted-soft">
        전체 <span className="pf-mono">{page.totalElements}</span>건
      </p>
      <TableScroll label="작업 목록">
        <table className={TABLE}>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                만든 시각
              </th>
              <th scope="col" className={TH}>
                작업
              </th>
              <th scope="col" className={TH}>
                사용자
              </th>
              <th scope="col" className={TH}>
                상태
              </th>
              <th scope="col" className={TH}>
                단계
              </th>
              <th scope="col" className={TH}>
                실패 코드
              </th>
              <th scope="col" className={`${TH} text-right`}>
                걸린 시간
              </th>
              <th scope="col" className={TH}>
                촬영
              </th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr
                key={row.jobId}
                onClick={() => onRowClick(row.jobId)}
                className="cursor-pointer hover:bg-canvas"
              >
                <td className={TD}>{formatDateTime(row.createdAt)}</td>
                <td className={TD}>
                  {/* 키보드·새 탭으로도 열 수 있게 링크를 둔다. 줄 클릭과 겹치지 않게 전파를 막는다 */}
                  <Link
                    href={ADMIN_PATHS.job(row.jobId)}
                    title={row.jobId}
                    className="pf-mono underline underline-offset-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {shortId(row.jobId)}
                  </Link>
                </td>
                <td className={`${TD} pf-mono`} title={row.userId}>
                  {shortId(row.userId)}
                </td>
                <td className={row.status === 'FAILED' ? `${TD} text-status-danger` : TD}>
                  {labelOf(STATUS_LABELS, row.status)}
                </td>
                <td className={TD}>{labelOf(STAGE_LABELS, row.stage)}</td>
                <td className={`${TD} pf-mono`}>
                  {row.failCodes.length ? row.failCodes.join(', ') : '-'}
                </td>
                <td className={`${TD} pf-mono text-right`}>
                  {row.durationMs === null ? '-' : formatDuration(row.durationMs)}
                </td>
                <td className={TD}>
                  {[row.captureMethod, row.deviceModel].filter(Boolean).join(' · ') || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <Pager page={page.page} totalPages={page.totalPages} onPage={onPage} />
    </>
  )
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <nav
      aria-label="페이지"
      className="mt-(--space-16) flex items-center justify-center gap-(--space-12)"
    >
      <button
        type="button"
        className="btn-ghost min-h-10 disabled:opacity-40"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        이전
      </button>
      <span className="type-caption pf-mono text-ink-2">
        {page + 1} / {totalPages}
      </span>
      <button
        type="button"
        className="btn-ghost min-h-10 disabled:opacity-40"
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
      >
        다음
      </button>
    </nav>
  )
}
