'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { formatDateTime, labelOf, shortId } from '../format'
import {
  LoadError,
  Loading,
  PageTitle,
  TABLE,
  TableScroll,
  TD,
  TH,
  useAdminResource,
} from '../parts'
import { ADMIN_PATHS } from '../paths'
import type { AdminPage } from '../types'
import { listAdminUsers } from './api'
import type { AdminUserRow } from './types'
import { userFiltersFromSearch, usersPath } from './userSearch'

export const PROVIDER_LABELS: Record<string, string> = { KAKAO: '카카오', GOOGLE: '구글' }
export const ROLE_LABELS: Record<string, string> = { USER: '일반', ADMIN: '관리자' }
export const USER_STATUS_LABELS: Record<string, string> = { ACTIVE: '활성', WITHDRAWN: '탈퇴' }

/** 탈퇴 회원은 이름이 지워져 null로 온다 */
export const WITHDRAWN_NAME = '(탈퇴한 회원)'

/**
 * 회원 목록·검색(/admin/users, S15P31B204-708). 검색어와 페이지는 주소 쿼리(`?q=&page=`)에 둔다.
 * 줄을 누르면 그 회원의 모델 화면(`/admin/users/{userId}`)으로 간다.
 * `useSearchParams`를 쓰므로 페이지가 `<Suspense>`로 감싼다.
 */
export function UserList() {
  const params = useSearchParams()
  const search = params?.toString() ?? ''
  const filters = userFiltersFromSearch(new URLSearchParams(search))
  const router = useRouter()

  const { state, reload } = useAdminResource(
    (signal) => listAdminUsers(userFiltersFromSearch(new URLSearchParams(search)), signal),
    [search],
  )

  return (
    <>
      <PageTitle>회원</PageTitle>
      {/* 주소가 바뀌면(뒤로 가기 등) 입력칸도 주소 값으로 다시 채운다 */}
      <SearchForm
        key={search}
        initial={filters.q ?? ''}
        onSubmit={(q) => router.push(usersPath({ q }))}
      />
      <div className="mt-(--space-20)">
        {state.kind === 'loading' && <Loading label="회원 목록을 불러오는 중이에요" />}
        {state.kind === 'error' && <LoadError message={state.message} onRetry={reload} />}
        {state.kind === 'ok' && (
          <UserTable
            page={state.data}
            searched={Boolean(filters.q)}
            onRowClick={(userId) => router.push(ADMIN_PATHS.user(userId))}
            onPage={(page) => router.push(usersPath({ ...filters, page }))}
          />
        )}
      </div>
    </>
  )
}

function SearchForm({ initial, onSubmit }: { initial: string; onSubmit: (q: string) => void }) {
  const [draft, setDraft] = useState(initial)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(draft)
  }
  return (
    <form
      role="search"
      aria-label="회원 검색"
      onSubmit={submit}
      className="mt-(--space-16) flex flex-wrap items-center gap-(--space-8)"
    >
      <input
        type="search"
        aria-label="이름 또는 user ID"
        placeholder="이름 또는 user ID"
        value={draft}
        maxLength={50}
        onChange={(event) => setDraft(event.target.value)}
        className="type-caption min-h-10 w-full min-w-0 rounded-8 border border-hairline-strong bg-surface px-(--space-10) text-ink md:w-80"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="btn-primary min-h-10 px-(--space-16) text-sm">
        검색
      </button>
      {initial && (
        <button
          type="button"
          className="type-label min-h-10 px-(--space-8) text-muted-soft hover:text-ink"
          onClick={() => onSubmit('')}
        >
          전체 보기
        </button>
      )}
    </form>
  )
}

export function UserTable({
  page,
  searched,
  onRowClick,
  onPage,
}: {
  page: AdminPage<AdminUserRow>
  searched: boolean
  onRowClick: (userId: string) => void
  onPage: (page: number) => void
}) {
  if (page.items.length === 0) {
    return (
      <p className="type-caption py-(--space-24) text-muted-soft">
        {searched ? '검색어에 맞는 회원이 없어요.' : '아직 회원이 없어요.'}
      </p>
    )
  }
  return (
    <>
      <p className="type-caption mb-(--space-8) text-muted-soft">
        전체 <span className="pf-mono">{page.totalElements}</span>명
      </p>
      <TableScroll label="회원 목록">
        <table className={TABLE}>
          <thead>
            <tr>
              <th scope="col" className={TH}>
                이름
              </th>
              <th scope="col" className={TH}>
                user ID
              </th>
              <th scope="col" className={TH}>
                로그인 수단
              </th>
              <th scope="col" className={TH}>
                역할
              </th>
              <th scope="col" className={TH}>
                상태
              </th>
              <th scope="col" className={TH}>
                가입일
              </th>
              <th scope="col" className={`${TH} text-right`}>
                모델 수
              </th>
              <th scope="col" className={TH}>
                마지막 작업
              </th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr
                key={row.userId}
                onClick={() => onRowClick(row.userId)}
                className="cursor-pointer hover:bg-canvas"
              >
                <td className={row.nickname === null ? `${TD} text-muted-soft` : TD}>
                  {row.nickname ?? WITHDRAWN_NAME}
                </td>
                <td className={TD}>
                  {/* 키보드·새 탭으로도 열 수 있게 링크를 둔다. 줄 클릭과 겹치지 않게 전파를 막는다 */}
                  <Link
                    href={ADMIN_PATHS.user(row.userId)}
                    title={row.userId}
                    className="pf-mono underline underline-offset-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {shortId(row.userId)}
                  </Link>
                </td>
                <td className={TD}>
                  {row.providers.length
                    ? row.providers.map((p) => labelOf(PROVIDER_LABELS, p)).join(', ')
                    : '-'}
                </td>
                <td className={TD}>{labelOf(ROLE_LABELS, row.role)}</td>
                <td className={TD}>{labelOf(USER_STATUS_LABELS, row.status)}</td>
                <td className={TD}>{formatDateTime(row.createdAt)}</td>
                <td className={`${TD} pf-mono text-right`}>{row.faceModelCount}</td>
                <td className={TD}>{row.lastJobAt ? formatDateTime(row.lastJobAt) : '-'}</td>
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
