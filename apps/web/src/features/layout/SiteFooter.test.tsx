import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWorkScreen, SiteFooter } from './SiteFooter'

const path = vi.hoisted(() => ({ current: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => path.current }))

afterEach(() => {
  path.current = '/'
})

const links = [{ href: '/legal/terms', label: '이용약관' }]

describe('SiteFooter (-563)', () => {
  it('작업 화면(작업실·머리 추가·실험실·3D 생성 대기)은 작업 화면으로 본다', () => {
    for (const pathname of [
      '/studio',
      '/studio/new',
      '/lab',
      '/simulations/sim-1',
      '/reconstructions/job-1',
    ]) {
      expect(isWorkScreen(pathname)).toBe(true)
    }
  })

  it('메인·서비스 소개·약관·소개·내 정보는 작업 화면이 아니다', () => {
    for (const pathname of ['/', '/services', '/legal/terms', '/about', '/me', '/labs']) {
      expect(isWorkScreen(pathname)).toBe(false)
    }
  })

  it('메인에서는 약관 링크와 문의 메일이 있는 푸터를 그린다', async () => {
    render(<SiteFooter links={links} contact="contact@example.com" />)
    expect(await screen.findByRole('link', { name: '이용약관' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('메인 푸터는 휴대폰에서도 숨기지 않는다', async () => {
    render(<SiteFooter links={links} contact="contact@example.com" />)
    const footer = await screen.findByRole('contentinfo')
    expect(footer.closest('.max-md\:hidden')).toBeNull()
  })

  it('실험실에서는 휴대폰에서만 푸터를 숨기고 PC에서는 둔다', async () => {
    path.current = '/simulations/sim-1'
    render(<SiteFooter links={links} contact="contact@example.com" />)
    const footer = await screen.findByRole('contentinfo')
    expect(footer.parentElement).toHaveClass('max-md:hidden')
  })
})
