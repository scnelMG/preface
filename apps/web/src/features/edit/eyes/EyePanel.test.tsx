import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
import { EyePanel } from './EyePanel'
import { newEyeState, changeEyes, type EyeLimits, type EyeReview } from './state'
function Panel({
  review = { L: 'absent', R: 'absent' },
  commit = () => {},
  limits,
}: {
  review?: EyeReview
  commit?: () => void
  limits?: EyeLimits
}) {
  const [state, setState] = useState(() =>
    changeEyes(newEyeState(), 'both', { type: 'style', style: 'inout' }),
  )
  return (
    <EyePanel
      state={state}
      selection="both"
      review={review}
      limits={limits}
      onPreview={setState}
      onCommit={commit}
    />
  )
}
it('코처럼 쌍꺼풀·트임 묶음을 쌓고 쌍꺼풀은 높이만(깊이는 기본값 고정), 트임은 방향마다 한 줄이다', () => {
  render(<Panel />)
  expect(screen.getByRole('region', { name: '쌍꺼풀' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '트임' })).toBeInTheDocument()
  expect(screen.queryByRole('tab')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getAllByRole('slider').map((el) => el.getAttribute('aria-label'))).toEqual([
    '높이',
    '앞트임',
    '뒤트임',
    '윗트임',
    '밑트임',
  ])
  fireEvent.change(screen.getByRole('slider', { name: '높이' }), { target: { value: '40' } })
  fireEvent.change(screen.getByRole('slider', { name: '윗트임' }), {
    target: { value: '25' },
  })
  expect(screen.getByRole('radio', { name: '인아웃' })).toBeChecked()
  expect(screen.getByRole('slider', { name: '높이' })).toHaveValue('40')
  expect(screen.getByRole('slider', { name: '윗트임' })).toHaveValue('25')
})
it('기존 쌍꺼풀과 미확인 모델에는 새 라인을 생성하지 않고 트임은 연다', () => {
  render(<Panel review={{ L: 'present', R: 'unknown' }} />)
  expect(screen.getByRole('radio', { name: '인라인' })).toBeDisabled()
  expect(screen.queryByRole('slider', { name: '높이' })).toBeNull()
  expect(screen.getByRole('slider', { name: '앞트임' })).toBeEnabled()
})
it('승인 한계가 0인 쌍꺼풀 모양은 선택할 수 없다', () => {
  render(<Panel limits={{ 'inline:height': 0, 'inout:height': 30, 'outline:height': 0 }} />)
  expect(screen.getByRole('radio', { name: '인라인' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: '인아웃' })).toBeEnabled()
  expect(screen.getByRole('radio', { name: '아웃라인' })).toBeDisabled()
})
it('슬라이더 미리보기는 이력을 만들지 않고 조작 종료에만 commit한다', () => {
  const commit = vi.fn()
  render(<Panel commit={commit} />)
  const slider = screen.getByRole('slider', { name: '높이' })
  fireEvent.input(slider, { target: { value: '40' } })
  fireEvent.input(slider, { target: { value: '45' } })
  expect(commit).not.toHaveBeenCalled()
  fireEvent.change(slider)
  expect(commit).toHaveBeenCalledTimes(1)
})
it('눈 슬라이더는 코처럼 촘촘하게(0.5 단위) 움직인다(-526)', () => {
  render(<Panel limits={{ 'inout:height': 100, inner: 100, outer: 100, upper: 40, lower: 100 }} />)
  const upper = screen.getByRole('slider', { name: '윗트임' })
  expect(upper).toHaveAttribute('step', '0.5')
  expect(upper).toHaveAttribute('max', '40')
  fireEvent.change(upper, { target: { value: '12.5' } })
  expect(upper).toHaveValue('12.5')
})
