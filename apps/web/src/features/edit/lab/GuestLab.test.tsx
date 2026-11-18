import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import {
  clearTutorialRecord,
  GUEST_LAB_TUTORIAL_STORAGE_KEY,
  writeTutorialRecord,
} from '@/features/tutorial/storage'
import { HOME_HANDOFF_STORAGE_KEY, writeHomeHandoff } from './homeHandoff'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { __resetToaster } from '@/shared/ui/Toast'
import { useEditStore } from '../store'
import { useEffect } from 'react'
import { GuestLab } from './GuestLab'
import { verifySampleMesh } from './verifySampleMesh'

let search = new URLSearchParams()
let glbWeightShape = true
vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
}))
vi.mock('./verifySampleMesh', () => ({ verifySampleMesh: vi.fn(async () => true) }))

vi.mock('@/features/viewer/FaceStage', () => ({
  FaceStage: ({
    weights,
    meshUrl,
    onSupportedCodes,
    onStatusChange,
    hairUrl,
    onHairStatus,
    zoomOnlyInStage,
  }: {
    weights: Record<string, number>
    meshUrl: string
    zoomOnlyInStage?: boolean
    onSupportedCodes?: (codes: string[]) => void
    onStatusChange?: (status: 'ready') => void
    hairUrl?: string | null
    onHairStatus?: (status: 'ready' | 'error') => void
  }) => {
    useEffect(() => {
      onStatusChange?.('ready')
      onSupportedCodes?.([
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
        ...(glbWeightShape ? ['contour.weight_shape'] : []),
      ])
    }, [onSupportedCodes, onStatusChange])
    return (
      <div
        data-testid="stage"
        data-mesh={meshUrl}
        data-hair={hairUrl ?? ''}
        data-zoom-area={zoomOnlyInStage ? 'stage' : ''}
      >
        {JSON.stringify(weights)}
        <button onClick={() => onHairStatus?.('ready')}>헤어 준비 완료</button>
      </div>
    )
  },
}))

function catalogResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      error: null,
      data: {
        schemaVersion: 'v1',
        parts: [
          {
            part: 'NOSE',
            label: '코',
            items: [
              {
                code: 'nose.bridge_height',
                subPart: 'BRIDGE',
                label: '콧대 높이',
                min: -0.5,
                max: 0.8,
                default: 0,
                step: 0.05,
              },
            ],
          },
        ],
      },
    }),
  }
}

/** 첫 탭은 눈이다(-748). 코 슬라이더를 보는 시험은 카탈로그가 온 뒤 코 탭을 연다 */
async function openNose() {
  const tab = await screen.findByRole('tab', { name: '코' })
  await waitFor(() => expect(tab).not.toHaveAttribute('aria-disabled', 'true'))
  fireEvent.click(tab)
}

