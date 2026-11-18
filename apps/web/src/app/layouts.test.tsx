import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AdminLayout, { metadata as adminMetadata } from './(admin)/layout'
import AppLayout from './(app)/layout'
import PublicLayout from './(public)/layout'

// 레이아웃이 무엇을 붙이는지만 본다. 각 부품의 동작은 부품 테스트가 맡는다
vi.mock('@/features/layout/SiteHeader', () => ({ SiteHeader: () => <header /> }))
vi.mock('@/features/auth/LoginModal', () => ({ LoginModal: () => null }))
vi.mock('@/features/auth/AuthGate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/features/admin/AdminGate', () => ({
  AdminGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-gate">{children}</div>
  ),
}))
vi.mock('@/features/layout/SiteFooter', () => ({ SiteFooter: () => <footer /> }))
vi.mock('@/features/reconstruction/ProgressDock', () => ({
  ProgressDock: () => <div data-testid="progress-dock" />,
}))

describe('레이아웃의 3D 생성 진행 팝업', () => {
  it('회원 화면에 붙는다', () => {
    render(<AppLayout params={Promise.resolve({})}>내용</AppLayout>)
    expect(screen.getByTestId('progress-dock')).toBeInTheDocument()
  })

  it('메인·서비스·체험 같은 공개 화면에도 붙는다', () => {
    render(<PublicLayout params={Promise.resolve({})}>내용</PublicLayout>)
    expect(screen.getByTestId('progress-dock')).toBeInTheDocument()
  })
})

describe('관리자 레이아웃', () => {
  it('검색에 나오지 않게 하고, 일반 머리줄·진행 팝업 없이 관리자 문지기 안에 내용을 둔다', () => {
    expect(adminMetadata.robots).toEqual({ index: false, follow: false })
    render(<AdminLayout params={Promise.resolve({})}>관리 내용</AdminLayout>)
    expect(screen.getByTestId('admin-gate')).toHaveTextContent('관리 내용')
    expect(screen.queryByTestId('progress-dock')).not.toBeInTheDocument()
  })
})
