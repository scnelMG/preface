import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, ok, routeFetch } from '@/features/auth/testUtils'
import { useAuthStore } from '@/features/auth/store'
import { AdminGate, useAdminMe } from './AdminGate'

const push = vi.fn()
let pathname = '/admin/jobs'
let search = 'status=FAILED'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}))

beforeEach(() => {
  push.mockReset()
  pathname = '/admin/jobs'
  search = 'status=FAILED'
  useAuthStore.setState({ status: 'member', leaving: false })
})

afterEach(() => vi.unstubAllGlobals())

function Env() {
  return <p>환경 {useAdminMe().environment}</p>
}

function renderGate() {
  return render(
    <AdminGate>
      <Env />
    </AdminGate>,
  )
}

describe('AdminGate', () => {
  it('관리자면 머리줄과 내용을 그린다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'dev' })]])
    renderGate()
    expect(await screen.findByText('환경 dev')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '한눈에 보기' })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: '작업 목록' })).toHaveAttribute('aria-current', 'page')
  })

  it('관리자가 아니면(403) 내용 없이 "관리자만 볼 수 있어요"를 보인다', async () => {
    routeFetch([['GET', '/admin/me', fail(403, 'ADM_001', '관리자 권한이 필요해요.')]])
    renderGate()
    expect(
      await screen.findByRole('heading', { name: '관리자만 볼 수 있어요' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/환경/)).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '관리자 메뉴' })).not.toBeInTheDocument()
  })

  it('세션이 끝났으면(401) 로그아웃 상태로 돌려 로그인 모달 흐름에 맡긴다', async () => {
    routeFetch([['GET', '/admin/me', fail(401, 'AUTH_001')]])
    renderGate()
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
  })

  it('다른 오류면 다시 시도할 수 있다', async () => {
    routeFetch([
      ['GET', '/admin/me', fail(500, 'COMMON_999', '서버 오류')],
      ['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'prod' })],
    ])
    renderGate()
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('환경 prod')).toBeInTheDocument()
  })

  it('운영 | 개발 탭: 지금 환경은 표시만, 다른 환경은 같은 경로·쿼리로 간다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'prod' })]])
    renderGate()
    await screen.findByText('환경 prod')
    const env = screen.getByRole('navigation', { name: '환경' })
    expect(env.querySelector('[aria-current="true"]')).toHaveTextContent('운영')
    const dev = screen.getByRole('link', { name: '개발' })
    expect(dev).toHaveAttribute('href', 'https://preface.example.com:8080/admin/jobs?status=FAILED')
    expect(screen.queryByRole('link', { name: '운영' })).not.toBeInTheDocument()
  })

  it('로컬이면 운영·개발 둘 다 링크로 둔다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'local' })]])
    search = ''
    pathname = '/admin'
    renderGate()
    await screen.findByText('환경 local')
    expect(screen.getByRole('link', { name: '운영' })).toHaveAttribute(
      'href',
      'https://preface.example.com/admin',
    )
    expect(screen.getByRole('link', { name: '개발' })).toHaveAttribute(
      'href',
      'https://preface.example.com:8080/admin',
    )
  })

  it('user ID(UUID)를 넣고 조회하면 그 사용자의 모델 화면으로 간다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'dev' })]])
    renderGate()
    await screen.findByText('환경 dev')
    fireEvent.change(screen.getByRole('searchbox', { name: 'user ID 또는 이름' }), {
      target: { value: '  0D6C0000-0000-4000-8000-00000000AB12 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(push).toHaveBeenCalledWith('/admin/users/0D6C0000-0000-4000-8000-00000000AB12')
  })

  it('UUID가 아니면 이름으로 보고 회원 검색으로 간다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'dev' })]])
    renderGate()
    await screen.findByText('환경 dev')
    fireEvent.change(screen.getByRole('searchbox', { name: 'user ID 또는 이름' }), {
      target: { value: ' 테스트 회원&1 ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(push).toHaveBeenCalledWith(
      `/admin/users?q=${encodeURIComponent('테스트 회원&1').replace(/%20/g, '+')}`,
    )
  })

  it('머리줄 메뉴에 회원이 있고, 회원 화면에서는 지금 메뉴로 표시한다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'dev' })]])
    pathname = '/admin/users'
    search = ''
    renderGate()
    await screen.findByText('환경 dev')
    const link = screen.getByRole('link', { name: '회원' })
    expect(link).toHaveAttribute('href', '/admin/users')
    expect(link).toHaveAttribute('aria-current', 'page')
  })

  it('화면 전체를 세션 녹화에서 가린다', async () => {
    routeFetch([['GET', '/admin/me', ok({ userId: 'u-1', role: 'ADMIN', environment: 'dev' })]])
    renderGate()
    const content = await screen.findByText('환경 dev')
    expect(content.closest('[data-clarity-mask="True"]')).not.toBeNull()
  })
})
