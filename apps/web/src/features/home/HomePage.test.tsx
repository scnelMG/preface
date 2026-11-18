import { act, fireEvent, render, screen } from '@testing-library/react'
import { Activity, useEffect } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callsTo, ok, routeFetch } from '@/features/auth/testUtils'
import { useAuthStore } from '@/features/auth/store'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { clearVisited, markVisited } from '@/features/landing/firstVisit'
import { HOME_HANDOFF_STORAGE_KEY, readHomeHandoff } from '@/features/edit/lab/homeHandoff'
import { HomePage } from './HomePage'

// WebGL 대신 전달된 메시와 비교 모드만 확인한다. 나머지 인증·최근 기록 훅은 실제로 실행한다.
let viewerReady = false
let weightTargetAvailable = true
/** 뷰어가 새로 뜬 횟수(카메라 구도가 처음으로 돌아가는지 본다) */
let viewerMounts = 0
vi.mock('@/features/viewer/FaceViewerLoader', () => ({
  FaceViewer: ({
    meshUrl,
    layout,
    weights,
    onSupportedCodes,
    onStatusChange,
    hairUrl,
    zoomOnlyOverModel,
    lighting,
  }: {
    meshUrl: string
    layout: string
    weights: Record<string, number>
    onSupportedCodes?: (codes: string[]) => void
    onStatusChange?: (status: 'ready') => void
    hairUrl?: string | null
    zoomOnlyOverModel?: boolean
    lighting?: { azimuth: number; elevation: number }
  }) => {
    useEffect(() => {
      viewerMounts += 1
    }, [])
    useEffect(() => {
      if (!viewerReady) return
      onStatusChange?.('ready')
      const codes = [
        'nose.bridge_height',
        'nose.tip_projection',
        'nose.tip_height',
        'nose.tip_rotation',
        'nose.alar_width',
        'contour.cheekbone',
        'contour.cheek_volume',
        'contour.chin_projection',
        'contour.chin_length',
        'contour.chin_width',
        'contour.jaw_angle',
        ...(weightTargetAvailable ? ['contour.weight_shape'] : []),
      ]
      onSupportedCodes?.(codes)
    }, [meshUrl, onStatusChange, onSupportedCodes])
    return (
      <div
        data-testid="viewer"
        data-mesh={meshUrl}
        data-layout={layout}
        data-weights={JSON.stringify(weights)}
        data-hair={hairUrl ?? ''}
        data-zoom-only={zoomOnlyOverModel ? 'model' : ''}
        data-lighting={lighting ? `${lighting.azimuth},${lighting.elevation}` : ''}
      />
    )
  },
}))
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}))
const SIMULATIONS = {
  items: [
    {
      simulationId: 'sim-9',
      faceModelId: 'fm-1',
      title: '밸런스 스터디 원본 비교',
      changedParts: ['NOSE'],
      createdAt: '2026-10-21T06:00:00Z',
      updatedAt: '2026-10-21T07:01:00Z',
    },
  ],
  page: 0,
  size: 3,
  totalElements: 3,
}
const FACE_MODELS = {
  items: [
    {
      faceModelId: 'fm-1',
      title: '내 모델',
      thumbnailUrl: null,
      createdAt: '2026-10-20T00:00:00Z',
      simulationCount: 3,
    },
  ],
  page: 0,
  size: 50,
  totalElements: 4,
}

