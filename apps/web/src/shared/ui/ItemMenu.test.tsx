import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ItemMenu } from './ItemMenu'

describe('ItemMenu(⋮)', () => {
  it('열면 첫 항목에 초점, Escape로 닫고 버튼으로 초점을 돌려준다', async () => {
    const user = userEvent.setup()
    render(
      <ItemMenu label="내 모델 메뉴" actions={[{ label: '이름 바꾸기', onSelect: vi.fn() }]} />,
    )
    const trigger = screen.getByRole('button', { name: '내 모델 메뉴' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('항목을 고르면 메뉴를 닫고 그 행동을 부른다(삭제는 위험 표시)', async () => {
    const user = userEvent.setup()
    const remove = vi.fn()
    render(
      <ItemMenu
        label="시안 메뉴"
        actions={[
          { label: '이름 바꾸기', onSelect: vi.fn() },
          { label: '삭제', danger: true, onSelect: remove },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: '시안 메뉴' }))
    await user.keyboard('{ArrowDown}')
    const item = screen.getByRole('menuitem', { name: '삭제' })
    expect(item).toHaveFocus()
    expect(item).toHaveAttribute('data-danger')
    await user.click(item)
    expect(remove).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
