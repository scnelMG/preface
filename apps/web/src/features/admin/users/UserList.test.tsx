import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { UserList } from './UserList'
import { isUuid, lookupPath, userFiltersFromSearch, usersPath } from './userSearch'

const push = vi.fn()
let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

beforeEach(() => {
  push.mockReset()
  search = ''
})
afterEach(() => vi.unstubAllGlobals())

// 합성 데이터(실제 회원 아님)
const ACTIVE_ID = '11111111-aaaa-4aaa-8aaa-000000000001'
const WITHDRAWN_ID = '22222222-bbbb-4bbb-8bbb-000000000002'

const page = {
  items: [
    {
      userId: ACTIVE_ID,
      nickname: '테스트회원',
      providers: ['GOOGLE', 'KAKAO'],
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: '2026-11-01T03:00:00Z',
      deletedAt: null,
      faceModelCount: 3,
      lastJobAt: '2026-11-09T01:36:02Z',
    },
    {
      userId: WITHDRAWN_ID,
      nickname: null,
      providers: [],
      role: 'USER',
      status: 'WITHDRAWN',
      createdAt: '2026-10-20T00:00:00Z',
      deletedAt: '2026-11-02T00:00:00Z',
      faceModelCount: 0,
      lastJobAt: null,
    },
  ],
  page: 0,
  size: 20,
  totalElements: 21,
  totalPages: 2,
}

describe('UserList', () => {
  it('목록을 불러와 회원 줄을 그리고, 줄을 누르면 그 회원 화면으로 간다', async () => {
    const fetch = routeFetch([['GET', '/admin/users', ok(page)]])
    render(<UserList />)
    const name = await screen.findByText('테스트회원')
    const url = String(callsTo(fetch, '/admin/users')[0][0])
    expect(url).toContain('page=0')
    expect(url).toContain('size=20')
    expect(url).not.toContain('q=')

    const row = name.closest('tr')!
    const idLink = within(row).getByRole('link', { name: '11111111' })
    expect(idLink).toHaveAttribute('title', ACTIVE_ID)
    expect(idLink).toHaveAttribute('href', `/admin/users/${ACTIVE_ID}`)
    expect(within(row).getByText('구글, 카카오')).toBeInTheDocument()
    expect(within(row).getByText('관리자')).toBeInTheDocument()
    expect(within(row).getByText('활성')).toBeInTheDocument()
    expect(within(row).getByText('3')).toBeInTheDocument()

    fireEvent.click(name)
    expect(push).toHaveBeenCalledWith(`/admin/users/${ACTIVE_ID}`)
  })

  it('탈퇴 회원은 이름 대신 자리 표시를 보인다', async () => {
    routeFetch([['GET', '/admin/users', ok(page)]])
    render(<UserList />)
    const placeholder = await screen.findByText('(탈퇴한 회원)')
    const row = placeholder.closest('tr')!
    expect(within(row).getByText('탈퇴')).toBeInTheDocument()
    expect(within(row).getAllByText('-')).toHaveLength(2) // 로그인 수단·마지막 작업
  })

  it('주소의 검색어로 부르고, 새 검색어는 주소에 남긴다', async () => {
    search = 'q=%ED%85%8C%EC%8A%A4%ED%8A%B8&page=1'
    const fetch = routeFetch([['GET', '/admin/users', ok(page)]])
    render(<UserList />)
    await screen.findByText('테스트회원')
    const url = new URL(String(callsTo(fetch, '/admin/users')[0][0]), 'http://x')
    expect(url.searchParams.get('q')).toBe('테스트')
    expect(url.searchParams.get('page')).toBe('1')

    const input = screen.getByRole('searchbox', { name: '이름 또는 user ID' })
    expect(input).toHaveValue('테스트')
    fireEvent.change(input, { target: { value: ' 다른 이름 ' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    expect(push).toHaveBeenCalledWith('/admin/users?q=%EB%8B%A4%EB%A5%B8+%EC%9D%B4%EB%A6%84')

    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }))
    expect(push).toHaveBeenLastCalledWith('/admin/users')
  })

  it('다음 페이지는 검색어를 유지한 채 page만 바꾼다', async () => {
    search = 'q=abc'
    routeFetch([['GET', '/admin/users', ok(page)]])
    render(<UserList />)
    fireEvent.click(await screen.findByRole('button', { name: '다음' }))
    expect(push).toHaveBeenCalledWith('/admin/users?q=abc&page=1')
  })

  it('검색 결과가 없으면 빈 상태를 보인다', async () => {
    search = 'q=zzz'
    routeFetch([
      [
        'GET',
        '/admin/users',
        ok({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
      ],
    ])
    render(<UserList />)
    expect(await screen.findByText('검색어에 맞는 회원이 없어요.')).toBeInTheDocument()
  })

  it('불러오지 못하면 서버 문구와 다시 시도를 보이고, 다시 부를 수 있다', async () => {
    const fetch = routeFetch([
      ['GET', '/admin/users', fail(400, 'COMMON_001', '검색어가 너무 길어요.')],
      ['GET', '/admin/users', ok(page)],
    ])
    render(<UserList />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('검색어가 너무 길어요.')
    fireEvent.click(within(alert).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('테스트회원')).toBeInTheDocument()
    expect(callsTo(fetch, '/admin/users')).toHaveLength(2)
  })
})

describe('userSearch', () => {
  it('UUID는 대소문자·앞뒤 공백과 상관없이 알아본다', () => {
    expect(isUuid(` ${ACTIVE_ID.toUpperCase()} `)).toBe(true)
    expect(isUuid('11111111-aaaa')).toBe(false)
    expect(isUuid('테스트회원')).toBe(false)
  })

  it('머리줄 입력: UUID면 회원 화면, 아니면 검색, 비면 없음', () => {
    expect(lookupPath(` ${ACTIVE_ID} `)).toBe(`/admin/users/${ACTIVE_ID}`)
    expect(lookupPath('홍 길동')).toBe('/admin/users?q=%ED%99%8D+%EA%B8%B8%EB%8F%99')
    expect(lookupPath('   ')).toBeNull()
  })

  it('주소 쿼리를 읽고 다시 쓴다', () => {
    expect(userFiltersFromSearch(new URLSearchParams('q=+a+&page=-1'))).toEqual({
      q: 'a',
      page: 0,
    })
    expect(usersPath({ q: '', page: 0 })).toBe('/admin/users')
    expect(usersPath({ q: 'a', page: 2 })).toBe('/admin/users?q=a&page=2')
  })
})
