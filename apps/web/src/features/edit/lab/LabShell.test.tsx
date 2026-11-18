import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Inspector } from './Inspector'
import { LabShell, LabToolbar } from './LabShell'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}))

function mockViewport(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? phone : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function renderLab() {
  return render(
    <LabShell
      toolbar={<div />}
      stage={<div data-testid="face" />}
      inspector={<button type="button">코 높이</button>}
    />,
  )
}

/** 손잡이를 끌지 않고 눌렀다 뗀다(jsdom에는 포인터 잡기가 없다) */
function tap(handle: HTMLElement) {
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
  vi.unstubAllGlobals()
})

describe('LabShell 휴대폰 아래 시트', () => {
  it('접혀 있어도 첫 조절까지 올라와 있어 바로 만진다. 손잡이에 `조절 열기` 글자는 없다 (-573)', () => {
    mockViewport(true)
    renderLab()
    const handle = screen.getByRole('button', { name: '조절 열기' })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(handle).toHaveAttribute('aria-controls', 'pf-lab-controls')
    expect(handle).not.toHaveTextContent('조절 열기')
    expect(document.getElementById('pf-lab-controls')).toHaveAttribute('data-sheet', 'closed')
    // 접힌 채로도 조절에 닿는다(체험하기와 같다)
    expect(screen.getByText('코 높이').closest('[inert]')).toBeNull()
  })

  it('손잡이를 누르면 다시 펼쳐지고 조절에 닿는다', () => {
    mockViewport(true)
    renderLab()
    tap(screen.getByRole('button', { name: '조절 열기' }))
    const handle = screen.getByRole('button', { name: '조절 접기' })
    expect(handle).toHaveAttribute('aria-expanded', 'true')
    expect(handle).not.toHaveTextContent('조절 열기')
    expect(screen.getByText('코 높이').closest('[inert]')).toBeNull()
    tap(handle)
    expect(screen.getByRole('button', { name: '조절 열기' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('키보드(Enter)로도 열고, Escape로 접어도 조절의 포커스는 그대로다', () => {
    mockViewport(true)
    renderLab()
    fireEvent.click(screen.getByRole('button', { name: '조절 열기' }), { detail: 0 })
    expect(screen.getByRole('button', { name: '조절 접기' })).toBeInTheDocument()
    const control = screen.getByText('코 높이')
    control.focus()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(screen.getByRole('button', { name: '조절 열기' })).toBeInTheDocument()
    expect(control).toHaveFocus()
  })

  it('데스크톱에서는 조절을 막지 않는다', () => {
    mockViewport(false)
    renderLab()
    expect(screen.getByText('코 높이').closest('[inert]')).toBeNull()
  })

  it('expandSheet(원본 사진 탭, S15P31B204-770)이면 휴대폰 시트를 펼친다', () => {
    mockViewport(true)
    const inspector = <button type="button">코 높이</button>
    const { rerender } = render(
      <LabShell toolbar={<div />} stage={<div />} inspector={inspector} />,
    )
    expect(screen.getByRole('button', { name: '조절 열기' })).toBeInTheDocument()

    rerender(<LabShell toolbar={<div />} stage={<div />} inspector={inspector} expandSheet />)
    expect(screen.getByRole('button', { name: '조절 접기' })).toBeInTheDocument()
  })

  it('원본 사진 탭은 상담과 같은 고정 높이 규칙을 쓴다(service.css)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/layout/service.css'), 'utf8')
    expect(css).toContain(".pf-lab-inspector:has(> [role='tabpanel'][data-mode='photo'])")
    expect(css).not.toContain('.pf-front-photo')
  })

  it('조절 탭에 지금 방식(data-mode)과 넘기는 영역 표시(data-sheet-scroll)를 남긴다', () => {
    render(
      <Inspector modes={['manual', 'consult']} mode="consult" onModeChange={() => {}}>
        <p>상담</p>
      </Inspector>,
    )
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-mode', 'consult')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-sheet-scroll')
  })
})

describe('LabShell PC 카드 높이(-602, -748)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderWithMode(mode: 'manual' | 'consult') {
    return (
      <LabShell
        toolbar={<div />}
        stage={<div />}
        inspector={
          <Inspector modes={['manual', 'consult']} mode={mode} onModeChange={() => {}}>
            <p>{mode === 'manual' ? '조절' : '대화'}</p>
          </Inspector>
        }
      />
    )
  }

  it('직접 조절에서 보던 부위의 카드 높이를 재어 상담에 넘기지 않는다(-748: 부위마다 상담 높이가 바뀌었다)', () => {
    mockViewport(false)
    let height = 540
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ height, top: 0 }) as DOMRect,
    )
    const { rerender } = render(renderWithMode('manual'))
    const card = screen.getByRole('complementary', { name: '변화 만들기' })
    height = 820
    rerender(renderWithMode('consult'))
    expect(card.style.getPropertyValue('--pf-lab-manual-h')).toBe('')
    expect(card.style.getPropertyValue('--pf-lab-consult-h')).toBe('')
  })

  it('PC 상담 카드는 코 탭 카드 높이로 고정한 값(--pf-lab-consult-h)을 쓴다(-748)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/layout/service.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const desktop = css.slice(css.indexOf('@media (min-width: 1060px) {\n  .pf-lab-inspector {'))
    expect(desktop).toMatch(
      /^@media \(min-width: 1060px\) \{\n {2}\.pf-lab-inspector \{\n {4}--pf-lab-consult-h: \d+px;/,
    )
    expect(desktop).toMatch(
      /\.pf-lab-inspector:has\(> \[role='tabpanel'\]\[data-mode='consult'\]\),\s*\.pf-lab-inspector:has\(> \[role='tabpanel'\]\[data-mode='photo'\]\) \{\s*height: var\(--pf-lab-consult-h\);/,
    )
    expect(css).not.toContain('--pf-lab-manual-h')
  })

  it('PC 편집 영역은 높이를 고정해, 긴 부위 탭에서도 카드 상한이 걸리고 3D 무대가 늘어나지 않는다(-789)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/layout/service.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    // 높이는 내용이 아니라 화면으로 정한다. 720px 아래로는 줄지 않는다(화면이 높으면 키운다, S15P31B204-838)
    expect(css).toMatch(
      /@media \(min-width: 1060px\) \{\n {2}\.pf-lab-shell \{\n {4}height: clamp\(720px, calc\(100svh - \d+px\), \d+px\);/,
    )
    // 카드 상한의 100%는 이 고정 높이(편집 영역)를 기준으로 한다
    expect(css).toMatch(/max-height: min\(100%, var\(--pf-lab-viewport-max-h\)\);/)
  })

  it('PC 도구 줄은 오른쪽 묶음·뒤로를 제목 줄(40px) 가운데에 맞추고 모델 이름은 그 아래에 둔다(S15P31B204-838)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/layout/service.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(css).toMatch(/\.pf-lab-toolbar \{\n {4}align-items: flex-start;/)
    expect(css).toMatch(/\.pf-lab-toolbar-title \{\n {4}min-height: 40px;/)
    expect(css).toMatch(
      /\.pf-lab-toolbar-status,\n {2}\.pf-lab-toolbar-actions \{\n {4}display: flex;\n {4}align-items: center;\n {4}height: 40px;/,
    )
    render(
      <LabToolbar
        backHref="/studio"
        backLabel="내 작업실"
        title="시안"
        subtitle="모델"
        status="자동 저장됨"
        actions={<button>완료</button>}
      />,
    )
    expect(screen.getByText('시안').parentElement).toHaveClass('pf-lab-toolbar-title')
    expect(screen.getByText('모델')).toHaveClass('pf-lab-toolbar-subtitle')
    expect(screen.getByText('자동 저장됨')).toHaveClass('pf-lab-toolbar-status')
    expect(screen.getByRole('button', { name: '완료' }).parentElement).toHaveClass(
      'pf-lab-toolbar-actions',
    )
  })

  it('태블릿 상담 카드는 화면 높이를 넘지 않아 대화가 늘어도 입력창이 밀리지 않는다', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/layout/service.css'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const start = css.indexOf('@media (min-width: 768px) and (max-width: 1059px) {')
    expect(start).toBeGreaterThan(-1)
    const tablet = css.slice(start, css.indexOf('\n}\n', start))
    expect(tablet).toMatch(
      /\.pf-lab-inspector:has\(> \[role='tabpanel'\]\[data-mode='consult'\]\) \{\s*height: min\(var\(--pf-lab-compact-card-h\), calc\(100svh - 32px\)\);\s*\}/,
    )
  })
})
