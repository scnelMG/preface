'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState, type FormEvent } from 'react'
import { cx } from '@/shared/ui'
import { ADMIN_ENV_LABELS, environmentUrl, type SwitchableEnvironment } from './environment'
import { ADMIN_PATHS } from './paths'
import type { AdminMe } from './types'
import { lookupPath } from './users/userSearch'

const NAV = [
  { href: ADMIN_PATHS.home, label: '한눈에 보기', match: (path: string) => path === '/admin' },
  {
    href: ADMIN_PATHS.jobs,
    label: '작업 목록',
    match: (path: string) => path.startsWith('/admin/jobs'),
  },
  {
    href: ADMIN_PATHS.users,
    label: '회원',
    match: (path: string) => path.startsWith('/admin/users'),
  },
] as const

/**
 * 관리자 머리줄: 메뉴(한눈에 보기·작업 목록·회원), 사용자 조회 입력, 운영 | 개발 탭.
 * 주소를 읽는 훅을 쓰므로 `<Suspense>`로 감싸고, 기다리는 동안 주소 없이 그린다(apps/web/AGENTS.md).
 */
export function AdminHeader({ me }: { me: AdminMe }) {
  return (
    <Suspense fallback={<HeaderFrame me={me} pathname="" search="" />}>
      <LiveHeader me={me} />
    </Suspense>
  )
}

function LiveHeader({ me }: { me: AdminMe }) {
  const pathname = usePathname() ?? ''
  const search = useSearchParams()?.toString() ?? ''
  return <HeaderFrame me={me} pathname={pathname} search={search} />
}

function HeaderFrame({ me, pathname, search }: { me: AdminMe; pathname: string; search: string }) {
  return (
    <header className="border-b border-hairline bg-surface">
      <div className="mx-auto flex w-full max-w-page flex-wrap items-center gap-x-(--space-24) gap-y-(--space-12) px-(--space-16) py-(--space-12) md:px-(--space-32)">
        <Link href={ADMIN_PATHS.home} className="type-label text-ink">
          Preface 관리자
        </Link>
        <nav aria-label="관리자 메뉴" className="flex items-center gap-(--space-16)">
          {NAV.map((item) => {
            const active = item.match(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'type-label min-h-10 inline-flex items-center',
                  active
                    ? 'text-ink underline underline-offset-4'
                    : 'text-muted-soft hover:text-ink-2',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <UserLookup />
        <EnvironmentTabs
          current={me.environment}
          pathname={pathname || ADMIN_PATHS.home}
          search={search}
        />
      </div>
    </header>
  )
}

/** user ID(UUID)를 넣으면 그 사용자의 모델 화면으로, 그 밖(이름 등)은 회원 검색으로 간다 */
function UserLookup() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const path = lookupPath(value)
    if (path) router.push(path)
  }
  return (
    <form
      role="search"
      aria-label="사용자 조회"
      onSubmit={submit}
      className="flex items-center gap-(--space-8)"
    >
      <input
        type="search"
        aria-label="user ID 또는 이름"
        placeholder="user ID 또는 이름"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="type-caption min-h-10 w-full min-w-0 rounded-full border border-hairline-strong bg-transparent px-(--space-14) text-ink placeholder:text-faint md:w-72"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        className="type-label min-h-10 shrink-0 px-(--space-8) text-ink-2 hover:text-ink"
      >
        조회
      </button>
    </form>
  )
}

const SWITCHABLE: readonly SwitchableEnvironment[] = ['prod', 'dev']

/**
 * 운영 | 개발 탭. 지금 환경은 `/admin/me`의 `environment`로 표시하고, 다른 쪽을 누르면 그 환경의 같은 주소로 페이지째 옮긴다.
 * 로컬에서는 둘 다 다른 환경이라 둘 다 링크로 둔다.
 */
export function EnvironmentTabs({
  current,
  pathname,
  search,
}: {
  current: AdminMe['environment']
  pathname: string
  search: string
}) {
  return (
    <nav aria-label="환경" className="ml-auto flex items-center gap-(--space-12)">
      {current === 'local' && (
        <span className="type-caption rounded-full border border-hairline px-(--space-8) text-muted-soft">
          {ADMIN_ENV_LABELS.local}
        </span>
      )}
      <div className="flex items-center gap-(--space-4) rounded-full border border-hairline p-(--space-2)">
        {SWITCHABLE.map((env) =>
          env === current ? (
            <span
              key={env}
              aria-current="true"
              className="type-label inline-flex min-h-9 items-center rounded-full bg-ink px-(--space-14) text-on-ink"
            >
              {ADMIN_ENV_LABELS[env]}
            </span>
          ) : (
            <a
              key={env}
              href={environmentUrl(env, pathname, search)}
              className="type-label inline-flex min-h-9 items-center rounded-full px-(--space-14) text-muted-soft hover:text-ink-2"
            >
              {ADMIN_ENV_LABELS[env]}
            </a>
          ),
        )}
      </div>
    </nav>
  )
}
