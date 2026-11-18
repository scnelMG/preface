import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { formatPercent } from './format'
import { SliderRow } from './SliderRow'

describe('formatPercent', () => {
  it('가중치 × 100을 부호와 함께 보인다 (REQ-N-18)', () => {
    expect(formatPercent(0.2)).toBe('+20%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(-0.1)).toBe('-10%')
    expect(formatPercent(0.125)).toBe('+13%')
  })
})

describe('SliderRow', () => {
  function setup(value = 0.2) {
    const onChange = vi.fn()
    render(<SliderRow label="콧대 높이" value={value} min={-0.5} max={0.5} onChange={onChange} />)
    return { onChange }
  }

  it('값을 %로 보이고 슬라이더도 같은 문구를 읽어 준다', () => {
    setup(0.2)
    expect(screen.getByText('+20%')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '콧대 높이' })).toHaveAttribute(
      'aria-valuetext',
      '+20%',
    )
  })

  it('움직이면 숫자로 onChange를 부른다', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByRole('slider', { name: '콧대 높이' }), {
      target: { value: '0.35' },
    })
    expect(onChange).toHaveBeenCalledWith(0.35)
  })

  it('항목별 되돌리기 버튼은 두지 않는다(패널의 처음으로로 모은다)', () => {
    setup()
    expect(screen.queryByRole('button', { name: '콧대 높이 되돌리기' })).not.toBeInTheDocument()
  })

  it('이름 없는 줄도 값은 이름 줄 오른쪽(양 끝 문구 사이가 아니다)', () => {
    render(
      <SliderRow label="" ariaLabel="코끝 높이" value={0} min={-1} max={1} onChange={vi.fn()} />,
    )
    const value = screen.getByText('0%')
    expect(value.parentElement).not.toHaveTextContent('작게')
    expect(value).toHaveClass('text-right')
  })

  it('양 끝 문구 기본값은 Figma 그대로다', () => {
    setup()
    expect(screen.getByText('작게')).toBeInTheDocument()
    expect(screen.getByText('크게')).toBeInTheDocument()
  })
})
