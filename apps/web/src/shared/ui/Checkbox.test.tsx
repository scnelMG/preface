import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('글자를 눌러도 체크된다 (행 전체가 터치 영역)', async () => {
    render(<Checkbox>약관 동의</Checkbox>)
    const box = screen.getByRole('checkbox', { name: '약관 동의' })
    expect(box).not.toBeChecked()

    await userEvent.click(screen.getByText('약관 동의'))
    expect(box).toBeChecked()
  })

  it('키보드 Space로 바뀐다', async () => {
    render(<Checkbox>얼굴 데이터</Checkbox>)
    const box = screen.getByRole('checkbox', { name: '얼굴 데이터' })
    box.focus()
    await userEvent.keyboard(' ')
    expect(box).toBeChecked()
  })

  it('disabled면 바뀌지 않는다', async () => {
    render(<Checkbox disabled>비활성</Checkbox>)
    const box = screen.getByRole('checkbox', { name: '비활성' })
    await userEvent.click(screen.getByText('비활성'))
    expect(box).not.toBeChecked()
  })
})
