import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Analytics, AnalyticsScripts, analyticsMode } from './Analytics'
import { PRODUCTION_HOST } from './config'

// next/script는 화면이 뜬 뒤 스크립트를 넣는다. 무엇을 넣으려 했는지만 본다
vi.mock('next/script', () => ({
  default: ({ id, src, strategy }: { id: string; src?: string; strategy?: string }) => (
    <span data-testid="script" data-id={id} data-src={src} data-strategy={strategy} />
  ),
}))

afterEach(cleanup)

function scriptIds(container: HTMLElement) {
  return [...container.querySelectorAll('[data-testid="script"]')].map((el) =>
    el.getAttribute('data-id'),
  )
}

describe('analyticsMode', () => {
  it('운영 주소에서만 켠다', () => {
    expect(analyticsMode(PRODUCTION_HOST, '/')).toBe('record')
    expect(analyticsMode(`${PRODUCTION_HOST}:8080`, '/')).toBe('off')
    expect(analyticsMode('localhost:3000', '/')).toBe('off')
  })

  it('촬영 화면에서는 세션 녹화 없이 측정만 한다', () => {
    expect(analyticsMode(PRODUCTION_HOST, '/m/capture')).toBe('measure')
  })

  it('공유받은 시안 화면은 주소에 공유 토큰이 있어 분석을 켜지 않는다', () => {
    expect(analyticsMode(PRODUCTION_HOST, '/s/abcDEF_123-xyz')).toBe('off')
  })

  it('관리자 화면은 사용자 ID·작업 기록이 보여 분석을 켜지 않는다', () => {
    expect(analyticsMode(PRODUCTION_HOST, '/admin')).toBe('off')
    expect(analyticsMode(PRODUCTION_HOST, '/admin/jobs/abc')).toBe('off')
  })
})

describe('AnalyticsScripts', () => {
  it('운영 주소가 아니면 아무것도 불러오지 않는다', () => {
    const { container } = render(<AnalyticsScripts mode="off" gaId="G-TEST" clarityId="test" />)
    expect(scriptIds(container)).toEqual([])
  })

  it('ID가 비어 있으면 그 도구는 불러오지 않는다', () => {
    const { container } = render(<AnalyticsScripts mode="record" gaId="" clarityId="" />)
    expect(scriptIds(container)).toEqual([])
  })

  it('GA4와 Clarity를 불러온다', () => {
    const { container } = render(<AnalyticsScripts mode="record" gaId="G-TEST" clarityId="test" />)
    expect(scriptIds(container)).toEqual(['ga4-init', 'ga4', 'clarity-init'])
    expect(container.querySelector('[data-id="ga4"]')?.getAttribute('data-src')).toBe(
      'https://www.googletagmanager.com/gtag/js?id=G-TEST',
    )
  })

  it('스크립트 id가 도구의 전역 이름과 겹치지 않는다(겹치면 window.clarity가 요소를 가리켜 Clarity가 멈춘다)', () => {
    const { container } = render(<AnalyticsScripts mode="record" gaId="G-TEST" clarityId="test" />)
    for (const name of ['clarity', 'gtag', 'dataLayer']) {
      expect(scriptIds(container)).not.toContain(name)
    }
  })

  it('모두 화면이 뜬 직후 받는다(한가할 때를 기다리면 바쁜 메인에서 Clarity가 빠진다)', () => {
    const { container } = render(<AnalyticsScripts mode="record" gaId="G-TEST" clarityId="test" />)
    const strategies = [...container.querySelectorAll('[data-testid="script"]')].map((el) =>
      el.getAttribute('data-strategy'),
    )
    expect(strategies).toEqual(['afterInteractive', 'afterInteractive', 'afterInteractive'])
  })

  it('측정만 할 때는 Clarity를 불러오지 않는다', () => {
    const { container } = render(<AnalyticsScripts mode="measure" gaId="G-TEST" clarityId="test" />)
    expect(scriptIds(container)).toEqual(['ga4-init', 'ga4'])
  })
})

describe('Analytics', () => {
  it('로컬 주소에서는 ID가 있어도 불러오지 않는다', () => {
    const { container } = render(<Analytics gaId="G-TEST" clarityId="test" />)
    expect(scriptIds(container)).toEqual([])
  })
})