describe('GuestLab (비로그인 체험)', () => {
  beforeEach(() => {
    search = new URLSearchParams()
    glbWeightShape = true
    useAuthStore.setState({ status: 'anonymous', me: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    vi.mocked(verifySampleMesh).mockResolvedValue(true)
    // 첫 사용 안내는 아래 따로 본다
    writeTutorialRecord('completed', GUEST_LAB_TUTORIAL_STORAGE_KEY)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetToaster()
    useLoginPrompt.getState().close()
    clearTutorialRecord(GUEST_LAB_TUTORIAL_STORAGE_KEY)
    sessionStorage.clear()
  })

  it('EDIT-01을 인증 없이 부르고 슬라이더를 움직이면 3D에 바로 반영한다', async () => {
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('/morph-parameters?schemaVersion=v2')
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()

    fireEvent.change(slider, { target: { value: '0.2' } })
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.2')
  })

  it('놓으면 이력에 쌓이고 되돌리기로 돌아간다. 서버에는 저장하지 않는다', async () => {
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    const undo = screen.getByRole('button', { name: '되돌리기' })
    expect(undo).toBeDisabled()

    fireEvent.input(slider, { target: { value: '0.3' } })
    // 손을 뗄 때 브라우저가 보내는 change
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(undo).toBeEnabled())

    fireEvent.click(undo)
    expect(useEditStore.getState().morphState.weights['nose.bridge_height'] ?? 0).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    // 슬라이더 알림과 같은 모양으로, 앞 알림을 바꾼다
    expect(await screen.findByText('콧대 높이 0%로 되돌렸어요')).toBeInTheDocument()
    expect(screen.queryByText('콧대 높이 +30%로 바꿨어요')).not.toBeInTheDocument()
  })

  it('놓아도 수치 알림은 띄우지 않는다(항목별 되돌리기 버튼도 없다, -852)', async () => {
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    const undo = screen.getByRole('button', { name: '되돌리기' })
    fireEvent.input(slider, { target: { value: '0.2' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(undo).toBeEnabled())
    expect(screen.queryByText(/바꿨어요/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '콧대 높이 되돌리기' })).not.toBeInTheDocument()
  })

  it('처음으로는 확인 없이 비우고 되돌리기 토스트를 띄운다', async () => {
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }))
    expect(useEditStore.getState().morphState.weights).toEqual({})

    const action = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-toaster] button')
      expect(button).not.toBeNull()
      return button as HTMLButtonElement
    })
    expect(action).toHaveTextContent('되돌리기')
    act(() => action.click())
    expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.4 })
  })

  it('처음으로(도구줄)는 바뀐 게 있을 때만 켜지고, 조절을 모두 비운다 (패널의 전체 초기화는 없앴다)', async () => {
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    expect(screen.queryByRole('button', { name: '전체 초기화' })).not.toBeInTheDocument()
    const resetAll = screen.getByRole('button', { name: '처음으로' })
    expect(resetAll).toBeDisabled()

    fireEvent.change(slider, { target: { value: '0.4' } })
    expect(resetAll).toBeEnabled()
    fireEvent.click(resetAll)
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(resetAll).toBeDisabled()
  })

  it('?sample=로 고른 기본 모델을 보이고, 없거나 모르는 값이면 남성 기본 모델', async () => {
    search = new URLSearchParams('sample=base-female')
    const { unmount } = render(<GuestLab />)
    expect(await screen.findByTestId('stage')).toHaveAttribute(
      'data-mesh',
      expect.stringContaining('/models/base-female.glb'),
    )
    // 휠 확대는 3D 무대 칸 안에서만 받는다(-788)
    expect(screen.getByTestId('stage')).toHaveAttribute('data-zoom-area', 'stage')
    expect(screen.getByText('여성 기본 모델')).toBeInTheDocument()
    unmount()

    search = new URLSearchParams('sample=original')
    render(<GuestLab />)
    expect(await screen.findByTestId('stage')).toHaveAttribute(
      'data-mesh',
      expect.stringContaining('/models/base-male.glb'),
    )
    expect(screen.getByText('남성 기본 모델')).toBeInTheDocument()
  })

  it('남녀 기본 모델을 같은 화면에서 바꾸면 이전 모델 조절과 채팅 상태를 비운다', async () => {
    useAuthStore.setState({ status: 'member' })
    const { rerender } = render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.change(slider, { target: { value: '0.2' } })
    expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.2)
    search = new URLSearchParams('sample=base-female')
    rerender(<GuestLab />)
    expect(await screen.findByTestId('stage')).toHaveAttribute(
      'data-mesh',
      expect.stringContaining('/models/base-female.glb'),
    )
    await waitFor(() => expect(useEditStore.getState().morphState.weights).toEqual({}))
  })

  it('AI 상담은 로그인 모달 신호를 보내고, 돌아올 주소에 고른 모델을 남긴다', async () => {
    search = new URLSearchParams('sample=base-female')
    render(<GuestLab />)
    fireEvent.click(await screen.findByRole('button', { name: /로그인하고 AI 상담 시작/ }))
    expect(useLoginPrompt.getState()).toMatchObject({
      open: true,
      returnTo: '/lab?sample=base-female',
    })
    expect(screen.queryByRole('tab', { name: '상담' })).not.toBeInTheDocument()
  })

  it('로그인한 회원에게는 기본 모델 상담 탭을 열고 비회원은 열지 않는다', async () => {
    useAuthStore.setState({ status: 'member' })
    render(<GuestLab />)
    expect(await screen.findByRole('tab', { name: '상담' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /로그인하고/ })).not.toBeInTheDocument()
  })

  it.each(['base-male', 'base-female'])(
    '%s 회원 체험에서 채팅 코 편집이 3D와 되돌리기에 반영되고 서버 시안을 만들지 않는다',
    async (key) => {
      search = new URLSearchParams(`sample=${key}`)
      useAuthStore.setState({ status: 'member' })
      const sampleReply = {
        success: true,
        error: null,
        data: {
          maskedUserContent: '콧대를 좀 올려줘',
          assistantMessage: '',
          intent: 'EDIT',
          changeRequest: {
            actions: [
              { code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'small' },
            ],
            skipped: [],
          },
          needsClarification: false,
          options: [],
          filtered: false,
          recommendedSliderCode: null,
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('/sample-models/')
            ? { ok: true, status: 200, json: async () => sampleReply }
            : catalogResponse(),
        ),
      )
      render(<GuestLab />)
      fireEvent.click(await screen.findByRole('tab', { name: '상담' }))
      fireEvent.click(screen.getByRole('button', { name: '콧대를 좀 올려줘' }))
      await waitFor(() =>
        expect(useEditStore.getState().morphState.weights['nose.bridge_height']).toBe(0.1),
      )
      const consultCalls = vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes('/sample-models/'))
      expect(consultCalls).toHaveLength(1)
      expect(String(consultCalls[0][0])).toContain(`/sample-models/${key}/consult`)
      expect(JSON.parse(String(consultCalls[0][1]?.body))).not.toHaveProperty('image')
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/simulations/')),
      ).toBe(false)
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(useEditStore.getState().morphState.weights['nose.bridge_height'] ?? 0).toBe(0)
    },
  )

  it('기본 모델 파일 해시가 다르면 회원 채팅도 3D를 바꾸지 않는다', async () => {
    useAuthStore.setState({ status: 'member' })
    vi.mocked(verifySampleMesh).mockResolvedValue(false)
    render(<GuestLab />)
    fireEvent.click(await screen.findByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: '콧대를 좀 올려줘' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('모델을 확인한 뒤')
    expect(useEditStore.getState().morphState.weights).toEqual({})
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/sample-models/')),
    ).toBe(false)
  })

  it('대답을 기다리는 중 체험을 떠나면 늦은 채팅 결과가 다음 화면을 바꾸지 않는다', async () => {
    useAuthStore.setState({ status: 'member' })
    let finish: ((response: unknown) => void) | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('/sample-models/')
          ? new Promise((resolve) => {
              finish = resolve
            })
          : Promise.resolve(catalogResponse()),
      ),
    )
    const { unmount } = render(<GuestLab />)
    fireEvent.click(await screen.findByRole('tab', { name: '상담' }))
    fireEvent.click(screen.getByRole('button', { name: '콧대를 좀 올려줘' }))
    await waitFor(() => expect(finish).toBeDefined())
    unmount()
    await act(async () => {
      finish?.({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          error: null,
          data: {
            maskedUserContent: '콧대를 좀 올려줘',
            assistantMessage: '',
            intent: 'EDIT',
            changeRequest: {
              actions: [
                { code: 'nose.bridge_height', side: 'both', direction: 1, strength: 'small' },
              ],
              skipped: [],
            },
            needsClarification: false,
            options: [],
            filtered: false,
            recommendedSliderCode: null,
          },
        }),
      })
    })
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('카탈로그를 받기 전에는 열릴 부위를 `예정`으로 그리지 않고, 새 얼굴형 탭도 기존 순서에 둔다', () => {
    // 응답이 오지 않는 동안(체험은 서버가 없으면 실패 뒤 기본 목록으로 넘어간다)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    render(<GuestLab />)
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '')
    expect(tabs.map((text) => text.replace(/예정/, '').trim())).toEqual([
      '눈',
      '코',
      '윤곽',
      '체중',
      '헤어',
    ])
    for (const name of [/^눈/, /^코/, /^윤곽/, /^체중/]) {
      expect(screen.getByRole('tab', { name })).not.toHaveTextContent('예정')
    }
    // 헤어는 `예정` 없이 연다(S15P31B204-770). `베타` 표시도 뗐다(S15P31B204-838)
    expect(screen.getByRole('tab', { name: /헤어/ })).toHaveTextContent(/^헤어$/)
    expect(screen.getByRole('tab', { name: /헤어/ })).not.toHaveTextContent('예정')
  })

  it('첫 탭은 탭 순서대로 눈이고, 눈 패널을 바로 연다(-748)', async () => {
    render(<GuestLab />)
    expect(await screen.findByRole('radiogroup', { name: '쌍꺼풀 모양' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '눈' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
  })

  it('눈 탭은 카탈로그 눈 항목 대신 쌍꺼풀·트임 패널을 열고 윤곽은 광대·턱끝·볼·턱선 카드를 연다', async () => {
    const base = catalogResponse()
    const body = await base.json()
    body.data.parts.push({
      part: 'EYE',
      label: '눈',
      items: [
        {
          code: 'eye.tail_angle.right',
          subPart: 'TAIL',
          label: '눈꼬리 각도(오른쪽)',
          min: -1,
          max: 1,
          default: 0,
          step: 0.05,
        },
      ],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ...base, json: async () => body }))
    render(<GuestLab />)
    await openNose()
    expect(await screen.findByRole('slider', { name: '콧대 높이' })).toBeInTheDocument()
    // 윤곽: 서버 카탈로그에 없어도 기본 모델 GLB에 구운 항목으로 연다
    const contourTab = screen.getByRole('tab', { name: /윤곽/ })
    expect(contourTab).not.toHaveAttribute('aria-disabled')
    fireEvent.click(contourTab)
    for (const name of ['광대 크기', '턱끝 앞뒤', '턱끝 길이', '턱끝 폭', '볼살', '사각턱']) {
      expect(await screen.findByRole('slider', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
    // 눈은 카탈로그 항목(눈꼬리 각도) 대신 쌍꺼풀·트임 눈 패널을 연다
    const eyeTab = screen.getByRole('tab', { name: /눈/ })
    expect(eyeTab).not.toHaveAttribute('aria-disabled')
    fireEvent.click(eyeTab)
    expect(screen.queryByRole('slider', { name: /눈꼬리/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: '콧대 높이' })).not.toBeInTheDocument()
    expect(await screen.findByRole('radiogroup', { name: '쌍꺼풀 모양' })).toBeInTheDocument()
  })

  it('EDIT-01이 실패해도 명세서 예시 코 항목으로 체험한다', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'))
    render(<GuestLab />)
    await openNose()
    expect(await screen.findByRole('slider', { name: '콧볼 너비' })).toBeInTheDocument()
  })

  it.each(['base-male', 'base-female'])(
    '%s 기본 모델에서 체중 변화 두 방향·원복·이력이 3D에 반영된다',
    async (key) => {
      search = new URLSearchParams(`sample=${key}`)
      render(<GuestLab />)
      fireEvent.click(await screen.findByRole('tab', { name: '체중' }))
      const slider = await screen.findByRole('slider', { name: '체중 변화 감량·증량' })
      expect(slider).toBeEnabled()
      expect(slider).toHaveAttribute('aria-valuetext', '원본')
      expect(screen.queryByText(/왼쪽은 감량/)).not.toBeInTheDocument()

      fireEvent.input(slider, { target: { value: '-0.4' } })
      act(() => slider.dispatchEvent(new Event('change', { bubbles: true })))
      expect(screen.getByTestId('stage')).toHaveTextContent('"contour.weight_shape":-0.4')
      expect(slider).toHaveAttribute('aria-valuetext', '감량 방향 · 강도 40')
      expect(screen.getByText('-40', { exact: true })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape'] ?? 0).toBe(0)

      fireEvent.input(slider, { target: { value: '0.6' } })
      act(() => slider.dispatchEvent(new Event('change', { bubbles: true })))
      expect(screen.getByTestId('stage')).toHaveTextContent('"contour.weight_shape":0.6')
      expect(slider).toHaveAttribute('aria-valuetext', '증량 방향 · 강도 60')
      expect(screen.getByText('+60', { exact: true })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: '코' }))
      expect(screen.getByTestId('stage')).toHaveTextContent('"contour.weight_shape":0.6')
      fireEvent.click(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' }))
      const nose = await screen.findByRole('slider', { name: '콧대 높이' })
      expect(nose).toBeEnabled()
      fireEvent.input(nose, { target: { value: '0.2' } })
      act(() => nose.dispatchEvent(new Event('change', { bubbles: true })))
      expect(useEditStore.getState().morphState.weights).toMatchObject({
        'contour.weight_shape': 0,
        'nose.bridge_height': 0.2,
      })
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape']).toBe(0)
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape']).toBe(0.6)
      fireEvent.click(screen.getByRole('tab', { name: '눈' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape']).toBe(0.6)
      fireEvent.click(screen.getByRole('button', { name: '눈·코·윤곽 조절하기' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape']).toBe(0)
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
      expect(useEditStore.getState().morphState.weights['contour.weight_shape']).toBe(0.6)
    },
  )

  it('타깃 쌍이 없는 기본 모델에서는 체중 탭을 열지 않는다', async () => {
    glbWeightShape = false
    render(<GuestLab />)
    await openNose()
    await screen.findByRole('slider', { name: '콧대 높이' })
    expect(screen.getByRole('tab', { name: /^체중/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('내림은 두 값을 원자적으로 바꾸고 한 번에 되돌린다', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'))
    render(<GuestLab />)
    await openNose()
    const slider = await screen.findByRole('slider', { name: '코끝 위아래' })
    await waitFor(() => expect(slider).toBeEnabled())
    const states: Record<string, number>[] = []
    const unsubscribe = useEditStore.subscribe((s) => states.push(s.morphState.weights))
    fireEvent.input(slider, { target: { value: '0.5' } })
    unsubscribe()
    expect(states).toEqual([{ 'nose.tip_height': -0.3, 'nose.tip_rotation': -0.2 }])
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })
})

describe('GuestLab — 첫 사용 안내 (S15P31B204-746)', () => {
  const card = () => screen.getByRole('dialog', { name: /둘러보기|부위 고르기|슬라이더|되돌리기/ })
  const title = () => within(card()).getByRole('heading').textContent

  beforeEach(() => {
    search = new URLSearchParams()
    glbWeightShape = true
    useAuthStore.setState({ status: 'anonymous', me: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    clearTutorialRecord(GUEST_LAB_TUTORIAL_STORAGE_KEY)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetToaster()
    clearTutorialRecord(GUEST_LAB_TUTORIAL_STORAGE_KEY)
    localStorage.clear()
  })

  it('처음 쓰는 기기에는 둘러보기부터 4단계를 보이고, 해 보면 넘어가 완료로 남긴다', async () => {
    render(<GuestLab />)
    await waitFor(() => expect(title()).toContain('4단계 중 1단계, 둘러보기'))
    // 원본 보기 버튼이 없는 화면이라 그 단계는 없다
    expect(card()).not.toHaveTextContent('원본')

    // 3D 무대에서 휠을 굴리면 둘러본 것으로 본다
    fireEvent.wheel(screen.getByTestId('stage'))
    await waitFor(() => expect(title()).toContain('부위 고르기'))

    fireEvent.click(screen.getByRole('tab', { name: /^윤곽/ }))
    await waitFor(() => expect(title()).toContain('슬라이더로 조절하기'))

    fireEvent.click(screen.getByRole('tab', { name: /^코/ }))
    const slider = await screen.findByRole('slider', { name: '콧대 높이' })
    fireEvent.input(slider, { target: { value: '0.3' } })
    act(() => {
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => expect(title()).toContain('되돌리기'), { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(GUEST_LAB_TUTORIAL_STORAGE_KEY)).toBe('completed')
  })

  it('단계 막대를 누르면 그 단계로 앞뒤 어디든 옮긴다(-849)', async () => {
    render(<GuestLab />)
    await waitFor(() => expect(title()).toContain('4단계 중 1단계, 둘러보기'))
    const dash = (n: number) => within(card()).getByRole('button', { name: `${n}단계로 이동` })

    fireEvent.click(dash(4))
    expect(title()).toContain('4단계 중 4단계, 되돌리기')
    fireEvent.click(dash(2))
    expect(title()).toContain('4단계 중 2단계, 부위 고르기')
    expect(dash(2)).toHaveAttribute('aria-current', 'step')
    expect(localStorage.getItem(GUEST_LAB_TUTORIAL_STORAGE_KEY)).toBeNull()
  })

  it('건너뛰면 기록을 남기고 다시 열어도 띄우지 않는다(메인·편집실 기록과 따로)', async () => {
    const { unmount } = render(<GuestLab />)
    await waitFor(() => expect(card()).toBeInTheDocument())
    fireEvent.click(within(card()).getByRole('button', { name: '건너뛰기' }))
    await waitFor(() => expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument())
    expect(localStorage.getItem(GUEST_LAB_TUTORIAL_STORAGE_KEY)).toBe('skipped')
    unmount()
    render(<GuestLab />)
    await openNose()
    await screen.findByRole('slider', { name: '콧대 높이' })
    expect(screen.queryByTestId('tutorial')).not.toBeInTheDocument()
  })
})

describe('GuestLab — 메인 체험 값 이어 받기 (S15P31B204-746)', () => {
  beforeEach(() => {
    search = new URLSearchParams()
    glbWeightShape = true
    useAuthStore.setState({ status: 'anonymous', me: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    writeTutorialRecord('completed', GUEST_LAB_TUTORIAL_STORAGE_KEY)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetToaster()
    clearTutorialRecord(GUEST_LAB_TUTORIAL_STORAGE_KEY)
    sessionStorage.clear()
  })

  it('메인에서 고른 기본 모델과 값으로 열고, 넘겨받은 표는 지운다. 처음으로는 값을 비운다', async () => {
    writeHomeHandoff({
      sample: 'base-female',
      weights: { 'nose.bridge_height': 0.4, 'contour.jaw_angle': -0.2 },
    })
    render(<GuestLab />)
    expect(await screen.findByText('여성 기본 모델 체험 중')).toBeInTheDocument()
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights).toEqual({
        'nose.bridge_height': 0.4,
        'contour.jaw_angle': -0.2,
      }),
    )
    expect(screen.getByTestId('stage')).toHaveTextContent('"nose.bridge_height":0.4')
    expect(sessionStorage.getItem(HOME_HANDOFF_STORAGE_KEY)).toBeNull()

    const reset = screen.getByRole('button', { name: '처음으로' })
    expect(reset).toBeEnabled()
    fireEvent.click(reset)
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('모르는 항목·범위 밖 값은 버리고, 깨진 값이면 지금처럼 처음 상태로 연다', async () => {
    sessionStorage.setItem(
      HOME_HANDOFF_STORAGE_KEY,
      JSON.stringify({
        sample: 'base-male',
        weights: { 'nose.bridge_height': 0.2, 'nose.alar_width': 9, 'unknown.code': 0.5 },
      }),
    )
    const { unmount } = render(<GuestLab />)
    await waitFor(() =>
      expect(useEditStore.getState().morphState.weights).toEqual({ 'nose.bridge_height': 0.2 }),
    )
    unmount()

    sessionStorage.setItem(HOME_HANDOFF_STORAGE_KEY, '{not json')
    render(<GuestLab />)
    expect(await screen.findByText('남성 기본 모델 체험 중')).toBeInTheDocument()
    await openNose()
    await screen.findByRole('slider', { name: '콧대 높이' })
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })

  it('?sample=이 다른 모델이면 그 모델을 처음 상태로 연다', async () => {
    search = new URLSearchParams('sample=base-male')
    writeHomeHandoff({ sample: 'base-female', weights: { 'nose.bridge_height': 0.4 } })
    render(<GuestLab />)
    expect(await screen.findByText('남성 기본 모델 체험 중')).toBeInTheDocument()
    await openNose()
    await screen.findByRole('slider', { name: '콧대 높이' })
    expect(useEditStore.getState().morphState.weights).toEqual({})
  })
})

describe('GuestLab — 헤어(S15P31B204-770)', () => {
  beforeEach(() => {
    search = new URLSearchParams('sample=base-female')
    glbWeightShape = true
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    writeTutorialRecord('completed', GUEST_LAB_TUTORIAL_STORAGE_KEY)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetToaster()
    useLoginPrompt.getState().close()
    clearTutorialRecord(GUEST_LAB_TUTORIAL_STORAGE_KEY)
  })

  it.each(['anonymous', 'member'] as const)(
    '헤어 탭에서 카드를 고르면 기본 모델에 씌우고, 다시 누르면 벗긴다. 되돌리기 이력에는 넣지 않는다 (%s)',
    async (status) => {
      useAuthStore.setState(status === 'member' ? { status } : { status, me: null })
      render(<GuestLab />)
      await openNose()
      await screen.findByRole('slider', { name: '콧대 높이' })
      const hair = screen.getByRole('tab', { name: /^헤어/ })
      // `베타` 표시는 뗐다(S15P31B204-838)
      expect(hair).toHaveTextContent(/^헤어$/)
      expect(hair).not.toHaveAttribute('aria-disabled')
      fireEvent.click(hair)
      expect(screen.queryByText('헤어는 로그인하면 쓸 수 있어요')).not.toBeInTheDocument()
      expect(screen.getByTestId('stage')).toHaveAttribute('data-hair', '')

      fireEvent.click(await screen.findByRole('button', { name: '리프컷' }))
      expect(screen.getByTestId('stage').getAttribute('data-hair')).toMatch(
        /\/hair\/male-leaf\.glb$/,
      )
      expect(screen.getByText('헤어를 불러오는 중이에요.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '헤어 준비 완료' }))
      expect(screen.queryByText('헤어를 불러오는 중이에요.')).toBeNull()
      expect(screen.getByRole('button', { name: '되돌리기' })).toBeDisabled()
      expect(useLoginPrompt.getState().open).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: '리프컷' }))
      expect(screen.getByTestId('stage')).toHaveAttribute('data-hair', '')
    },
  )
})