beforeEach(() => {
  viewerReady = false
  weightTargetAvailable = true
  push.mockReset()
  replace.mockReset()
  markVisited()
  useLoginPrompt.setState({ open: false, returnTo: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  clearVisited()
})
describe('실서비스 체험 메인 연결', () => {
  it('세션 복구 중에는 회원 API와 최근 기록을 표시하지 않는다', () => {
    const fetch = routeFetch([])
    useAuthStore.setState({ status: 'loading', me: null })
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('촬영한 내 얼굴을3D로.')
    expect(screen.queryByText('최근 작업')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('비로그인 촬영 진입은 실제 로그인 모달과 촬영 복귀 경로로 연결한다', async () => {
    const fetch = routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<HomePage />)
    await userEvent.click(screen.getByRole('button', { name: '내 3D 얼굴 만들기' }))
    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio/new' })
    expect(push).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('로그인한 사용자의 촬영 진입은 실서비스 새 모델 화면으로 이동한다', async () => {
    routeFetch([
      ['GET', '/simulations', ok(SIMULATIONS)],
      ['GET', '/face-models', ok(FACE_MODELS)],
    ])
    useAuthStore.setState({ status: 'member', me: null })
    render(<HomePage />)
    await userEvent.click(screen.getByRole('button', { name: '내 3D 얼굴 만들기' }))
    expect(push).toHaveBeenCalledWith('/studio/new')
    expect(useLoginPrompt.getState().open).toBe(false)
  })
  it('회원이어도 메인에는 최근 작업을 두지 않고 기록 API를 부르지 않는다 (2026-10-30)', () => {
    const fetch = routeFetch([])
    useAuthStore.setState({ status: 'member', me: null })
    render(<HomePage />)
    expect(screen.queryByText('최근 작업')).not.toBeInTheDocument()
    expect(callsTo(fetch, '/simulations')).toHaveLength(0)
    expect(screen.getByTestId('viewer')).toBeInTheDocument()
  })
  it('기본 모델 선택이 체험 뷰어로 전달되고, 전후 비교 없이 하나로만 본다', async () => {
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<HomePage />)
    await userEvent.click(screen.getByRole('button', { name: /^남성$/ }))
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-mesh', '/models/base-male.glb')
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-layout', 'single')
    expect(screen.queryByRole('button', { name: '전후 비교' })).not.toBeInTheDocument()
    // 편집 기록은 아이콘 버튼이고, 바꾼 것이 없으면 누를 수 없다
    for (const name of ['되돌리기', '다시 하기', '처음으로'])
      expect(screen.getByRole('button', { name })).toBeDisabled()
  })
  it('부위 탭은 실험실과 같은 순서(눈·코·윤곽·체중·헤어)이고 처음에는 코가 선택돼 있다', async () => {
    viewerReady = true
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<HomePage />)
    await userEvent.click(screen.getByRole('button', { name: /^남성$/ }))
    const tabs = screen.getAllByRole('tab', { name: /^(눈|코|윤곽|체중|헤어)/ })
    expect(tabs.map((tab) => (tab.textContent ?? '').replace(/예정/, '').trim())).toEqual([
      '눈',
      '코',
      '윤곽',
      '체중',
      '헤어',
    ])
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
  })
  it.each(['남성', '여성'])(
    '%s 기본 모델의 홈 윤곽·체중 변화는 안전하게 전환하고 되돌린다',
    async (name) => {
      viewerReady = true
      routeFetch([])
      useAuthStore.setState({ status: 'anonymous', me: null })
      render(<HomePage />)
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}$`) }))
      const weights = () =>
        JSON.parse(screen.getByTestId('viewer').getAttribute('data-weights') || '{}')

      await userEvent.click(screen.getByRole('tab', { name: '윤곽' }))
      const cheekbone = screen.getByRole('slider', { name: '광대 크기' })
      expect(cheekbone).toBeEnabled()
      fireEvent.pointerDown(cheekbone)
      fireEvent.input(cheekbone, { target: { value: '0.3' } })
      expect(weights()).toMatchObject({ 'contour.cheekbone': 0.3 })

      await userEvent.click(screen.getByRole('tab', { name: '체중' }))
      expect(screen.queryByRole('slider', { name: '체중 변화 감량·증량' })).not.toBeInTheDocument()
      expect(screen.getByText('버튼을 누르면 윤곽 조절값이 원래대로 돌아가요.')).toBeInTheDocument()
      expect(weights()['contour.cheekbone']).toBe(0.3)
      await userEvent.click(screen.getByRole('button', { name: '체중 변화 미리보기' }))
      expect(weights()).toEqual({})
      await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(weights()['contour.cheekbone']).toBe(0.3)
      await userEvent.click(screen.getByRole('button', { name: '다시 하기' }))
      const activeWeight = screen.getByRole('slider', { name: '체중 변화 감량·증량' })
      expect(activeWeight).toBeEnabled()
      fireEvent.pointerDown(activeWeight)
      fireEvent.input(activeWeight, { target: { value: '-0.4' } })
      expect(weights()).toMatchObject({ 'contour.weight_shape': -0.4 })
      expect(activeWeight).toHaveAttribute('aria-valuetext', '감량 방향 · 강도 40')

      await userEvent.click(screen.getByRole('tab', { name: '눈' }))
      expect(weights()['contour.weight_shape']).toBe(-0.4)
      await userEvent.click(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' }))
      expect(weights()['contour.weight_shape']).toBe(0)
      await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(weights()['contour.weight_shape']).toBe(-0.4)
      expect(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '다시 하기' }))
      expect(weights()['contour.weight_shape']).toBe(0)
      await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(weights()['contour.weight_shape']).toBe(-0.4)

      await userEvent.click(screen.getByRole('tab', { name: '코' }))
      await userEvent.click(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' }))
      const nose = screen.getByRole('slider', { name: '콧대 높이' })
      fireEvent.pointerDown(nose)
      fireEvent.input(nose, { target: { value: '0.2' } })
      expect(weights()).toMatchObject({ 'contour.weight_shape': 0, 'nose.bridge_height': 0.2 })
      await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(weights()['contour.weight_shape']).toBe(0)
      await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(weights()['contour.weight_shape']).toBe(-0.4)
      expect(weights()['nose.bridge_height'] ?? 0).toBe(0)
      await userEvent.click(screen.getByRole('button', { name: '다시 하기' }))
      await userEvent.click(screen.getByRole('button', { name: '다시 하기' }))
      expect(weights()).toMatchObject({ 'contour.weight_shape': 0, 'nose.bridge_height': 0.2 })
      await userEvent.click(screen.getByRole('button', { name: '처음으로' }))
      expect(weights()).toEqual({})
      fireEvent.pointerDown(screen.getByRole('slider', { name: '콧대 높이' }))
      fireEvent.input(screen.getByRole('slider', { name: '콧대 높이' }), {
        target: { value: '0.3' },
      })
      await userEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${name === '남성' ? '여성' : '남성'}$`) }),
      )
      expect(weights()).toEqual({})
      expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled()
    },
  )
  it('홈 기본 GLB에 체중 변화 타깃이 없으면 조절을 잠근다', async () => {
    viewerReady = true
    weightTargetAvailable = false
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<HomePage />)
    await userEvent.click(screen.getByRole('tab', { name: '체중' }))
    expect(screen.getByRole('slider', { name: '체중 변화 감량·증량' })).toBeDisabled()
  })
  it('휴대폰 조작 안내는 미리 보기에서 숨고, 전체 화면 체험에서만 터치를 막지 않고 보인다 (-533)', async () => {
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    render(<HomePage />)
    const hints = () =>
      screen.getAllByRole('list', { hidden: true, name: '3D 조작 안내' })[0].parentElement
    expect(hints()).toHaveClass('max-md:hidden', 'max-md:pointer-events-none')

    await userEvent.click(screen.getByRole('button', { name: '체험하기' }))
    expect(hints()).not.toHaveClass('max-md:hidden')
    expect(hints()).toHaveClass('max-md:pointer-events-none')
    expect(screen.getByText('한 손가락 회전')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '홈으로' }))
    expect(hints()).toHaveClass('max-md:hidden')
  })
  it('세션 복구 후 처음 온 비로그인 사용자만 랜딩으로 보낸다', () => {
    routeFetch([])
    clearVisited()
    useAuthStore.setState({ status: 'loading', me: null })
    render(<HomePage />)
    expect(replace).not.toHaveBeenCalled()
    act(() => useAuthStore.setState({ status: 'anonymous', me: null }))
    expect(replace).toHaveBeenCalledWith('/about')
  })
})

