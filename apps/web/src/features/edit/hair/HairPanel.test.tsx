import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HairPanel } from './HairPanel'
import { HAIR_NONE } from './catalog'

describe('HairPanel', () => {
  it('헤어를 썸네일 카드로 보여 주고 없음 칸은 없다', () => {
    render(<HairPanel value={HAIR_NONE} onChange={() => {}} />)
    const group = screen.getByRole('group', { name: '헤어 스타일' })
    const card = screen.getByRole('button', { name: '리프컷' })
    expect(group).toContainElement(card)
    expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/\/hair\/male-leaf\.webp$/),
    )
    expect(screen.queryByRole('button', { name: '없음' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('카드를 누르면 씌우고, 고른 카드를 다시 누르면 벗긴다', () => {
    const onChange = vi.fn()
    const { rerender } = render(<HairPanel value={HAIR_NONE} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '리프컷' }))
    expect(onChange).toHaveBeenLastCalledWith('male-leaf')

    rerender(<HairPanel value="male-leaf" onChange={onChange} />)
    expect(screen.getByRole('button', { name: '리프컷' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '리프컷' }))
    expect(onChange).toHaveBeenLastCalledWith(HAIR_NONE)
  })

  it('파일이 없는 남자 머리는 목록에 없고 준비 중 문구도 없다', () => {
    render(<HairPanel value={HAIR_NONE} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: '남자 머리' })).not.toBeInTheDocument()
    expect(screen.queryByText(/준비 중/)).not.toBeInTheDocument()
  })

  it('모델을 못 불러오면 카드를 막는다', () => {
    render(<HairPanel value={HAIR_NONE} onChange={() => {}} disabled />)
    expect(screen.getByRole('button', { name: '리프컷' })).toBeDisabled()
  })

  it('불러오는 중과 씌운 뒤 안내가 다르다', () => {
    const { rerender } = render(<HairPanel value="male-leaf" onChange={() => {}} loading />)
    expect(screen.getByRole('status')).toHaveTextContent('헤어를 불러오는 중이에요.')
    rerender(<HairPanel value="male-leaf" onChange={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('평균 머리 모양에 맞춘 헤어')
  })

  it('compact면 세 칸 작은 카드로 그린다(메인 체험, S15P31B204-770)', () => {
    const { rerender } = render(<HairPanel value={HAIR_NONE} onChange={() => {}} />)
    expect(screen.getByRole('group', { name: '헤어 스타일' })).not.toHaveAttribute('data-density')
    rerender(<HairPanel value={HAIR_NONE} onChange={() => {}} compact />)
    expect(screen.getByRole('group', { name: '헤어 스타일' })).toHaveAttribute(
      'data-density',
      'compact',
    )
  })
})
