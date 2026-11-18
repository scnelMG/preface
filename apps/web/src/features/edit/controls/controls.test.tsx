import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ControlRail } from './ControlRail'
import { RulerFader } from './RulerFader'
import { Segmented } from './Segmented'

it('눈금자 슬라이더는 읽기 이름·화면 값을 갖고, 두 번 누르면 기본값으로 돌아가 저장한다', async () => {
  const onCommit = vi.fn()
  function Fader() {
    const [value, setValue] = useState(0.4)
    return (
      <RulerFader
        label="높이"
        ariaLabel="콧대 높이"
        value={value}
        min={-1}
        max={1}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={setValue}
      />
    )
  }
  // 바깥 저장 규칙과 같이 native change를 듣는다(CommitOnRelease)
  const listener = (event: Event) =>
    event.target instanceof HTMLInputElement && event.target.type === 'range' && onCommit()
  document.addEventListener('change', listener)
  render(<Fader />)
  const slider = screen.getByRole('slider', { name: '콧대 높이' })
  expect(slider).toHaveAttribute('aria-valuetext', '40%')
  fireEvent.doubleClick(slider)
  expect(slider).toHaveValue('0')
  expect(slider).toHaveAttribute('aria-valuetext', '0%')
  // 기본값 복귀 뒤 다음 프레임에 저장(change) 신호를 보낸다
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  expect(onCommit).toHaveBeenCalled()
  document.removeEventListener('change', listener)
})

it('레일은 tablist이고 막힌 칸은 aria-disabled + 예정이며 누르면 바꾸지 않고 알린다', () => {
  const onChange = vi.fn()
  const onBlocked = vi.fn()
  render(
    <ControlRail
      label="부위"
      value="NOSE"
      onChange={onChange}
      onBlocked={onBlocked}
      items={[
        { value: 'NOSE', label: '코' },
        { value: 'HAIR', label: '헤어', disabled: true, note: '예정' },
      ]}
    />,
  )
  expect(screen.getByRole('tablist', { name: '부위' })).toBeInTheDocument()
  const hair = screen.getByRole('tab', { name: /헤어/ })
  expect(hair).toHaveAttribute('aria-disabled', 'true')
  expect(hair).toHaveTextContent('예정')
  fireEvent.click(hair)
  expect(onChange).not.toHaveBeenCalled()
  expect(onBlocked).toHaveBeenCalledWith(expect.objectContaining({ value: 'HAIR' }))
  expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
})

it('고르기 줄은 radiogroup이고 막힌 칸은 고를 수 없다', () => {
  const onChange = vi.fn()
  render(
    <Segmented
      label="쌍꺼풀 모양"
      value="none"
      onChange={onChange}
      options={[
        { value: 'none', label: '없음' },
        { value: 'inline', label: '인라인' },
        { value: 'outline', label: '아웃라인', disabled: true },
      ]}
    />,
  )
  expect(screen.getByRole('radiogroup', { name: '쌍꺼풀 모양' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '없음' })).toBeChecked()
  expect(screen.getByRole('radio', { name: '아웃라인' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: '인라인' }))
  expect(onChange).toHaveBeenCalledWith('inline')
})