describe('메인 → 체험 실험실 이어 가기·헤어 로그인 안내 (S15P31B204-746)', () => {
  afterEach(() => {
    sessionStorage.clear()
  })

  it('손대지 않으면 넘길 값을 남기지 않고, 모델·값을 바꾸면 sessionStorage에 남긴다. 처음으로 돌리면 지운다', async () => {
    viewerReady = true
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    sessionStorage.setItem(
      HOME_HANDOFF_STORAGE_KEY,
      JSON.stringify({ sample: 'base-male', weights: { 'nose.bridge_height': 0.9 } }),
    )
    render(<HomePage />)
    // 새로 연 메인은 손대지 않은 상태라 예전 값을 지운다
    expect(readHomeHandoff()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^여성$/ }))
    expect(readHomeHandoff()).toEqual({ sample: 'base-female', weights: {} })

    const bridge = screen.getByRole('slider', { name: '콧대 높이' })
    fireEvent.pointerDown(bridge)
    fireEvent.input(bridge, { target: { value: '0.3' } })
    expect(readHomeHandoff()?.weights).toMatchObject({ 'nose.bridge_height': 0.3 })

    await userEvent.click(screen.getByRole('button', { name: /^남성$/ }))
    expect(readHomeHandoff()).toBeNull()
  })

  it.each(['anonymous', 'member'] as const)(
    '헤어 탭은 `베타` 표시 없이 열리고(S15P31B204-838), 카드를 고르면 기본 모델에 씌운다. 이력·실험실 넘김에는 넣지 않는다 (%s, S15P31B204-770)',
    async (status) => {
      viewerReady = true
      routeFetch([])
      useAuthStore.setState({ status, me: null })
      render(<HomePage />)
      const hair = screen.getByRole('tab', { name: /^헤어/ })
      expect(hair).toHaveTextContent(/^헤어$/)
      expect(hair).not.toHaveTextContent('예정')
      expect(hair).not.toHaveTextContent('로그인')
      await userEvent.click(hair)
      expect(screen.queryByText('헤어는 로그인하면 쓸 수 있어요')).not.toBeInTheDocument()
      expect(screen.getByTestId('viewer')).toHaveAttribute('data-hair', '')

      const bob = screen.getByRole('button', { name: '리프컷' })
      await userEvent.click(bob)
      expect(bob).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByTestId('viewer').getAttribute('data-hair')).toMatch(
        /\/hair\/male-leaf\.glb$/,
      )
      // 헤어는 되돌리기 이력이 아니고, 체험 실험실로 넘기는 값(모델·조절값)에도 없다
      expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled()
      expect(readHomeHandoff()).toBeNull()

      // 기본 모델을 바꿔도 같은 헤어를 새 모델에 씌운다
      await userEvent.click(screen.getByRole('button', { name: /^여성$/ }))
      expect(screen.getByTestId('viewer').getAttribute('data-hair')).toMatch(
        /\/hair\/male-leaf\.glb$/,
      )
      expect(readHomeHandoff()).toEqual({ sample: 'base-female', weights: {} })

      // 다시 누르면 벗긴다
      await userEvent.click(screen.getByRole('button', { name: '리프컷' }))
      expect(screen.getByTestId('viewer')).toHaveAttribute('data-hair', '')
    },
  )

  it('처음에는 남성 모델이고, 다른 화면에 다녀오면(Activity로 숨었다 다시 보임) 처음 들어온 것과 똑같다 (S15P31B204-840, -848)', async () => {
    viewerReady = true
    routeFetch([])
    useAuthStore.setState({ status: 'anonymous', me: null })
    const { rerender } = render(
      <Activity mode="visible">
        <HomePage />
      </Activity>,
    )
    const viewer = () => screen.getByTestId('viewer')
    expect(viewer()).toHaveAttribute('data-mesh', '/models/base-male.glb')

    // 메인 안에서 고른 모델·조절값은 그대로 남는다
    await userEvent.click(screen.getByRole('button', { name: /^여성$/ }))
    await userEvent.click(screen.getByRole('tab', { name: '윤곽' }))
    const cheekbone = screen.getByRole('slider', { name: '광대 크기' })
    fireEvent.pointerDown(cheekbone)
    fireEvent.input(cheekbone, { target: { value: '0.3' } })
    expect(viewer()).toHaveAttribute('data-mesh', '/models/base-female.glb')
    expect(JSON.parse(viewer().getAttribute('data-weights') || '{}')).toMatchObject({
      'contour.cheekbone': 0.3,
    })
    expect(readHomeHandoff()?.sample).toBe('base-female')

    // 조명을 옮기고 헤어를 씌운 채 헤어 탭에 머문다
    const light = () => screen.getByRole('button', { name: /^조명 위치/ })
    fireEvent.keyDown(light(), { key: 'ArrowRight' })
    expect(viewer()).not.toHaveAttribute('data-lighting', '-30,35')
    await userEvent.click(screen.getByRole('tab', { name: /^헤어/ }))
    await userEvent.click(screen.getByRole('button', { name: '리프컷' }))
    expect(viewer().getAttribute('data-hair')).toMatch(/\/hair\/male-leaf\.glb$/)
    const mountsBefore = viewerMounts

    // 다른 화면으로 갔다가(cacheComponents가 메인을 숨긴 채 남긴다) 돌아온다
    rerender(
      <Activity mode="hidden">
        <HomePage />
      </Activity>,
    )
    rerender(
      <Activity mode="visible">
        <HomePage />
      </Activity>,
    )
    expect(viewer()).toHaveAttribute('data-mesh', '/models/base-male.glb')
    expect(viewer()).toHaveAttribute('data-weights', '{}')
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '처음으로' })).toBeDisabled()
    // 헤어는 없음, 부위 탭은 코, 조명은 기본, 뷰어는 새로 떠서 카메라가 처음 구도다(-848)
    expect(viewer()).toHaveAttribute('data-hair', '')
    expect(screen.getByRole('tab', { name: '코' })).toHaveAttribute('aria-selected', 'true')
    expect(viewer()).toHaveAttribute('data-lighting', '-30,35')
    expect(viewerMounts).toBeGreaterThan(mountsBefore)
    await userEvent.click(screen.getByRole('tab', { name: '윤곽' }))
    // 새 모델이 준비되면 조절이 다시 열리고, 손대지 않은 상태라 실험실 넘김도 지운다
    expect(await screen.findByRole('slider', { name: '광대 크기' })).toBeEnabled()
    expect(readHomeHandoff()).toBeNull()
  })

  it('메인 3D는 휠 확대를 머리 사각형 안에서만 받는다(S15P31B204-770)', () => {
    viewerReady = true
    routeFetch([])
    render(<HomePage />)
    expect(screen.getByTestId('viewer')).toHaveAttribute('data-zoom-only', 'model')
  })

  it('큰 화면 3D 무대·조절 카드는 머리줄·꼬리말·여백(196px)을 뺀 화면 높이를 넘지 않는다(S15P31B204-867)', () => {
    routeFetch([])
    render(<HomePage />)
    // 낮은 화면(약 860px 아래)에서 꼬리말만큼 스크롤이 생기지 않게 한다. 높은 화면은 -840 크기 그대로
    const cap = 'calc(100svh-196px)'
    expect(document.querySelector('.pf-main-stage')?.className).toContain(
      `lg:h-[min(77.5svh,725px,${cap})]`,
    )
    expect(screen.getByLabelText('형태 편집').className).toContain(
      `lg:max-h-[min(77.5svh,725px,${cap})]`,
    )
  })
})
