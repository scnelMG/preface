import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Tab, TabList } from './Tab'

function Tabs({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <TabList variant="count" value={value} onChange={setValue} aria-label="부위">
      <Tab value="a" count={5}>
        얼굴
      </Tab>
      <Tab value="b">눈</Tab>
      <Tab value="c">코</Tab>
    </TabList>
  )
}

describe('Tab', () => {
  it('선택된 탭만 aria-selected이고 Tab 키로 들어갈 수 있다', () => {
    render(<Tabs />)
    const [a, b] = screen.getAllByRole('tab')
    expect(a).toHaveAttribute('aria-selected', 'true')
    expect(a).toHaveAttribute('tabindex', '0')
    expect(b).toHaveAttribute('aria-selected', 'false')
    expect(b).toHaveAttribute('tabindex', '-1')
  })

  it('누르면 선택이 바뀐다', async () => {
    render(<Tabs />)
    await userEvent.click(screen.getByRole('tab', { name: '코' }))
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
  })

  it('화살표·Home·End로 옮기며 선택한다 (끝에서 처음으로 돈다)', async () => {
    render(<Tabs />)
    screen.getByRole('tab', { name: /얼굴/ }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '눈' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: '눈' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /얼굴/ })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
  })

  it('TabList 밖에서 쓰면 바로 알린다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Tab value="x">x</Tab>)).toThrow(/TabList 안에서만/)
  })
})
