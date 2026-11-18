import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHandoff } from '@/shared/state/handoff'
import { FaceStage } from './FaceStage'

vi.mock('./FaceViewerLoader', () => ({
  FaceViewer: ({
    pointEditEnabled,
    highlightCodes,
    layout,
    showing,
    view,
    onNoseHandlePreview,
    onNoseHandleCommit,
    hairHidden,
  }: {
    hairHidden?: boolean
    pointEditEnabled?: boolean
    highlightCodes?: readonly string[]
    layout: string
    showing: string
    view: { preset: string }
    onNoseHandlePreview?: (changes: { id: 'bridge'; value: number }[]) => void
    onNoseHandleCommit?: () => void
  }) => (
    <div
      data-testid="viewer"
      data-point-edit-enabled={String(pointEditEnabled)}
      data-highlight={highlightCodes?.join(',') ?? ''}
      data-layout={layout}
      data-showing={showing}
      data-view={view.preset}
      data-hair-hidden={String(!!hairHidden)}
    >
      {pointEditEnabled ? (
        <button
          type="button"
          aria-label="코 구조 손잡이"
          onPointerMove={() => onNoseHandlePreview?.([{ id: 'bridge', value: 0.2 }])}
          onPointerUp={() => onNoseHandleCommit?.()}
        />
      ) : null}
    </div>
  ),
}))
vi.mock('./useIsDesktop', () => ({ useIsDesktop: () => true }))

describe('보기 도구 (2026-10-30)', () => {
  it('하나로만 보고, 시점·나란히 보기 버튼 없이 원본 보기는 누르고 있는 동안만 원본이다', () => {
    render(<FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} />)
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveAttribute('data-layout', 'single')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '시점 처음으로' })).not.toBeInTheDocument()

    const hold = screen.getByRole('button', { name: '누르고 있는 동안 원본 보기' })
    fireEvent.pointerDown(hold, { button: 0, pointerId: 1 })
    expect(viewer).toHaveAttribute('data-showing', 'before')
    expect(screen.getByRole('status')).toHaveTextContent('원본')
    fireEvent.pointerUp(hold, { pointerId: 1 })
    expect(viewer).toHaveAttribute('data-showing', 'after')

    // 키보드: Space를 누르는 동안
    fireEvent.keyDown(hold, { key: ' ' })
    expect(viewer).toHaveAttribute('data-showing', 'before')
    fireEvent.keyUp(hold, { key: ' ' })
    expect(viewer).toHaveAttribute('data-showing', 'after')
  })

  describe('휠 확대 영역(-788)', () => {
    /** 무대 칸을 화면의 (100,100)~(500,400)에 둔다. 칸은 휠마다 재므로 그린 뒤에 바꿔도 된다 */
    function placeStage() {
      const stage = screen.getByRole('region', { name: '3D 뷰어' })
      vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 100, y: 100, width: 400, height: 300 }),
      )
    }
    /** 캔버스(뷰어)에 휠을 보내고, 3D까지 닿았는지 돌려준다 */
    function wheelReachesViewer(x: number, y: number) {
      const viewer = screen.getByTestId('viewer')
      let reached = false
      const listen = () => (reached = true)
      viewer.addEventListener('wheel', listen)
      fireEvent.wheel(viewer, { clientX: x, clientY: y, deltaY: 100 })
      viewer.removeEventListener('wheel', listen)
      return reached
    }

    it('켜면 무대 칸 안의 휠만 3D로 가고, 칸 밖(번진 캔버스의 여백) 휠은 페이지로 넘긴다', () => {
      render(<FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} zoomOnlyInStage />)
      placeStage()
      // 칸 안이면 머리에서 먼 빈 곳이어도 확대한다
      expect(wheelReachesViewer(120, 120)).toBe(true)
      expect(wheelReachesViewer(480, 380)).toBe(true)
      // 칸 밖(조절 패널 옆 여백·아래)은 3D가 받지 않는다
      expect(wheelReachesViewer(700, 200)).toBe(false)
      expect(wheelReachesViewer(300, 450)).toBe(false)
    })

    it('기본은 꺼져 있어 어디서 굴려도 3D로 간다', () => {
      render(<FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} />)
      placeStage()
      expect(wheelReachesViewer(700, 200)).toBe(true)
    })
  })

  it('원본 보기를 누르고 있는 동안만 헤어를 숨기고, 떼면 다시 보인다(S15P31B204-839)', () => {
    render(
      <FaceStage
        meshUrl="https://example.invalid/head.glb"
        weights={{}}
        hairUrl="https://example.invalid/hair.glb"
      />,
    )
    const viewer = screen.getByTestId('viewer')
    expect(viewer).toHaveAttribute('data-hair-hidden', 'false')
    const hold = screen.getByRole('button', { name: '누르고 있는 동안 원본 보기' })
    fireEvent.pointerDown(hold, { button: 0, pointerId: 1 })
    expect(viewer).toHaveAttribute('data-showing', 'before')
    expect(viewer).toHaveAttribute('data-hair-hidden', 'true')
    fireEvent.pointerUp(hold, { pointerId: 1 })
    expect(viewer).toHaveAttribute('data-showing', 'after')
    expect(viewer).toHaveAttribute('data-hair-hidden', 'false')
  })

  it('바깥 원본 보기 버튼(holding)을 누르고 있는 동안에도 헤어를 숨긴다(-839)', () => {
    const props = {
      meshUrl: 'https://example.invalid/head.glb',
      weights: {},
      hairUrl: 'https://example.invalid/hair.glb',
    }
    const { rerender } = render(<FaceStage {...props} holding />)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-hair-hidden', 'true')
    rerender(<FaceStage {...props} holding={false} />)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-hair-hidden', 'false')
  })

  it('비교를 끄면 원본 보기 버튼이 없고 조명 구만 있다', () => {
    render(<FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} compare={false} />)
    expect(screen.queryByRole('button', { name: /원본 보기/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /조명 위치/ })).toBeInTheDocument()
  })
})

