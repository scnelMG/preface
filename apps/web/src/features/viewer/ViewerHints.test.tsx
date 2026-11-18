import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerHints } from './ViewerHints'

describe('ViewerHints', () => {
  it('마우스용 안내는 방법을 글로 보이고, 오른쪽 버튼 이동을 알린다', () => {
    render(<ViewerHints />)
    const [mouse] = screen.getAllByRole('list', { name: '3D 조작 안내' })

    expect(within(mouse).getByText('드래그 회전')).toBeInTheDocument()
    expect(within(mouse).getByText('스크롤 확대')).toBeInTheDocument()
    expect(within(mouse).getByText('오른쪽 버튼으로 끌어 이동')).toBeInTheDocument()
    // 터치 기기(pointer: coarse)에서만 숨는다
    expect(mouse).toHaveClass('pointer-coarse:hidden')
    expect(mouse).not.toHaveClass('hidden')
  })

  it('터치용 안내는 기본으로 숨고 터치 기기에서만 보인다', () => {
    render(<ViewerHints />)
    const [, touch] = screen.getAllByRole('list', { hidden: true, name: '3D 조작 안내' })

    expect(within(touch).getByText('한 손가락 회전')).toBeInTheDocument()
    expect(within(touch).getByText('두 손가락 확대·이동')).toBeInTheDocument()
    expect(touch).toHaveClass('hidden', 'pointer-coarse:flex')
  })

  it('문구를 읽기 프로그램 전용 글로 따로 두지 않는다(같은 말을 두 번 읽지 않게)', () => {
    const { container } = render(<ViewerHints />)
    expect(container.querySelector('.sr-only')).toBeNull()
  })
})
