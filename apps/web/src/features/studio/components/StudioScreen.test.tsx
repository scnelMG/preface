import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Activity } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { useToastStore } from '@/shared/ui/Toast'
import type { FaceModelSummary, SimulationSummary } from '../types'
import { StudioScreen } from './StudioScreen'
import { EMPTY_WITH_HEAD_LEAD, EMPTY_WITH_HEAD_TITLE } from './RecentRecords'

const push = vi.fn()
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}))

// 썸네일 캡처(-436)는 WebGL 캔버스가 있어야 해서 jsdom에서는 흉내만 낸다. 어떤 머리를 캡처하려는지만 보고, 버튼으로 결과를 돌려준다
vi.mock('./ThumbnailCapture', () => ({
  ThumbnailCapture: ({
    faceModelId,
    onDone,
  }: {
    faceModelId: string
    onDone: (url: string | null) => void
  }) => (
    <button
      type="button"
      data-testid="thumbnail-capture"
      onClick={() => onDone(`https://s3.test/thumb-${faceModelId}.webp`)}
    >
      {faceModelId}
    </button>
  ),
}))

// three.js 뷰어는 jsdom에서 돌지 않는다. 어떤 메시·가중치로 어느 쪽을 그리는지만 본다
vi.mock('@/features/viewer/FaceViewerLoader', () => ({
  FaceViewer: ({
    meshUrl,
    weights,
    showing,
  }: {
    meshUrl: string
    weights: Record<string, number>
    showing: string
  }) => (
    <div data-testid="viewer" data-showing={showing} data-weights={JSON.stringify(weights)}>
      {meshUrl}
    </div>
  ),
}))

beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  window.localStorage.removeItem('preface.sampleHeads')
  push.mockReset()
  replace.mockReset()
  search = new URLSearchParams()
  useLoginPrompt.setState({ open: false, returnTo: null })
  act(() => useToastStore.setState({ items: [] }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const page = <T,>(items: T[], totalElements = items.length) => ({
  items,
  page: 0,
  size: 20,
  totalElements,
})

const myHead: FaceModelSummary = {
  faceModelId: 'fm-1',
  title: '내 모델',
  thumbnailUrl: null,
  createdAt: '2026-10-22T03:00:00Z',
  simulationCount: 1,
}

const record = (id: string, title: string): SimulationSummary => ({
  simulationId: id,
  faceModelId: 'fm-1',
  title,
  changedParts: ['NOSE'],
  createdAt: '2026-10-21T07:00:00Z',
  updatedAt: '2026-10-21T07:01:00Z',
})

const toastMessages = () => useToastStore.getState().items.map((item) => item.message)

/** 모델 이름 아래 아이콘(이름 바꾸기·삭제)을 누른다 */
async function pressModelAction(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(
    await screen.findByRole('button', { name: item === '삭제' ? '이 모델 삭제' : item }),
  )
}
/** 시안 카드 ⋮ 메뉴(2026-10-31)를 열고 항목을 고른다(`<제목> 메뉴`) */
async function pickCardMenu(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  item: string,
  scope: HTMLElement = document.body,
) {
  await user.click(await within(scope).findByRole('button', { name: `${title} 메뉴` }))
  await user.click(screen.getByRole('menuitem', { name: item }))
}

describe('게스트 작업실 (P3-36)', () => {
  beforeEach(() => useAuthStore.setState({ status: 'anonymous', me: null }))

  it('남성·여성 기본 모델 2종과 머리 추가 칸이 보이고, 고른 모델로 체험 실험실에 간다', async () => {
    const user = userEvent.setup()
    render(<StudioScreen />)

    // 화면 제목 글자 대신 `모델 | 시안` 탭(2026-10-30)
    expect(screen.getByRole('tab', { name: '모델', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 모델' })).toBeVisible()
    const shelf = screen.getByRole('region', { name: '모델 고르기' })
    expect(
      within(shelf)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining('남성 기본 모델'),
      expect.stringContaining('여성 기본 모델'),
    ])
    expect(
      within(document.querySelector('.pf-selected-stage') as HTMLElement).getByTestId('viewer'),
    ).toHaveTextContent('/models/base-male.glb')

    await user.click(within(shelf).getByRole('button', { name: /여성 기본 모델/ }))
    expect(
      within(document.querySelector('.pf-selected-stage') as HTMLElement).getByTestId('viewer'),
    ).toHaveTextContent('/models/base-female.glb')
    await user.click(screen.getByRole('button', { name: '편집하기' }))
    expect(push).toHaveBeenCalledWith('/lab?sample=base-female')
  })

  it('가운데 머리를 눌러도 편집하기와 같이 체험 실험실에 간다(-605)', async () => {
    const user = userEvent.setup()
    render(<StudioScreen />)

    await user.click(document.querySelector('.pf-selected-stage') as HTMLElement)
    expect(push).toHaveBeenCalledWith('/lab?sample=base-male')
  })

  it('시안 탭·새 모델은 로그인 모달을 띄운다', async () => {
    const user = userEvent.setup()
    render(<StudioScreen />)

    await user.click(screen.getByRole('tab', { name: '시안' }))
    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio?tab=records' })

    act(() => useLoginPrompt.getState().close())
    await user.click(screen.getByRole('button', { name: '새 모델' }))
    expect(useLoginPrompt.getState()).toMatchObject({ open: true, returnTo: '/studio/new' })
  })
})

describe('회원 작업실 (P3-42·45)', () => {
  beforeEach(() => useAuthStore.setState({ status: 'member' }))

  it('내 모델이 맨 앞이고, 시작하기는 새 시안을 만들어 편집 화면으로 간다', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['POST', '/face-models/fm-1/simulations', ok({ simulationId: 'sim-9' }, 201)],
    ])
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '내 모델' })).toBeInTheDocument()
    // 큰 제목에는 `01 / 03` 같은 순번을 붙이지 않는다(-392)
    expect(screen.queryByText(/\d{2} \/ \d{2}/)).not.toBeInTheDocument()
    expect(
      await within(document.querySelector('.pf-selected-stage') as HTMLElement).findByTestId(
        'viewer',
      ),
    ).toHaveTextContent('https://s3.test/m.glb')

    await user.click(screen.getByRole('button', { name: '편집하기' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/simulations/sim-9'))
    expect(callsTo(fetch, '/face-models/fm-1/simulations')).toHaveLength(1)
  })

  it('가운데 머리를 눌러도 새 시안을 만들어 편집 화면으로 가고, 만드는 동안 다시 눌러도 한 번만 만든다(-605)', async () => {
    const user = userEvent.setup()
    // 시안 만들기 응답을 붙잡아 두고(불러오는 중), 그동안 다시 누른다
    let resolve: (value: Response) => void = () => {}
    const pending = () => new Promise<Response>((done) => (resolve = done))
    const fetch = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['POST', '/face-models/fm-1/simulations', pending as unknown as () => Response],
    ])
    render(<StudioScreen />)

    const stage = await waitFor(() => {
      const element = document.querySelector('.pf-selected-stage')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    await user.click(stage)
    await screen.findByRole('button', { name: '불러오는 중…' })
    await user.click(document.querySelector('.pf-selected-stage') as HTMLElement)
    expect(callsTo(fetch, '/face-models/fm-1/simulations')).toHaveLength(1)

    await act(async () => resolve(ok({ simulationId: 'sim-9' }, 201)))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/simulations/sim-9'))
  })

  it('썸네일이 없는 내 모델은 원본을 캡처해 올리고, 저장되면 칸 그림이 바로 바뀐다 (-436)', async () => {
    const user = userEvent.setup()
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
    ])
    render(<StudioScreen />)

    const capture = await screen.findByTestId('thumbnail-capture')
    expect(capture).toHaveTextContent('fm-1')
    await user.click(capture)

    await waitFor(() => expect(screen.queryByTestId('thumbnail-capture')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '내 모델' })).toBeVisible()
  })

  it('시안이 있어도 모델 탭은 모델 고르기만 한다: 원본을 그리고, 시안 목록·이어서 수정 없이 시작하기 하나 (2026-10-30)', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([record('sim-2', '두 번째'), record('sim-1', '첫 번째')]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['POST', '/face-models/fm-1/simulations', ok({ simulationId: 'sim-9' }, 201)],
    ])
    render(<StudioScreen />)

    const startButton = await screen.findByRole('button', { name: '편집하기' })
    expect(screen.queryByRole('button', { name: '이어서 수정하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '최근 기록 보기' })).not.toBeInTheDocument()
    expect(screen.queryByText('두 번째')).not.toBeVisible()
    expect(
      await within(document.querySelector('.pf-selected-stage') as HTMLElement).findByTestId(
        'viewer',
      ),
    ).toHaveAttribute('data-weights', JSON.stringify({}))

    await user.click(startButton)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/simulations/sim-9'))
    expect(callsTo(fetch, '/face-models/fm-1/simulations')).toHaveLength(1)
  })

  it('주소의 faceModelId로 그 모델을 골라 둔다. 만드는 중·실패한 3D는 작업실 안에 따로 두지 않는다', async () => {
    search = new URLSearchParams('faceModelId=fm-2')
    const fetch = routeFetch([
      [
        'GET',
        '/face-models?',
        ok(page([myHead, { ...myHead, faceModelId: 'fm-2', title: '내 모델 2' }])),
      ],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-2', ok({ faceModelId: 'fm-2', meshUrl: 'https://s3.test/2.glb' })],
    ])
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '내 모델 2' })).toBeInTheDocument()
    // 진행·실패는 어느 화면에서나 같은 자리의 진행 팝업(ProgressDock)이 보여 준다(2026-11-01)
    expect(callsTo(fetch, '/reconstructions/current')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /만드는 중인 모델|만들지 못한 모델/ })).toBeNull()
  })

  it('지운 모델 id로 들어오면(예전 완성 알림) 알리고 맨 앞 모델을 골라 두며 주소를 정리한다 (-814)', async () => {
    search = new URLSearchParams('faceModelId=fm-gone')
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/1.glb' })],
      ['GET', '/face-models/fm-gone', fail(404, 'COMMON_002')],
    ])
    render(<StudioScreen />)

    // 고르기는 그대로 목록 맨 앞(최신 내 모델, 없으면 기본 모델)
    expect(await screen.findByRole('heading', { name: '내 모델' })).toBeInTheDocument()
    await waitFor(() => expect(toastMessages()).toEqual(['삭제된 모델이에요.']))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/studio')
  })

  it('새 모델 링크로 돌아오면 최신 목록을 기다리고 이전 탭과 선택을 새 모델로 바꾼다 (-901)', async () => {
    const user = userEvent.setup()
    const newHead = { ...myHead, faceModelId: 'fm-new', title: '새 모델 3D' }
    const fresh = Promise.withResolvers<Response>()
    const firstVisit = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ ...myHead, meshUrl: 'https://s3.test/1.glb' })],
      ['GET', '/face-models/fm-new', ok({ ...newHead, meshUrl: 'https://s3.test/new.glb' })],
    ])
    let listCalls = 0
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/face-models?') && ++listCalls === 2) return fresh.promise
      return firstVisit(input, init)
    })
    vi.stubGlobal('fetch', fetch)

    const view = render(
      <Activity mode="visible">
        <StudioScreen />
      </Activity>,
    )
    await screen.findByRole('heading', { name: '내 모델' })
    await user.click(
      within(screen.getByRole('region', { name: '모델 고르기' })).getByRole('button', {
        name: '남성 기본 모델 선택',
      }),
    )
    await user.click(screen.getByRole('tab', { name: '시안' }))
    view.rerender(
      <Activity mode="hidden">
        <StudioScreen />
      </Activity>,
    )
    search = new URLSearchParams('faceModelId=fm-new')
    view.rerender(
      <Activity mode="visible">
        <StudioScreen />
      </Activity>,
    )
    expect(callsTo(fetch, '/face-models?')).toHaveLength(2)
    expect(callsTo(fetch, '/face-models/fm-new')).toHaveLength(0)
    expect(toastMessages()).toEqual([])

    await act(async () => fresh.resolve(ok(page([newHead, myHead]))))
    expect(await screen.findByRole('heading', { name: '새 모델 3D' })).toBeVisible()
    expect(toastMessages()).toEqual([])
    expect(replace).not.toHaveBeenCalled()
  })

  it.each([
    ['모델이 존재함', ok({ faceModelId: 'fm-linked', meshUrl: 'https://s3.test/linked.glb' })],
    ['일시적인 서버 오류', fail(503, 'COMMON_999')],
  ])(
    '목록에 없는 모델의 상세 응답이 %s이면 삭제 안내를 띄우지 않는다 (-901)',
    async (_, detail) => {
      search = new URLSearchParams('faceModelId=fm-linked')
      const fetch = routeFetch([
        ['GET', '/face-models?', ok(page([myHead]))],
        ['GET', '/simulations?', ok(page([]))],
        ['GET', '/face-models/fm-1', ok({ ...myHead, meshUrl: 'https://s3.test/1.glb' })],
        ['GET', '/face-models/fm-linked', detail],
      ])
      render(<StudioScreen />)

      await screen.findByRole('heading', { name: '내 모델' })
      expect(callsTo(fetch, '/face-models/fm-linked')).toHaveLength(1)
      expect(toastMessages()).toEqual([])
      expect(replace).not.toHaveBeenCalled()
    },
  )

  it('있는 모델 id로 들어오면 삭제 안내를 띄우지 않는다 (-814)', async () => {
    search = new URLSearchParams('faceModelId=fm-1')
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/1.glb' })],
    ])
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '내 모델' })).toBeInTheDocument()
    expect(toastMessages()).toEqual([])
    expect(replace).not.toHaveBeenCalled()
  })

  it('모델 목록을 받지 못하면 지웠는지 모르니 삭제 안내를 띄우지 않는다 (-814)', async () => {
    search = new URLSearchParams('faceModelId=fm-gone')
    routeFetch([
      ['GET', '/face-models?', fail(500, 'COMMON_001')],
      ['GET', '/simulations?', ok(page([]))],
    ])
    render(<StudioScreen />)

    await waitFor(() => expect(screen.getByRole('button', { name: /다시/ })).toBeInTheDocument())
    expect(toastMessages()).toEqual([])
    expect(replace).not.toHaveBeenCalled()
  })

  it('3D가 아직 완성되지 않았다는 등 실패하면 서버 문구를 토스트로 보여 준다', async () => {
    const user = userEvent.setup()
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', fail(404, 'COMMON_002')],
      [
        'POST',
        '/face-models/fm-1/simulations',
        fail(409, 'EDIT_020', '3D가 아직 완성되지 않았어요.'),
      ],
    ])
    render(<StudioScreen />)

    expect(await screen.findByText(/3D 모델 주소를 받지 못했어요/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '편집하기' }))
    await waitFor(() => expect(toastMessages()).toContain('3D가 아직 완성되지 않았어요.'))
    expect(push).not.toHaveBeenCalled()
  })

  it('최근 기록이 없으면 빈 상태를 보여 준다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('tab=records')
    routeFetch([
      ['GET', '/face-models?', ok(page([]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
    ])
    render(<StudioScreen />)

    // 기본 모델 편집은 저장되지 않으니 내 머리 추가로 보낸다(-527)
    expect(await screen.findByText('기본 모델 편집은 저장되지 않아요.')).toBeInTheDocument()
    expect(screen.getByText('내 머리를 추가하면 시안이 생겨요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '내 머리 추가하기' })).toHaveAttribute(
      'href',
      '/studio/new',
    )
    await user.click(screen.getByRole('tab', { name: '모델' }))
    // 내 모델이 없으면 기본 모델 2종 + 머리 추가
    expect(screen.getByRole('heading', { name: '남성' })).toBeInTheDocument()
  })

  it('내 머리는 있고 시안이 없으면 실험실에서 바꿔 보라고 안내한다(-527)', async () => {
    search = new URLSearchParams('tab=records')
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
    ])
    render(<StudioScreen />)

    expect(await screen.findByText(EMPTY_WITH_HEAD_TITLE)).toBeInTheDocument()
    expect(screen.getByText(EMPTY_WITH_HEAD_LEAD)).toBeInTheDocument()
    expect(screen.queryByText('기본 모델 편집은 저장되지 않아요.')).toBeNull()
    expect(screen.queryByRole('link', { name: '내 머리 추가하기' })).toBeNull()
  })

  it('내 모델은 서버가 준 이름을 카드와 큰 제목에 보여 준다 (-392)', async () => {
    routeFetch([
      ['GET', '/face-models?', ok(page([{ ...myHead, title: '봄에 찍은 머리' }]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
    ])
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '봄에 찍은 머리' })).toBeInTheDocument()
    // 큰 제목 + 카드
    expect(screen.getAllByText('봄에 찍은 머리')).toHaveLength(2)
    expect(screen.queryByText('내 모델')).not.toBeInTheDocument()
    expect(screen.queryByText(/\d{2} \/ \d{2}/)).not.toBeInTheDocument()
  })

  it('기록 격자에서 SCR-15로 확인하고 지운 뒤 토스트를 띄운다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('tab=records')
    const fetch = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      [
        'GET',
        '/simulations?',
        ok(
          page([
            record('sim-1', '콧대를 조금 높인 시안'),
            record('sim-2', '라인 스터디 · 콧대 +2'),
          ]),
        ),
      ],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['DELETE', '/simulations/sim-1', ok({})],
    ])
    render(<StudioScreen />)

    const card = (await screen.findByRole('heading', { name: '콧대를 조금 높인 시안' })).closest(
      'article',
    )!
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/simulations/sim-1')
    expect(card).toHaveTextContent('내 모델 · 코')

    await pickCardMenu(user, '콧대를 조금 높인 시안', '삭제', card)
    const dialog = screen.getByRole('dialog', { name: '이 시안을 삭제할까요?' })
    expect(dialog).toHaveTextContent('‘콧대를 조금 높인 시안’을 삭제하면 되돌릴 수 없어요.')

    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: '콧대를 조금 높인 시안' }),
      ).not.toBeInTheDocument(),
    )
    // 고른 내 모델의 마지막 시안 미리보기(GET)도 같은 주소라 DELETE만 센다
    expect(
      callsTo(fetch, '/simulations/sim-1').filter(([, init]) => init?.method === 'DELETE'),
    ).toHaveLength(1)
    expect(toastMessages()).toContain('시안을 삭제했어요.')
  })

  it('이미 지워진 기록(404)은 목록에서 빼고, 그 밖의 실패는 남겨 둔다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('tab=records')
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([record('sim-1', '시안 A'), record('sim-2', '시안 B')]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['DELETE', '/simulations/sim-1', fail(404, 'COMMON_002')],
      ['DELETE', '/simulations/sim-2', fail(500, 'COMMON_999', '잠시 후 다시 시도해 주세요.')],
    ])
    render(<StudioScreen />)

    await pickCardMenu(user, '시안 A', '삭제')
    await user.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByText('시안 A')).not.toBeInTheDocument())
    expect(toastMessages()).toContain('이미 삭제된 시안이에요.')

    await pickCardMenu(user, '시안 B', '삭제')
    await user.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(toastMessages()).toContain('잠시 후 다시 시도해 주세요.'))
    expect(screen.getByRole('heading', { name: '시안 B' })).toBeInTheDocument()
  })

  it('시안 탭은 제목·새 모델·검색 없이 모델 칩으로 거르고, 더 있으면 다음 페이지를 이어 붙인다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('tab=records')
    const otherHead = { ...myHead, faceModelId: 'fm-2', title: '내 모델 2' }
    routeFetch([
      ['GET', '/face-models?', ok(page([myHead, otherHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      [
        'GET',
        '/simulations?',
        ok(
          page(
            [record('sim-1', '콧대 시안'), { ...record('sim-2', '눈 시안'), faceModelId: 'fm-2' }],
            3,
          ),
        ),
      ],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      ['GET', '/simulations?', ok({ ...page([record('sim-3', '코끝 시안')], 3), page: 1 })],
    ])
    render(<StudioScreen />)

    // 모델별 줄(2026-10-31): 줄마다 큰 이름·시안 수, 맨 앞 '원본' 칸 다음에 그 모델의 시안
    const first = await screen.findByRole('region', { name: '내 모델' })
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 모델' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '모델로 거르기' })).not.toBeInTheDocument()
    expect(within(first).getByText('시안 1개')).toBeInTheDocument()
    expect(within(first).getByText('원본')).toBeInTheDocument()
    expect(within(first).getByRole('heading', { name: '콧대 시안' })).toBeInTheDocument()
    const second = screen.getByRole('region', { name: '내 모델 2' })
    expect(within(second).getByRole('heading', { name: '눈 시안' })).toBeInTheDocument()
    expect(within(second).queryByRole('heading', { name: '콧대 시안' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '시안 더 보기' }))
    expect(await screen.findByRole('heading', { name: '코끝 시안' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '시안 더 보기' })).not.toBeInTheDocument()
  })

  it('시안 카드의 연필로 이름을 바꾸면 그 카드만 고친다 (API-HIS-05)', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('tab=records')
    const fetch = routeFetch([
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([record('sim-1', '콧대 시안')]))],
      ['GET', '/face-models/fm-1', ok({ faceModelId: 'fm-1', meshUrl: 'https://s3.test/m.glb' })],
      [
        'PATCH',
        '/simulations/sim-1',
        ok({ simulationId: 'sim-1', title: '높은 콧대', updatedAt: '2026-10-30T01:00:00Z' }),
      ],
    ])
    render(<StudioScreen />)

    await pickCardMenu(user, '콧대 시안', '이름 바꾸기')
    const dialog = screen.getByRole('dialog', { name: '시안 이름 바꾸기' })
    const input = within(dialog).getByRole('textbox', { name: '시안 이름' })
    // 시안 이름은 편집실과 같이 20자까지다. 20자에 닿으면 안내를 띄운다(S15P31B204-838)
    expect(input).toHaveAttribute('maxLength', '20')
    await user.clear(input)
    await user.type(input, '가'.repeat(25))
    expect(input).toHaveValue('가'.repeat(20))
    expect(within(dialog).getByText('최대 20자까지 쓸 수 있어요')).toBeInTheDocument()
    await user.clear(input)
    expect(within(dialog).queryByText('최대 20자까지 쓸 수 있어요')).not.toBeInTheDocument()
    await user.type(input, '높은 콧대{Enter}')

    expect(await screen.findByRole('heading', { name: '높은 콧대' })).toBeInTheDocument()
    expect(toastMessages()).toContain('이름을 바꿨어요')
    const patch = fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(JSON.parse(String(patch[0][1]?.body))).toEqual({ title: '높은 콧대' })
  })

  it('목록을 못 불러오면 다시 불러오기를 보여 준다', async () => {
    const user = userEvent.setup()
    routeFetch([
      ['GET', '/face-models?', fail(500, 'COMMON_999')],
      ['GET', '/reconstructions/current', fail(500, 'COMMON_999')],
      ['GET', '/simulations?', fail(500, 'COMMON_999')],
      ['GET', '/face-models?', ok(page([]))],
      ['GET', '/reconstructions/current', ok(null)],
    ])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<StudioScreen />)

    await user.click(await screen.findByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByRole('heading', { name: '남성' })).toBeInTheDocument()
  })
})

