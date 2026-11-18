import { describe, expect, it } from 'vitest'
import { formatDateTime, formatDuration, formatRate, NO_RECORD, segmentRows } from './format'
import { filtersFromSearch, searchFromFilters } from './jobFilters'

describe('formatDuration', () => {
  it('길이에 맞는 단위로 보인다', () => {
    expect(formatDuration(350)).toBe('350ms')
    expect(formatDuration(1200)).toBe('1.2초')
    expect(formatDuration(15000)).toBe('15초')
    expect(formatDuration(241000)).toBe('4분 1초')
    expect(formatDuration(300000)).toBe('5분')
    expect(formatDuration(3_900_000)).toBe('1시간 5분')
  })

  it('값이 없으면 기록 없음', () => {
    expect(formatDuration(null)).toBe(NO_RECORD)
    expect(formatDuration(undefined)).toBe(NO_RECORD)
  })
})

describe('formatDateTime·formatRate', () => {
  it('UTC를 한국 시각으로 보인다', () => {
    expect(formatDateTime('2026-11-07T03:12:45.123Z')).toContain('12:12:45')
    expect(formatDateTime(null)).toBe(NO_RECORD)
    expect(formatDateTime('not-a-date')).toBe(NO_RECORD)
  })

  it('실패율은 소수 한 자리 %, 없으면 -', () => {
    expect(formatRate(0.111)).toBe('11.1%')
    expect(formatRate(0)).toBe('0.0%')
    expect(formatRate(null)).toBe('-')
  })
})

describe('segmentRows', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 7, 3, 0, s)).toISOString()

  it('구간을 처리 순서대로 보이고, 응답에 없는 구간은 기록 없음(FRAME_SELECT는 기록이 있을 때만)', () => {
    const rows = segmentRows({
      segments: [
        { key: 'GPU_WAIT', startedAt: at(0), finishedAt: at(3), durationMs: 3000 },
        { key: 'RECONSTRUCT', startedAt: at(3), finishedAt: at(50), durationMs: 47000 },
      ],
      slowestSegment: 'RECONSTRUCT',
    })
    expect(rows.map((r) => r.key)).toEqual([
      'EXTRACT_WAIT',
      'EXTRACT',
      'GPU_WAIT',
      'QUALITY_CHECK',
      'RECONSTRUCT',
      'FINALIZE',
    ])
    const extractWait = rows[0]
    expect(extractWait.missing).toBe(true)
    expect(extractWait.label).toBe('추출 대기')
    expect(extractWait.startedAt).toBe(NO_RECORD)
    expect(extractWait.duration).toBe(NO_RECORD)
    expect(rows.find((r) => r.key === 'GPU_WAIT')?.duration).toBe('3.0초')
  })

  it('BE가 준 가장 오래 걸린 구간 하나만 강조한다', () => {
    const rows = segmentRows({
      segments: [
        { key: 'EXTRACT', startedAt: at(0), finishedAt: at(15), durationMs: 15000 },
        { key: 'RECONSTRUCT', startedAt: at(15), finishedAt: at(25), durationMs: 10000 },
      ],
      slowestSegment: 'RECONSTRUCT',
    })
    expect(rows.filter((r) => r.slowest).map((r) => r.key)).toEqual(['RECONSTRUCT'])
  })

  it('BE가 slowestSegment를 안 주면 걸린 시간이 가장 긴 구간을 고른다', () => {
    const rows = segmentRows({
      segments: [
        { key: 'EXTRACT', startedAt: at(0), finishedAt: at(15), durationMs: 15000 },
        { key: 'RECONSTRUCT', startedAt: at(15), finishedAt: at(25), durationMs: 10000 },
      ],
      slowestSegment: null,
    })
    expect(rows.filter((r) => r.slowest).map((r) => r.key)).toEqual(['EXTRACT'])
  })

  it('시각이 모두 null인 구간도 기록 없음이고 강조하지 않는다', () => {
    const rows = segmentRows({
      segments: [{ key: 'FINALIZE', startedAt: null, finishedAt: null, durationMs: null }],
      slowestSegment: 'FINALIZE',
    })
    const finalize = rows.find((r) => r.key === 'FINALIZE')
    expect(finalize?.missing).toBe(true)
    expect(finalize?.slowest).toBe(false)
  })

  it('다시 시도한 구간은 시도마다 한 줄이고, 가장 오래 걸린 시도 하나만 강조한다', () => {
    const rows = segmentRows({
      segments: [
        {
          key: 'EXTRACT',
          startedAt: at(0),
          finishedAt: at(5),
          durationMs: 5000,
          attempt: 1,
          status: 'FAILED',
        },
        {
          key: 'EXTRACT',
          startedAt: at(6),
          finishedAt: at(26),
          durationMs: 20000,
          attempt: 2,
          status: 'SUCCEEDED',
        },
        { key: 'FRAME_SELECT', startedAt: at(26), finishedAt: at(27), durationMs: 1000 },
      ],
      slowestSegment: 'EXTRACT',
    })
    const extract = rows.filter((r) => r.key === 'EXTRACT')
    expect(extract.map((r) => [r.attempt, r.status, r.duration])).toEqual([
      [1, 'FAILED', '5.0초'],
      [2, 'SUCCEEDED', '20초'],
    ])
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
    expect(rows.filter((r) => r.slowest).map((r) => r.attempt)).toEqual([2])
    expect(rows.find((r) => r.key === 'FRAME_SELECT')?.missing).toBe(false)
  })

  it('계약에 없는 새 구간은 뒤에 붙이고 키를 그대로 보인다', () => {
    const rows = segmentRows({
      segments: [{ key: 'UPLOAD', startedAt: at(0), finishedAt: at(1), durationMs: 1000 }],
      slowestSegment: null,
    })
    expect(rows.at(-1)).toMatchObject({ key: 'UPLOAD', label: 'UPLOAD', missing: false })
  })
})

describe('작업 목록 거르기 ↔ 주소', () => {
  it('주소 쿼리를 거르기로 읽고, 빈 값·첫 페이지는 주소에서 뺀다', () => {
    const filters = filtersFromSearch(
      new URLSearchParams('status=FAILED&failCode=&userId=%20u1%20&from=2026-11-01&page=3'),
    )
    expect(filters).toEqual({ status: 'FAILED', userId: 'u1', from: '2026-11-01', page: 3 })
    expect(searchFromFilters(filters)).toBe('status=FAILED&userId=u1&from=2026-11-01&page=3')
    expect(searchFromFilters({ status: '', page: 0 })).toBe('')
  })

  it('잘못된 페이지 값은 무시한다', () => {
    expect(filtersFromSearch(new URLSearchParams('page=-1'))).toEqual({})
    expect(filtersFromSearch(new URLSearchParams('page=abc'))).toEqual({})
  })
})
