import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LandingPage } from './LandingPage'
import { FIRST_VISIT_STORAGE_KEY } from './firstVisit'

// 3D 무대(WebGL)는 jsdom에서 그릴 수 없어 자리만 둔다. 문구·행동은 무대 없이도 읽혀야 한다
vi.mock('./stage/LandingStage', () => ({
  LandingStage: () => <div data-testid="landing-stage" />,
}))

describe('랜딩', () => {
  it('첫 화면 제목과 시작하기가 무대 없이도 읽히고 메인으로 간다', () => {
    render(<LandingPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '휴대폰 영상 하나로,나의 3D 얼굴.',
    )
    const starts = screen.getAllByRole('link', { name: '시작하기' })
    expect(starts).toHaveLength(2)
    starts.forEach((link) => expect(link).toHaveAttribute('href', '/'))
  })

  it('구간 여섯 개를 차례로 그리고, 가상 인물·참고용 시뮬레이션임을 밝힌다', () => {
    const { container } = render(<LandingPage />)

    expect(container.querySelectorAll('[data-landing-sec]')).toHaveLength(6)
    expect(screen.getByRole('heading', { name: /미리 내 얼굴에/ })).toBeInTheDocument()
    expect(screen.getByText(/메타휴먼으로 만든 가상 인물/)).toHaveTextContent(
      '참고용 시뮬레이션이라 실제 결과와 다를 수 있어요',
    )
  })

  it('도착하면 방문으로 기록한다', () => {
    window.localStorage.removeItem(FIRST_VISIT_STORAGE_KEY)
    render(<LandingPage />)
    expect(window.localStorage.getItem(FIRST_VISIT_STORAGE_KEY)).not.toBeNull()
  })
})