describe('내 모델 삭제 (API-HIS-03)', () => {
  beforeEach(() => useAuthStore.setState({ status: 'member' }))

  type Routes = Parameters<typeof routeFetch>[0]
  const secondHead: FaceModelSummary = {
    ...myHead,
    faceModelId: 'fm-2',
    title: '내 모델 2',
    simulationCount: 0,
  }
  const detail = (id: string) => ok({ faceModelId: id, meshUrl: `https://s3.test/${id}.glb` })
  /** 처음 진입: 내 모델 2개 + 기록 1개 */
  const entry = (): Routes => [
    ['GET', '/face-models?', ok(page([myHead, secondHead]))],
    ['GET', '/reconstructions/current', ok(null)],
    ['GET', '/simulations?', ok(page([record('sim-1', '콧대 시안')]))],
    ['GET', '/face-models/fm-1', detail('fm-1')],
  ]
  /** 삭제 뒤 다시 받기: fm-1과 그 시안이 빠졌다 */
  const afterDelete = (): Routes => [
    ['GET', '/face-models?', ok(page([secondHead]))],
    ['GET', '/reconstructions/current', ok(null)],
    ['GET', '/simulations?', ok(page([]))],
    ['GET', '/face-models/fm-2', detail('fm-2')],
  ]
  const deleteCalls = (fetch: ReturnType<typeof routeFetch>) =>
    fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')

  it('기본 모델 2종은 고정이다: 이름 바꾸기·지우기 아이콘이 없고, 예전에 숨긴 기록이 있어도 원래 이름으로 보인다 (-797)', async () => {
    const user = userEvent.setup()
    // 예전(2026-10-30~11-12) 기본 모델을 숨기고 이름을 바꾼 기록이 이 기기에 남아 있다
    window.localStorage.setItem(
      'preface.sampleHeads',
      JSON.stringify({
        titles: { 'base-male': '연습용 머리' },
        hidden: ['base-male', 'base-female'],
      }),
    )
    const fetch = routeFetch(entry())
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '내 모델' })).toBeInTheDocument()
    // 내 모델은 휴지통·연필 아이콘만 보이고(글자 없음) 접근성 이름은 그대로다(-416)
    expect(screen.getByRole('button', { name: '이 모델 삭제' })).toHaveTextContent('')
    expect(screen.getByRole('button', { name: '이름 바꾸기' })).toHaveTextContent('')
    expect(screen.queryByText(/내 얼굴 3D예요/)).not.toBeInTheDocument()

    const shelf = screen.getByRole('region', { name: '모델 고르기' })
    expect(within(shelf).getByRole('button', { name: /여성 기본 모델/ })).toBeInTheDocument()
    await user.click(within(shelf).getByRole('button', { name: /남성 기본 모델/ }))
    expect(screen.getByRole('heading', { name: '남성' })).toBeInTheDocument()
    expect(screen.getByText('기본 모델')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 모델 삭제' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이름 바꾸기' })).not.toBeInTheDocument()
    expect(deleteCalls(fetch)).toHaveLength(0)
  })

  it('가운데가 아닌 모델을 지우면 맨 앞으로 돌아가지 않고 그 자리로 밀려온 모델을 고른다 (-799)', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch([
      ...entry(),
      ['GET', '/face-models/fm-2', detail('fm-2')],
      ['DELETE', '/face-models/fm-2', ok({ deletionStatus: 'PENDING' }, 202)],
      ['GET', '/face-models?', ok(page([myHead]))],
      ['GET', '/simulations?', ok(page([]))],
    ])
    render(<StudioScreen />)

    expect(await screen.findByRole('heading', { name: '내 모델' })).toBeInTheDocument()
    const shelf = screen.getByRole('region', { name: '모델 고르기' })
    await user.click(within(shelf).getByRole('button', { name: /내 모델 2/ }))
    await pressModelAction(user, '삭제')
    await user.click(
      within(screen.getByRole('dialog', { name: '이 모델을 삭제할까요?' })).getByRole('button', {
        name: '삭제',
      }),
    )
    // 내 모델 2 자리에 뒤따르던 남성 기본 모델이 온다(맨 앞 '내 모델'로 돌아가지 않는다)
    expect(await screen.findByRole('heading', { name: '남성' })).toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetch, '/face-models?')).toHaveLength(2))
    expect(screen.getByRole('heading', { name: '남성' })).toBeInTheDocument()
  })

  it('딸린 시안과 30일 영구 삭제를 알리고, 지운 뒤 목록·기록을 다시 받고 선택을 정리한다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('faceModelId=fm-1')
    const fetch = routeFetch([
      ...entry(),
      ['DELETE', '/face-models/fm-1', ok({ deletionStatus: 'PENDING' }, 202)],
      ...afterDelete(),
    ])
    render(<StudioScreen />)

    await pressModelAction(user, '삭제')
    const dialog = screen.getByRole('dialog', { name: '이 모델을 삭제할까요?' })
    expect(dialog).toHaveTextContent(
      '‘내 모델’을 삭제하면 이 모델로 만든 시안 1개도 함께 삭제돼요.',
    )
    expect(dialog).toHaveTextContent('3D 파일은 30일 뒤 서버에서 영구 삭제돼요.')

    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    expect(await screen.findByRole('heading', { name: '내 모델 2' })).toBeInTheDocument()
    expect(toastMessages()).toContain('모델을 삭제했어요.')
    // 여기서 지운 모델은 '삭제된 모델' 안내를 또 띄우지 않는다(-814)
    expect(toastMessages()).not.toContain('삭제된 모델이에요.')
    expect(replace).toHaveBeenCalledTimes(1)
    expect(deleteCalls(fetch)).toHaveLength(1)
    expect(String(deleteCalls(fetch)[0][0])).toContain('/face-models/fm-1')
    await waitFor(() => expect(callsTo(fetch, '/simulations?')).toHaveLength(2))
    expect(callsTo(fetch, '/face-models?')).toHaveLength(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 주소에 남은 지운 머리를 정리한다
    expect(replace).toHaveBeenCalledWith('/studio')
  })

  it('취소하면 지우지 않는다', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch(entry())
    render(<StudioScreen />)

    await pressModelAction(user, '삭제')
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteCalls(fetch)).toHaveLength(0)
    expect(screen.getByRole('heading', { name: '내 모델' })).toBeInTheDocument()
  })

  it('실패하면 창 안에 서버 문구를 보이고 다시 시도할 수 있다', async () => {
    const user = userEvent.setup()
    routeFetch([
      ...entry(),
      ['DELETE', '/face-models/fm-1', fail(500, 'COMMON_999', '잠시 후 다시 시도해 주세요.')],
      ['DELETE', '/face-models/fm-1', ok({ deletionStatus: 'PENDING' }, 202)],
      ...afterDelete(),
    ])
    render(<StudioScreen />)

    await pressModelAction(user, '삭제')
    const dialog = screen.getByRole('dialog', { name: '이 모델을 삭제할까요?' })
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '잠시 후 다시 시도해 주세요.',
    )
    expect(screen.getByRole('heading', { name: '내 모델' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '내 모델 2' })).toBeInTheDocument()
    expect(toastMessages()).toContain('모델을 삭제했어요.')
  })

  it.each([
    ['이미 지워졌거나 남의 것(COMMON_002)', () => fail(404, 'COMMON_002')],
    ['삭제 처리 중(HIS_002)', () => fail(409, 'HIS_002', '삭제 처리 중인 리소스예요.')],
  ])('%s이면 목록에서 빼고 이미 삭제됐다고 알린다', async (_, response) => {
    const user = userEvent.setup()
    routeFetch([...entry(), ['DELETE', '/face-models/fm-1', response()], ...afterDelete()])
    render(<StudioScreen />)

    await pressModelAction(user, '삭제')
    await user.click(screen.getByRole('button', { name: '삭제' }))
    expect(await screen.findByRole('heading', { name: '내 모델 2' })).toBeInTheDocument()
    expect(toastMessages()).toContain('이미 삭제된 모델이에요.')
  })

  it('딸린 시안이 없으면 개수 없이 안내한다', async () => {
    const user = userEvent.setup()
    search = new URLSearchParams('faceModelId=fm-2')
    routeFetch([...entry().slice(0, 3), ['GET', '/face-models/fm-2', detail('fm-2')]])
    render(<StudioScreen />)

    await pressModelAction(user, '삭제')
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '‘내 모델 2’를 삭제하면 이 모델로 만든 시안도 함께 삭제돼요.',
    )
  })
})

