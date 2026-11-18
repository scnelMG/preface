import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { JobList } from './JobList'

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

const page = {
  items: [
    {
      jobId: '11111111-aaaa',
      userId: '22222222-bbbb',
      status: 'FAILED',
      stage: 'RECONSTRUCT',
      failCodes: ['TIMEOUT'],
      durationMs: 182000,
      createdAt: '2026-11-07T03:00:00.000Z',
      finishedAt: '2026-11-07T03:03:02.000Z',
      captureMethod: 'VIDEO',
      deviceModel: 'iPhone15,2',
    },
  ],
  page: 0,
  size: 20,
  totalElements: 21,
  totalPages: 2,
}

describe('JobList', () => {
  it('주소 쿼리의 거르기로 목록을 부르고, 줄을 누르면 상세로 간다', async () => {
    search = 'status=FAILED&page=0'
    const fetch = routeFetch([['GET', '/admin/reconstructions', ok(page)]])
    render(<JobList />)
    const cell = await screen.findByText('3분 2초')
    expect(String(callsTo(fetch, '/admin/reconstructions')[0][0])).toContain('status=FAILED')
    expect(screen.getByRole('combobox', { name: '상태' })).toHaveValue('FAILED')

    fireEvent.click(cell)
    expect(push).toHaveBeenCalledWith('/admin/jobs/11111111-aaaa')
  })

  it('거르기를 바꾸면 주소에 남기고 첫 페이지로 돌아간다', async () => {
    search = 'page=1'
    routeFetch([['GET', '/admin/reconstructions', ok(page)]])
    render(<JobList />)
    await screen.findByText('3분 2초')
    fireEvent.change(screen.getByRole('combobox', { name: '단계' }), {
      target: { value: 'FINALIZE' },
    })
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: '거르기' }))
    expect(push).toHaveBeenCalledWith('/admin/jobs?stage=FINALIZE&from=2026-11-01')
  })

  it('다음 페이지는 거르기를 유지한 채 page만 바꾼다', async () => {
    search = 'status=FAILED'
    routeFetch([['GET', '/admin/reconstructions', ok(page)]])
    render(<JobList />)
    fireEvent.click(await screen.findByRole('button', { name: '다음' }))
    expect(push).toHaveBeenCalledWith('/admin/jobs?status=FAILED&page=1')
  })
})
