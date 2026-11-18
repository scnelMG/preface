import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIGHTING } from '@/features/viewer/lighting'
import { LightingControl } from './lighting-control'

describe('조명 조작', () => {
  it('위치 패드를 키보드로 조절하고 세기는 유지한다', () => {
    const onChange = vi.fn()
    render(<LightingControl value={DEFAULT_LIGHTING} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /조명 위치/ }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_LIGHTING, azimuth: -25 })
  })
  it('밝기 슬라이더를 제공하지 않는다', () => {
    render(<LightingControl value={DEFAULT_LIGHTING} onChange={vi.fn()} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })
})