describe('내 모델 이름 바꾸기 (API-HIS-08 가안)', () => {
  beforeEach(() => useAuthStore.setState({ status: 'member' }))

  type Routes = Parameters<typeof routeFetch>[0]
  const secondHead: FaceModelSummary = { ...myHead, faceModelId: 'fm-2', title: '내 모델 2' }
  const detail = (id: string) => ok({ faceModelId: id, meshUrl: `https://s3.test/${id}.glb` })
  const entry = (): Routes => [
    ['GET', '/face-models?', ok(page([myHead, secondHead]))],
    ['GET', '/reconstructions/current', ok(null)],
    ['GET', '/simulations?', ok(page([]))],
    ['GET', '/face-models/fm-1', detail('fm-1')],
  ]
  const patchCalls = (fetch: ReturnType<typeof routeFetch>) =>
    fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH')
  const shelfTile = (name: RegExp) =>
    within(screen.getByRole('region', { name: '모델 고르기' })).getByRole('button', { name })

  async function openRename(user: ReturnType<typeof userEvent.setup>) {
    await pressModelAction(user, '이름 바꾸기')
    return screen.getByRole('dialog', { name: '모델 이름 바꾸기' })
  }

  it('게스트 작업실도 기본 모델에 이름 바꾸기·지우기가 없고, 예전에 모두 숨겼어도 두 모델이 보인다 (-797)', async () => {
    window.localStorage.setItem(
      'preface.sampleHeads',
      JSON.stringify({ titles: {}, hidden: ['base-male', 'base-female'] }),
    )
    useAuthStore.setState({ status: 'anonymous', me: null })
    routeFetch([])
    render(<StudioScreen />)

    expect(screen.getByRole('heading', { name: '남성' })).toBeInTheDocument()
    expect(screen.queryByText('목록에서 뺀 기본 모델만 있어요.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이름 바꾸기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 모델 삭제' })).not.toBeInTheDocument()
  })

  it('지금 이름으로 채워 열고, 비었거나 그대로면 바꿀 수 없고 20자를 넘겨 쓸 수 없다', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch(entry())
    render(<StudioScreen />)

    const dialog = await openRename(user)
    const input = within(dialog).getByRole('textbox', { name: '모델 이름' })
    const save = within(dialog).getByRole('button', { name: '바꾸기' })
    expect(input).toHaveValue('내 모델')
    expect(input).toHaveFocus()
    expect(within(dialog).getByText('4/20')).toBeInTheDocument()
    // 그대로
    expect(save).toBeDisabled()
    // 앞뒤 공백만 붙여도 그대로다
    await user.type(input, '  ')
    expect(save).toBeDisabled()
    // 비었거나 공백뿐
    await user.clear(input)
    expect(save).toBeDisabled()
    await user.type(input, '   {Enter}')
    expect(save).toBeDisabled()
    // 20자를 넘겨 쓸 수 없다
    await user.clear(input)
    await user.type(input, '가'.repeat(25))
    expect(input).toHaveValue('가'.repeat(20))
    expect(within(dialog).getByText('20/20')).toBeInTheDocument()
    expect(save).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(patchCalls(fetch)).toHaveLength(0)
  })

  it('Enter로 바꾸면 앞뒤 공백을 뺀 이름을 보내고, 카드·큰 제목을 다시 받지 않고 고친다', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch([
      ...entry(),
      [
        'PATCH',
        '/face-models/fm-1',
        ok({ faceModelId: 'fm-1', title: '웃는 얼굴', updatedAt: '2026-10-27T01:00:00Z' }),
      ],
    ])
    render(<StudioScreen />)

    const dialog = await openRename(user)
    const input = within(dialog).getByRole('textbox', { name: '모델 이름' })
    await user.clear(input)
    await user.type(input, '  웃는 얼굴  {Enter}')

    expect(await screen.findByRole('heading', { name: '웃는 얼굴' })).toBeInTheDocument()
    expect(shelfTile(/웃는 얼굴/)).toBeInTheDocument()
    expect(toastMessages()).toContain('이름을 바꿨어요')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const [[url, init]] = patchCalls(fetch)
    expect(String(url)).toMatch(/\/api\/v1\/face-models\/fm-1$/)
    expect(JSON.parse(String(init?.body))).toEqual({ title: '웃는 얼굴' })
    // 목록을 다시 받지 않는다
    expect(callsTo(fetch, '/face-models?')).toHaveLength(1)

    // 다시 열면 바뀐 이름으로 채워져 있다
    const again = await openRename(user)
    expect(within(again).getByRole('textbox', { name: '모델 이름' })).toHaveValue('웃는 얼굴')
  })

  it('400(COMMON_001)이면 창 안에 서버 문구를 보이고 이름을 그대로 둔다', async () => {
    const user = userEvent.setup()
    routeFetch([
      ...entry(),
      ['PATCH', '/face-models/fm-1', fail(400, 'COMMON_001', '이름은 1~20자로 입력해 주세요.')],
    ])
    render(<StudioScreen />)

    const dialog = await openRename(user)
    const input = within(dialog).getByRole('textbox', { name: '모델 이름' })
    await user.clear(input)
    await user.type(input, '새 이름')
    await user.click(within(dialog).getByRole('button', { name: '바꾸기' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '이름은 1~20자로 입력해 주세요.',
    )
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog', { name: '모델 이름 바꾸기' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '내 모델' })).toBeInTheDocument()
  })

  it('404(그사이 지워졌거나 남의 것)면 창을 닫고 알린 뒤 목록을 다시 받는다', async () => {
    const user = userEvent.setup()
    const fetch = routeFetch([
      ...entry(),
      ['PATCH', '/face-models/fm-1', fail(404, 'COMMON_002', '리소스를 찾을 수 없어요.')],
      ['GET', '/face-models?', ok(page([secondHead]))],
      ['GET', '/reconstructions/current', ok(null)],
      ['GET', '/simulations?', ok(page([]))],
      ['GET', '/face-models/fm-2', detail('fm-2')],
    ])
    render(<StudioScreen />)

    const dialog = await openRename(user)
    const input = within(dialog).getByRole('textbox', { name: '모델 이름' })
    await user.clear(input)
    await user.type(input, '새 이름{Enter}')

    expect(await screen.findByRole('heading', { name: '내 모델 2' })).toBeInTheDocument()
    expect(toastMessages()).toContain('이미 삭제된 모델이에요.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(callsTo(fetch, '/face-models?')).toHaveLength(2))
  })
})

describe('시안 보드 모델 이름(refine.css, -798)', () => {
  it('띄어쓰기 없는 긴 이름도 칸 끝에서 줄을 바꾼다(카드 줄을 덮지 않게)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/layout/refine.css'), 'utf8')
    const rule = css.slice(css.indexOf('.pf-board-head h3 {'), css.indexOf('.pf-board-head p {'))
    // 한글은 단어 단위로 끊고, 끊을 곳이 없는 긴 단어만 칸 끝에서 끊는다
    expect(rule).toContain('word-break: keep-all;')
    expect(rule).toContain('overflow-wrap: anywhere;')
  })
})
