import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewStudio } from './preview-studio'

const state = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.query),
}))
vi.mock('@/features/viewer/FaceViewerLoader', () => ({ FaceViewer: () => null }))
vi.mock('./workspace/use-local-models', () => ({
  useLocalModels: () => ({ models: [], loaded: true }),
}))
vi.mock('./preview-nav', () => ({ PreviewNav: () => null }))
vi.mock('./preview-login', () => ({ PreviewLogin: () => null }))

beforeEach(() => {
  state.query = ''
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('편집실 진입 문맥', () => {
  it('로그인 여부와 관계없이 하나의 메인 문구를 제공한다', () => {
    const { unmount } = render(<PreviewStudio />)
    const title = screen.getByRole('heading', { level: 1 }).textContent
    unmount()
    state.query = 'member=1'
    render(<PreviewStudio />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title ?? '')
    expect(screen.queryByText(/사진으로 만든 3D 얼굴/)).not.toBeInTheDocument()
  })
  it('기본 체험에서는 모델 선택을 제공한다', () => {
    render(<PreviewStudio mode="editor" />)
    expect(screen.getByRole('group', { name: '기본 모델 선택' })).toBeInTheDocument()
  })
  it('작업실에서 선택한 모델은 다른 성별 모델로 교체하지 않는다', () => {
    state.query = 'source=workspace&sample=base-male'
    render(<PreviewStudio mode="editor" />)
    expect(screen.queryByRole('group', { name: '기본 모델 선택' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '남성 기본 모델' })).toBeInTheDocument()
  })
  it('조명은 카드 외부의 위치 패드만 제공하고 밝기 조절을 생략한다', () => {
    render(<PreviewStudio mode="editor" />)
    expect(screen.getByRole('button', { name: /조명 위치/ })).toBeVisible()
    expect(screen.getByRole('slider', { name: '콧대 높이' })).toBeVisible()
    expect(screen.queryByRole('slider', { name: '밝기' })).not.toBeInTheDocument()
  })
})
