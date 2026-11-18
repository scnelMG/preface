import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { Dashboard, QueueTable } from './Dashboard'

afterEach(() => vi.unstubAllGlobals())

const summary = (period: string) => ({
  period,
  from: '2026-11-06T15:00:00.000Z',
  to: '2026-11-07T15:00:00.000Z',
  counts: { QUEUED: 1, RUNNING: 2, SUCCEEDED: 40, FAILED: 5 },
  total: 48,
  failureRate: 0.111,
  failCodes: [{ code: 'TIMEOUT', count: 3 }],
  durationMs: { avg: 241000, p95: 402000, targetMs: 300000 },
  stuckCount: 1,
  stuckThresholdMinutes: 15,
})

const queue = {
  extract: [
    {
      position: 1,
      jobId: 'job-aaaaaaaa-1',
      userId: 'user-bbbbbbbb-1',
      queuedAt: '2026-11-07T03:00:00.000Z',
      waitedMs: 42000,
    },
  ],
  gpu: [],
}

describe('Dashboard', () => {
  it('요약과 대기열을 보이고, 기간을 바꾸면 그 기간으로 다시 부른다', async () => {
    const fetch = routeFetch([
      ['GET', '/admin/reconstructions/summary', ok(summary('today'))],
      ['GET', '/admin/reconstructions/queue', ok(queue)],
      ['GET', '/admin/reconstructions/summary', ok(summary('7d'))],
    ])
    render(<Dashboard />)

    expect(await screen.findByText('11.1%')).toBeInTheDocument()
    expect(screen.getByText('4분 1초')).toBeInTheDocument()
    expect(screen.getByText('6분 42초')).toBeInTheDocument()
    expect(screen.getAllByText('목표 5분')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'TIMEOUT' })).toHaveAttribute(
      'href',
      '/admin/jobs?status=FAILED&failCode=TIMEOUT',
    )
    expect(await screen.findByRole('link', { name: 'job-aaaa' })).toHaveAttribute(
      'href',
      '/admin/jobs/job-aaaaaaaa-1',
    )
    expect(screen.getByText('기다리는 작업이 없어요.')).toBeInTheDocument()
    expect(String(callsTo(fetch, '/summary')[0][0])).toContain('period=today')

    fireEvent.click(screen.getByRole('button', { name: '7일' }))
    await vi.waitFor(() => expect(callsTo(fetch, '/summary')).toHaveLength(2))
    expect(String(callsTo(fetch, '/summary')[1][0])).toContain('period=7d')
  })

  it('추출 목록에서 지금 추출 중인 작업은 순번 대신 "추출 중"이다(S15P31B204-729)', () => {
    render(
      <QueueTable
        title="추출 대기"
        entries={[
          { ...queue.extract[0], position: null, jobId: 'job-cccccccc-1' },
          { ...queue.extract[0], position: 1, jobId: 'job-dddddddd-1' },
        ]}
      />,
    )
    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('추출 중')
    expect(rows[2].querySelector('td')).toHaveTextContent(/^1$/)
  })
})
