import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { IPHONE_GENERATIONS } from '../device'
import { IphoneModelSheet } from './IphoneModelSheet'

describe('아이폰 기종 고르기 시트(-635, -756 세대별)', () => {
  it('세대별 큰 행 목록으로 보이고 맨 아래는 모름이다', () => {
    render(<IphoneModelSheet open value={null} onConfirm={() => {}} onClose={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: '아이폰 기종' })
    const radios = screen.getAllByRole('radio')
    expect(group).toBeInTheDocument()
    expect(radios).toHaveLength(IPHONE_GENERATIONS.length + 1)
    expect(radios).toHaveLength(9)
    expect(radios[0]).toHaveAccessibleName('iPhone 18')
    expect(radios.at(-1)).toHaveAccessibleName('모름')
    expect(radios.at(-1)).toBeChecked()
  })

  it('줄 아래 작은 글씨로 그 세대 기종을 보여 준다(Air는 17 줄)', () => {
    render(<IphoneModelSheet open value={null} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: 'iPhone 17' })).toHaveAccessibleDescription(
      '17 · 17 Pro · 17 Pro Max · Air',
    )
    expect(screen.getByRole('radio', { name: 'iPhone 17e' })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it('고른 세대의 대표 기종 이름으로 확인을 알린다', async () => {
    const onConfirm = vi.fn()
    render(<IphoneModelSheet open value={null} onConfirm={onConfirm} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: 'iPhone 18' }))
    await userEvent.click(screen.getByRole('button', { name: '이 기종으로 촬영하기' }))
    expect(onConfirm).toHaveBeenCalledWith('iPhone 18 Pro')
  })

  it('이미 고른 기종이 있으면 그 세대 줄이 선택된 채 열리고, 모름은 null로 알린다', async () => {
    const onConfirm = vi.fn()
    render(<IphoneModelSheet open value="iPhone Air" onConfirm={onConfirm} onClose={() => {}} />)
    expect(screen.getByRole('radio', { name: 'iPhone 17' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: '모름' }))
    await userEvent.click(screen.getByRole('button', { name: '이 기종으로 촬영하기' }))
    expect(onConfirm).toHaveBeenCalledWith(null)
  })

  it('닫혀 있으면 아무것도 보이지 않는다', () => {
    render(<IphoneModelSheet open={false} value={null} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })
})
