import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

function renderTooltip() {
  render(
    <Tooltip label="내 작업실">
      {(id) => (
        <a href="/studio" aria-label="내 작업실" aria-describedby={id}>
          폴더
        </a>
      )}
    </Tooltip>,
  )
  return screen.getByRole('link', { name: '내 작업실' })
}

/** 마우스로 누른 초점처럼 :focus-visible이 아니게 만든다(jsdom은 :focus-visible을 :focus처럼 본다) */
function notFocusVisible() {
  const original = Element.prototype.matches
  return vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ':focus-visible' ? false : original.call(this, selector)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('Tooltip', () => {
  it('마우스로 눌러 생긴 초점(:focus-visible 아님)으로는 열지 않는다', () => {
    notFocusVisible()
    const link = renderTooltip()
    fireEvent.pointerDown(link, { pointerType: 'mouse' })
    act(() => link.focus())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(link).not.toHaveAttribute('aria-describedby')
  })

  it('다른 창에 갔다 돌아와 초점이 다시 와도(마우스 초점) 열지 않는다', () => {
    notFocusVisible()
    const link = renderTooltip()
    act(() => link.focus())
    act(() => link.blur())
    act(() => link.focus())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('키보드 초점(:focus-visible)이면 열고 blur·Escape로 닫는다', () => {
    const link = renderTooltip()
    act(() => link.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('내 작업실')
    expect(link).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
    act(() => link.blur())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => link.focus())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it(':focus-visible을 모르는 환경이면 예전처럼 초점으로 연다', () => {
    const original = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (selector === ':focus-visible') throw new SyntaxError('unsupported')
      return original.call(this, selector)
    })
    const link = renderTooltip()
    act(() => link.focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('마우스를 올리면 초점과 상관없이 열고, 내리거나 누르면 닫는다', () => {
    notFocusVisible()
    const link = renderTooltip()
    const wrapper = link.parentElement as HTMLElement
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(wrapper, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    fireEvent.pointerEnter(wrapper, { pointerType: 'mouse' })
    fireEvent.pointerDown(link, { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('터치로 닿으면 열지 않는다', () => {
    const link = renderTooltip()
    fireEvent.pointerEnter(link.parentElement as HTMLElement, { pointerType: 'touch' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
