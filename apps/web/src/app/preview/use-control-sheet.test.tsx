import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useControlSheet } from './use-control-sheet'

function Sheet() {
  const { sheetRef } = useControlSheet({ peekSelector: '.first' })
  return (
    <aside ref={sheetRef} data-testid="sheet">
      <div className="first" />
    </aside>
  )
}

/** 손잡이를 눌러(끌지 않고 놓아) 펼치는 시트. 무대는 시트의 형제다 */
function Lab({ reveal }: { reveal?: 'stage' | 'none' }) {
  const { sheetRef, open, handleProps } = useControlSheet({
    peekSelector: '.first',
    stageSelector: '.stage',
    mobileQuery: '(max-width: 767px)',
    reveal,
  })
  return (
    <div>
      <div className="stage" data-testid="stage" />
      <aside ref={sheetRef} data-sheet={open ? 'open' : 'closed'}>
        <button type="button" data-testid="handle" {...handleProps} />
        <div className="first" />
      </aside>
    </div>
  )
}

function mockViewport(mobile: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? mobile : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function tapHandle(handle: HTMLElement) {
  // jsdom에는 포인터 잡기가 없다
  handle.setPointerCapture = vi.fn()
  act(() => {
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 500, pointerId: 1 }),
    )
    handle.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientY: 500, pointerId: 1 }),
    )
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useControlSheet', () => {
  it('접힘 높이와 접혀서 내려간 길이를 CSS 변수로 남긴다', () => {
    // 시트 540px, 첫 조절은 시트 위에서 180px까지 → 접힘 194px(여백 14), 내려간 길이 346px
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(540)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const bottom = this.classList.contains('first') ? 280 : 640
      const top = this.classList.contains('first') ? 260 : 100
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect
    })
    const { getByTestId } = render(<Sheet />)
    const sheet = getByTestId('sheet')
    expect(sheet.style.getPropertyValue('--pp-sheet-peek')).toBe('194px')
    expect(sheet.style.getPropertyValue('--pp-sheet-collapse')).toBe('346px')
  })

  it('peekGap 0이면 고른 요소 바닥까지만 남긴다', () => {
    function Handle() {
      const { sheetRef } = useControlSheet({ peekSelector: '.handle', peekGap: 0 })
      return (
        <aside ref={sheetRef} data-testid="sheet">
          <button type="button" className="handle" />
        </aside>
      )
    }
    // 시트 388px, 손잡이는 시트 위에서 32px까지 → 접힘 32px, 내려간 길이 356px
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(388)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const handle = this.classList.contains('handle')
      return { top: 100, bottom: handle ? 132 : 488 } as DOMRect
    })
    const { getByTestId } = render(<Handle />)
    const sheet = getByTestId('sheet')
    expect(sheet.style.getPropertyValue('--pp-sheet-peek')).toBe('32px')
    expect(sheet.style.getPropertyValue('--pp-sheet-collapse')).toBe('356px')
  })

  it('안쪽 스크롤 영역을 넘긴 만큼 되돌려 재고, 형제(무대)가 읽게 부모에도 남긴다 (-573)', () => {
    function Scrolled() {
      const { sheetRef } = useControlSheet({ peekSelector: '.first' })
      return (
        <div data-testid="body">
          <aside ref={sheetRef} data-testid="sheet">
            <div data-sheet-scroll data-testid="scroll">
              <div className="first" />
            </div>
          </aside>
        </div>
      )
    }
    // 시트 540px. 스크롤 영역을 40px 넘겨 첫 조절이 시트 위에서 140px까지로 올라가 있다 → 접힘 140 + 40 + 14 = 194px
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(540)
    vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-sheet-scroll') ? 40 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { top: 100, bottom: this.classList.contains('first') ? 240 : 640 } as DOMRect
    })
    const { getByTestId } = render(<Scrolled />)
    expect(getByTestId('sheet').style.getPropertyValue('--pp-sheet-peek')).toBe('194px')
    expect(getByTestId('body').style.getPropertyValue('--pp-sheet-peek')).toBe('194px')
    expect(getByTestId('body').style.getPropertyValue('--pp-sheet-collapse')).toBe('346px')
  })

  it('첫 조절이 늦게 그려지면 그때 재고, 잰 뒤에는 내용(부위·방식)이 바뀌어도 높이를 지킨다 (-573)', async () => {
    function Late({ items }: { items: number[] }) {
      const { sheetRef } = useControlSheet({ peekSelector: '.first' })
      return (
        <aside ref={sheetRef} data-testid="sheet">
          {items.map((n) => (
            <div key={n} className="first" data-bottom={n} />
          ))}
        </aside>
      )
    }
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(540)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const bottom = Number(this.dataset.bottom ?? 640)
      return { top: 100, bottom } as DOMRect
    })
    const { getByTestId, rerender } = render(<Late items={[]} />)
    const sheet = getByTestId('sheet')
    expect(sheet.style.getPropertyValue('--pp-sheet-peek')).toBe('')

    rerender(<Late items={[280]} />)
    await act(async () => {})
    expect(sheet.style.getPropertyValue('--pp-sheet-peek')).toBe('194px')

    // 다른 부위로 바꿔 첫 조절 위치가 달라져도 그대로다
    rerender(<Late items={[400]} />)
    await act(async () => {})
    expect(sheet.style.getPropertyValue('--pp-sheet-peek')).toBe('194px')
  })

  it('기본은 펼칠 때 3D 무대를 화면 맨 위로 올린다', () => {
    mockViewport(true)
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const { getByTestId } = render(<Lab />)
    tapHandle(getByTestId('handle'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(getByTestId('stage'))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('none이면 펼쳐도 접어도 페이지를 움직이지 않는다', () => {
    mockViewport(true)
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(250)
    const { getByTestId } = render(<Lab reveal="none" />)
    const handle = getByTestId('handle')
    tapHandle(handle)
    expect(handle.parentElement?.dataset.sheet).toBe('open')
    tapHandle(handle)
    expect(handle.parentElement?.dataset.sheet).toBe('closed')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('데스크톱에서는 손잡이를 눌러도 페이지를 움직이지 않는다', () => {
    mockViewport(false)
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)
    const { getByTestId } = render(<Lab />)
    tapHandle(getByTestId('handle'))
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
