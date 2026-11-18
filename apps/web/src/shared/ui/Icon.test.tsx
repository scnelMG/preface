import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Icon, ICON_NAMES, iconWeights } from './Icon'

describe('Icon', () => {
  it('Figma Icons 63개 + Bell — 이름·굵기 조합이 64개다', () => {
    const combos = ICON_NAMES.flatMap((name) => iconWeights(name))
    // Figma 64개 + 작업실 이름 바꾸기 연필(PencilSimple, -416) + 상담 보내기(PaperPlaneTilt 2굵기) + 3D 조작 안내 3개(회전·확대·이동, 2026-10-30)
    expect(combos).toHaveLength(70)
  })

  it('label이 없으면 장식으로 보고 스크린 리더에서 숨긴다', () => {
    const { container } = render(<Icon name="Check" />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('label이 있으면 이미지로 읽힌다', () => {
    render(<Icon name="Bell" label="알림" />)
    expect(screen.getByRole('img', { name: '알림' })).toBeInTheDocument()
  })

  it('크기를 지정한다 (기본 24)', () => {
    const { container, rerender } = render(<Icon name="X" />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '24')
    rerender(<Icon name="X" size={19} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '19')
  })
})
