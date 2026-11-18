import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetToaster } from '@/shared/ui/Toast'
import { Analytics } from './Analytics'
import {
  ANALYTICS_OFF_ITEM,
  applyAnalyticsParam,
  isAnalyticsOff,
  resetAnalyticsOff,
} from './optOut'

vi.mock('next/script', () => ({
  default: ({ id }: { id: string }) => <span data-testid="script" data-id={id} />,
}))

afterEach(() => {
  cleanup()
  act(() => __resetToaster())
  resetAnalyticsOff()
  window.history.replaceState(null, '', '/')
})

describe('isAnalyticsOff', () => {
  it('주소 값이 저장된 값보다 먼저다', () => {
    expect(isAnalyticsOff('?analytics=off')).toBe(true)
    localStorage.setItem(ANALYTICS_OFF_ITEM, '1')
    expect(isAnalyticsOff('?analytics=on')).toBe(false)
    expect(isAnalyticsOff('')).toBe(true)
  })

  it('아무 표시가 없으면 켠다', () => {
    expect(isAnalyticsOff('')).toBe(false)
    expect(isAnalyticsOff('?other=1')).toBe(false)
  })
})

describe('applyAnalyticsParam', () => {
  it('off를 저장하고 주소에서 그 값만 지운다', () => {
    window.history.replaceState(null, '', '/studio?analytics=off&tab=2#top')
    expect(applyAnalyticsParam()).toBe('off')
    expect(localStorage.getItem(ANALYTICS_OFF_ITEM)).toBe('1')
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/studio?tab=2#top',
    )
    expect(isAnalyticsOff(window.location.search)).toBe(true)
  })

  it('on이면 지운다', () => {
    localStorage.setItem(ANALYTICS_OFF_ITEM, '1')
    window.history.replaceState(null, '', '/?analytics=on')
    expect(applyAnalyticsParam()).toBe('on')
    expect(localStorage.getItem(ANALYTICS_OFF_ITEM)).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('주소에 없으면 아무것도 바꾸지 않는다', () => {
    window.history.replaceState(null, '', '/?other=1')
    expect(applyAnalyticsParam()).toBeNull()
    expect(window.location.search).toBe('?other=1')
  })
})

describe('Analytics', () => {
  it('?analytics=off로 들어오면 끈 것을 알리고 주소를 정리한다', async () => {
    window.history.replaceState(null, '', '/?analytics=off')
    const { container } = render(<Analytics gaId="G-TEST" clarityId="test" />)
    expect(
      await screen.findByText('이 브라우저에서는 이용 분석을 하지 않아요.'),
    ).toBeInTheDocument()
    expect(localStorage.getItem(ANALYTICS_OFF_ITEM)).toBe('1')
    expect(window.location.search).toBe('')
    expect(container.querySelector('[data-testid="script"]')).toBeNull()
  })

  it('?analytics=on으로 들어오면 다시 켰다고 알린다', async () => {
    localStorage.setItem(ANALYTICS_OFF_ITEM, '1')
    window.history.replaceState(null, '', '/?analytics=on')
    render(<Analytics gaId="G-TEST" clarityId="test" />)
    expect(await screen.findByText('이 브라우저에서 이용 분석을 다시 켰어요.')).toBeInTheDocument()
    expect(localStorage.getItem(ANALYTICS_OFF_ITEM)).toBeNull()
  })
})
