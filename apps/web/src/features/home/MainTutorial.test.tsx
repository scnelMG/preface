import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routeFetch } from '@/features/auth/testUtils'
import { useAuthStore } from '@/features/auth/store'
import { clearVisited, markVisited } from '@/features/landing/firstVisit'
import { clearTutorialRecord, MAIN_TUTORIAL_STORAGE_KEY } from '@/features/tutorial/storage'
import { HomePage } from './HomePage'

// WebGL 대신, 테스트가 정한 때에 모델 준비를 알리고 체험 코 조절 항목을 모두 지원한다고 답한다
let ready = true
vi.mock('@/features/viewer/FaceViewerLoader', () => ({
  FaceViewer: ({
    onStatusChange,
    onSupportedCodes,
  }: {
    onStatusChange?: (status: string) => void
    onSupportedCodes?: (codes: string[]) => void
  }) => {
    useEffect(() => {
      if (!ready) return
      onSupportedCodes?.([
        'nose.bridge_height',
        'nose.tip_projection',
        'nose.tip_height',
        'nose.tip_rotation',
        'nose.alar_width',
      ])
      onStatusChange?.('ready')
    }, [onStatusChange, onSupportedCodes])
    return <div data-testid="viewer" />
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const card = () => screen.getByRole('dialog', { name: /둘러보기|부위 고르기|조절하기|되돌리기/ })
const title = () => within(card()).getByRole('heading').textContent
/** 3D 위 끌기. 캔버스를 감싼 요소가 받는다 */
function drag(canvas: Element, buttons: number) {
  fireEvent.pointerDown(canvas, {
    pointerId: 1,
    pointerType: 'mouse',
    buttons,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerMove(canvas, {
    pointerId: 1,
    pointerType: 'mouse',
    buttons,
    clientX: 40,
    clientY: 0,
  })
  fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'mouse' })
}

beforeEach(() => {
  ready = true
  markVisited()
  clearTutorialRecord(MAIN_TUTORIAL_STORAGE_KEY)
  routeFetch([])
  useAuthStore.setState({ status: 'anonymous', me: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearVisited()
  clearTutorialRecord(MAIN_TUTORIAL_STORAGE_KEY)
  localStorage.clear()
})

describe('메인 체험 튜토리얼 (REQ-F-09)', () => {
  it('모델이 준비되기 전에는 띄우지 않는다', () => {
    ready = false
    render(<HomePage />)
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })

  it('처음 쓰는 기기에는 둘러보기부터 4단계를 보이고, 마우스 조작 칩을 함께 보인다', () => {
    render(<HomePage />)
    expect(title()).toContain('4단계 중 1단계, 둘러보기')
    const chips = within(card()).getAllByRole('list', { name: '해 볼 조작' })[0]
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['끌어서 회전', '휠로 확대', '오른쪽 끌어 이동', '구를 끌어 조명'])
  })

  it('해 보면 넘어간다: 조작 네 가지 → 부위 바꾸기 → 값 바꾸기 → 되돌리기로 완료', async () => {
    const { container } = render(<HomePage />)
    const canvas = container.querySelector('.pf-main-canvas')!
    drag(canvas, 1)
    fireEvent.wheel(canvas)
    drag(canvas, 2)
    const chips = within(card()).getAllByRole('list', { name: '해 볼 조작' })[0]
    expect(chips.querySelectorAll('[data-done="true"]')).toHaveLength(3)
    // 조명 구는 방향키로도 옮겨진다
    fireEvent.keyDown(screen.getByRole('button', { name: /조명 위치/ }), { key: 'ArrowLeft' })
    await waitFor(() => expect(title()).toContain('부위 고르기'))

    await userEvent.click(screen.getByRole('tab', { name: '눈' }))
    await waitFor(() => expect(title()).toContain('조절하기'))

    await userEvent.click(screen.getByRole('tab', { name: '코' }))
    // 잡는 순간(누르기·키)이 되돌리기 한 단계가 된다
    const slider = screen.getByRole('slider', { name: '콧대 높이' })
    fireEvent.pointerDown(slider, { pointerId: 2 })
    fireEvent.change(slider, { target: { value: '0.2' } })
    await waitFor(() => expect(title()).toContain('되돌리기'), { timeout: 3000 })

    expect(screen.getByRole('button', { name: '되돌리기' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('다음으로 넘기고 마지막에 시작하기를 누르면 완료로 남긴다', async () => {
    render(<HomePage />)
    for (let i = 0; i < 3; i++)
      await userEvent.click(within(card()).getByRole('button', { name: /다음/ }))
    expect(title()).toContain('되돌리기')
    await userEvent.click(within(card()).getByRole('button', { name: '시작하기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('단계 막대를 누르면 그 단계로 앞뒤 어디든 옮기고, 마지막으로 옮겨도 완료로 남기지 않는다(-849)', async () => {
    render(<HomePage />)
    const dash = (n: number) => within(card()).getByRole('button', { name: `${n}단계로 이동` })
    expect(dash(1)).toHaveAttribute('aria-current', 'step')

    await userEvent.click(dash(3))
    expect(title()).toContain('4단계 중 3단계, 조절하기')
    expect(dash(3)).toHaveAttribute('aria-current', 'step')
    expect(dash(1)).not.toHaveAttribute('aria-current')

    await userEvent.click(dash(1))
    expect(title()).toContain('4단계 중 1단계, 둘러보기')

    // 키보드로도 옮긴다
    dash(4).focus()
    await userEvent.keyboard('{Enter}')
    expect(title()).toContain('4단계 중 4단계, 되돌리기')
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBeNull()

    await userEvent.click(within(card()).getByRole('button', { name: '시작하기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('건너뛰기·Esc는 건너뛴 것으로 남기고, 다시 와도 띄우지 않는다', async () => {
    const { unmount } = render(<HomePage />)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBe('skipped')
    unmount()
    render(<HomePage />)
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })
})

describe('휴대폰 메인 튜토리얼 (S15P31B204-746)', () => {
  beforeEach(() => {
    // 휴대폰 폭(<768)
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  it('미리 보기에서는 띄우지 않고, `체험하기`로 전체 화면을 열면 처음 단계부터 띄운다', async () => {
    const { container } = render(<HomePage />)
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
    // 미리 보기 위에서 페이지를 넘기는 손가락은 1단계 조작으로 체크하지 않는다
    const canvas = container.querySelector('.pf-main-canvas')!
    fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0 })
    fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 80 })
    fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'touch' })

    await userEvent.click(screen.getByRole('button', { name: '체험하기' }))
    await waitFor(() => expect(title()).toContain('4단계 중 1단계, 둘러보기'))
    const chips = within(card()).getAllByRole('list', { name: '해 볼 조작' })[0]
    expect(chips.querySelectorAll('[data-done="true"]')).toHaveLength(0)
    expect(localStorage.getItem(MAIN_TUTORIAL_STORAGE_KEY)).toBeNull()
  })

  it('이미 끝낸 기기는 전체 화면을 열어도 띄우지 않는다', async () => {
    localStorage.setItem(MAIN_TUTORIAL_STORAGE_KEY, 'completed')
    render(<HomePage />)
    await userEvent.click(screen.getByRole('button', { name: '체험하기' }))
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })
})