describe('상담 변경 위치 보기', () => {
  it('콧볼을 누르면 수정한 모델에서 부위를 표시하고, 원본을 보는 동안은 표시를 끈다', () => {
    const props = { meshUrl: 'https://example.invalid/head.glb', weights: {} }
    const { rerender } = render(<FaceStage {...props} />)
    rerender(<FaceStage {...props} inspectChange={{ codes: ['nose.alar_width'], nonce: 1 }} />)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-layout', 'single')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-highlight', 'nose.alar_width')
    expect(screen.getByText(/콧볼의 표시된 부위를 확인하고/)).toBeInTheDocument()

    const hold = screen.getByRole('button', { name: '누르고 있는 동안 원본 보기' })
    fireEvent.pointerDown(hold, { button: 0, pointerId: 1 })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-showing', 'before')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-highlight', '')
    fireEvent.pointerUp(hold, { pointerId: 1 })
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-highlight', 'nose.alar_width')
  })
})

describe('코 구조 손잡이', () => {
  it('기존 점 편집이 24개여도 새 손잡이는 사용할 수 있다', () => {
    const props = {
      meshUrl: 'https://example.invalid/head.glb',
      rigUrl: 'https://example.invalid/rig.json',
      weights: {},
      onNoseHandleCommit: vi.fn(),
      noseHandleControls: [{ id: 'bridge' as const, value: 0, unavailable: false }],
    }
    const strokes = Array.from({ length: 23 }, (_, vertex) => ({
      vertex,
      delta: [0.001, 0, 0] as [number, number, number],
    }))
    const { rerender } = render(<FaceStage {...props} pointStrokes={strokes} />)
    fireEvent.click(screen.getByRole('button', { name: '코 구조 조절' }))
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-point-edit-enabled', 'true')
    expect(screen.getByText(/코 점을 누르면 움직일 수 있는 방향이 보여요/)).toBeInTheDocument()

    rerender(<FaceStage {...props} pointStrokes={[...strokes, strokes[0]]} />)
    expect(screen.getByRole('button', { name: '코 구조 조절' })).toBeEnabled()
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-point-edit-enabled', 'true')
  })

  it('손잡이를 움직인 뒤 한 번 저장한다', () => {
    const commit = vi.fn()
    const preview = vi.fn()
    const props = {
      meshUrl: 'https://example.invalid/head.glb',
      rigUrl: 'https://example.invalid/rig.json',
      weights: {},
      onNoseHandleCommit: commit,
      onNoseHandlePreview: preview,
      noseHandleControls: [{ id: 'bridge' as const, value: 0, unavailable: false }],
    }
    render(<FaceStage {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '코 구조 조절' }))
    fireEvent.pointerMove(screen.getByRole('button', { name: '코 구조 손잡이' }))
    fireEvent.pointerUp(screen.getByRole('button', { name: '코 구조 손잡이' }))
    expect(preview).toHaveBeenCalledExactlyOnceWith([{ id: 'bridge', value: 0.2 }])
    expect(commit).toHaveBeenCalledOnce()
  })
})

describe('작업실에서 날아온 머리 그림 (-600)', () => {
  const from = { left: 10, top: 20, width: 100, height: 125 }

  afterEach(() => {
    useHandoff.getState().clear()
    vi.useRealTimers()
  })

  it('3D가 뜨기 전에 편집실을 떠나면(뒤로 가기) 그림을 바로 지운다', () => {
    vi.useFakeTimers()
    useHandoff.getState().start('data:image/webp;base64,AA', from)
    const { unmount } = render(
      <FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} />,
    )
    expect(useHandoff.getState().phase).toBe('fly')

    unmount()
    act(() => vi.runAllTimers())
    expect(useHandoff.getState()).toMatchObject({ phase: 'idle', image: null })
  })

  it('다른 화면의 3D가 사라져도 작업실에서 막 뜬 그림은 지우지 않는다', () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} />,
    )
    useHandoff.getState().start('data:image/webp;base64,AA', from)

    unmount()
    act(() => vi.runAllTimers())
    expect(useHandoff.getState().phase).toBe('lift')
  })

  it('개발 모드처럼 떼었다 바로 다시 붙으면 지우지 않는다', () => {
    vi.useFakeTimers()
    useHandoff.getState().start('data:image/webp;base64,AA', from)
    render(
      <StrictMode>
        <FaceStage meshUrl="https://example.invalid/head.glb" weights={{}} />
      </StrictMode>,
    )
    act(() => vi.runAllTimers())
    expect(useHandoff.getState().phase).toBe('fly')
  })
})
