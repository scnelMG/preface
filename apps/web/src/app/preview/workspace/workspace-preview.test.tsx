import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspacePreview } from './workspace-preview'
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('./carousel-scene-loader', () => ({
  DraftThumbnail: () => null,
  CarouselScene: () => null,
}))
vi.mock('./use-local-models', () => ({
  useLocalModels: () => ({ models: [], loaded: true }),
  workspaceLocalModel: () => null,
}))
vi.mock('../preview-login', () => ({ PreviewLogin: () => null }))
vi.mock('@/features/viewer/FaceViewerLoader', () => ({
  FaceViewer: ({ rotationOnly }: { rotationOnly?: boolean }) => (
    <div data-testid="shared-viewer" data-rotation-only={rotationOnly} />
  ),
}))
beforeEach(() => {
  push.mockClear()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())
describe('캐러셀과 하단 모델 미리보기', () => {
  it('모델 선택은 회전만 허용하고 위치 표시에는 이름을 넣지 않는다', () => {
    render(<WorkspacePreview />)
    expect(screen.getByTestId('shared-viewer')).toHaveAttribute('data-rotation-only', 'true')
    expect(screen.getByRole('region', { name: '모델 선택 위치' })).not.toHaveTextContent(
      '여성 기본 모델',
    )
  })
  it('호버로는 선택이 바뀌지 않고 클릭하면 바뀐다', () => {
    render(<WorkspacePreview />)
    const male = screen.getByRole('button', { name: '남성 기본 모델 선택' })
    fireEvent.mouseEnter(male)
    expect(screen.getByRole('heading', { name: '여성 기본 모델' })).toBeInTheDocument()
    fireEvent.click(male)
    expect(screen.getByRole('heading', { name: '남성 기본 모델' })).toBeInTheDocument()
  })
  it('화살표 클릭만으로 순환 선택한다', () => {
    render(<WorkspacePreview />)
    fireEvent.click(screen.getByRole('button', { name: '다음 모델' }))
    expect(screen.getByRole('heading', { name: '남성 기본 모델' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 모델' }))
    expect(screen.getByRole('heading', { name: '여성 기본 모델' })).toBeInTheDocument()
  })
  it('시안에 저장 날짜를 제공한다', () => {
    render(<WorkspacePreview />)
    expect(screen.getByText('2026.10.29 저장')).toHaveAttribute('dateTime', '2026-10-29')
  })
  it('검색과 전체 목록을 제공하지 않고 모델을 직접 선택한다', () => {
    render(<WorkspacePreview />)
    expect(screen.getByRole('region', { name: '모델 선택 위치' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 목록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '연습용 모델 선택' }))
    expect(screen.getByRole('heading', { name: '연습용 모델' })).toBeInTheDocument()
  })
  it('방향키는 선택과 초점을 함께 옮기고 끝에서 순환한다', () => {
    render(<WorkspacePreview />)
    fireEvent.keyDown(screen.getByRole('button', { name: '여성 기본 모델 선택' }), {
      key: 'ArrowLeft',
    })
    const last = screen.getByRole('button', { name: '연습용 모델 선택' })
    expect(last).toHaveAttribute('aria-pressed', 'true')
    expect(last).toHaveFocus()
    fireEvent.keyDown(last, { key: 'ArrowRight' })
    expect(screen.getByRole('button', { name: '여성 기본 모델 선택' })).toHaveFocus()
  })
  it('선택한 모델에 맞게 시안과 이어서 편집 대상을 바꾼다', () => {
    render(<WorkspacePreview />)
    expect(screen.getByRole('link', { name: /코끝 시안/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '남성 기본 모델 선택' }))
    expect(screen.queryByRole('link', { name: /코끝 시안/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '이어서 편집' })).toHaveAttribute(
      'href',
      '/preview/editor?member=1&source=workspace&sample=base-male',
    )
  })
  it('End로 마지막 모델을 고른 뒤 Enter로 편집한다', () => {
    render(<WorkspacePreview />)
    fireEvent.keyDown(screen.getByRole('button', { name: '여성 기본 모델 선택' }), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('button', { name: '연습용 모델 선택' }), { key: 'Enter' })
    expect(push).toHaveBeenCalledWith(
      '/preview/editor?member=1&source=workspace&sample=base-female&variant=tip',
    )
  })
})
