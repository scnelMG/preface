import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, type ButtonProps } from './Button'

describe('Button', () => {
  it('기본은 type="button"이라 폼 안에서 실수로 제출하지 않는다', () => {
    render(<Button variant="ink">로그인</Button>)
    expect(screen.getByRole('button', { name: '로그인' })).toHaveAttribute('type', 'button')
  })

  it('Figma variant의 기본 아이콘을 붙이고, null이면 뺀다', () => {
    const { container, rerender } = render(<Button variant="ink">다음</Button>)
    expect(container.querySelectorAll('svg')).toHaveLength(1)

    rerender(
      <Button variant="ink" trailingIcon={null}>
        다음
      </Button>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('quiet/spread는 앞뒤 아이콘이 둘이다', () => {
    const { container } = render(
      <Button variant="quiet" layout="spread">
        나의 모델 추가하기
      </Button>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it('아이콘만 있는 버튼은 aria-label이 이름이 된다', () => {
    render(<Button variant="icon" aria-label="닫기" />)
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
  })

  it('href를 주면 링크로 그린다', () => {
    render(
      <Button variant="primary" href="/lab">
        체험하기
      </Button>,
    )
    expect(screen.getByRole('link', { name: '체험하기' })).toHaveAttribute('href', '/lab')
  })

  it('disabled면 누를 수 없다', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="secondary" disabled onClick={onClick}>
        확인했어요
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: '확인했어요' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('Figma에 없는 조합은 바로 알린다', () => {
    // 타입으로 막히지만, 형변환으로 우회해도 런타임에서 잡는다
    const bad = { variant: 'violet', layout: 'inline', children: 'x' } as unknown as ButtonProps
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Button {...bad} />)).toThrow(/Figma v3\/Button에 없는 조합/)
  })
})
