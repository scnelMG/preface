import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const viewerProps: Record<string, unknown>[] = []
vi.mock('@/features/viewer/FaceViewerLoader', () => ({
  FaceViewer: (props: Record<string, unknown>) => {
    viewerProps.push(props)
    return (
      <div
        data-testid="viewer"
        data-showing={String(props.showing)}
        data-mesh={String(props.meshUrl)}
      />
    )
  },
}))

const { SharedViewer } = await import('./SharedViewer')

const NOW = new Date('2026-11-20T00:00:00Z').getTime()
const EYE = {
  L: {
    enabled: true,
    style: 'inout',
    values: { height: 30, crease: 65, inner: 0, outer: 0, lower: 0, upper: 0 },
    curve: [0.1, 0.1, 0.1, 0.1, 0.1],
  },
  R: {
    enabled: false,
    style: 'inout',
    values: { height: 20, crease: 65, inner: 0, outer: 0, lower: 0, upper: 0 },
    curve: [0.1, 0.1, 0.1, 0.1, 0.1],
  },
}

type Reply = { status?: number; data?: unknown; error?: unknown }
let replies: Reply[]
let calls = 0

function view(mesh: string, overrides: Record<string, unknown> = {}) {
  return {
    meshUrl: mesh,
    rigUrl: 'https://signed/rig',
    textureUrl: null,
    meshFormat: 'GLB',
    morphState: {
      schemaVersion: 'v1',
      weights: { 'nose.bridge_height': 0.3 },
      pointStrokes: [{ vertex: 12, delta: [0.1, 0, 0] }],
      eyeEdit: EYE,
    },
    eyeReview: { L: 'absent', R: 'present' },
    hair: null,
    expiresAt: new Date(NOW + 7 * 86_400_000).toISOString(),
    urlExpiresAt: new Date(NOW + 600_000).toISOString(),
    ...overrides,
  }
}

const UNAVAILABLE: Reply = {
  status: 404,
  error: { code: 'SHR_001', message: '링크가 만료되었거나 공유가 끝났어요' },
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  viewerProps.length = 0
  calls = 0
  replies = [{ data: view('https://signed/mesh-1') }]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname.replace(/^.*\/api\/v1/, '')
      if (path !== '/shares/tok') throw new Error(`라우트 없음: ${path}`)
      if (new Headers(init?.headers).has('Authorization')) throw new Error('로그인 토큰을 붙였다')
      const reply = replies[Math.min(calls, replies.length - 1)]
      calls++
      const { status = 200, data, error } = reply
      return {
        ok: status < 400,
        status,
        json: async () =>
          error ? { success: false, data: null, error } : { success: true, data, error: null },
      }
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function last() {
  return viewerProps[viewerProps.length - 1]
}

describe('SharedViewer', () => {
  it('바꾼 얼굴을 기본으로 보여 주고 원래 얼굴로 바꿀 수 있다', async () => {
    render(<SharedViewer token="tok" />)
    expect((await screen.findByTestId('viewer')).dataset.showing).toBe('after')
    expect(screen.getByRole('tab', { name: '바꾼 얼굴' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('tab', { name: '원래 얼굴' }))
    expect(screen.getByTestId('viewer').dataset.showing).toBe('before')
  })

  it('가운데 제목과 비교 조절을 보이고, 정면·측면 버튼은 없다(S15P31B204-892)', async () => {
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(screen.getByRole('heading', { level: 1, name: '공유받은 시안' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: '비교' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '보는 방향' })).toBeNull()
    expect(screen.queryByText('정면')).toBeNull()
    expect(screen.queryByText('측면')).toBeNull()
    // 카메라는 예전 기본 시점(정면)에 고정한다
    expect(last().view).toEqual({ preset: 'front', nonce: 0 })
  })

  // 받은 사람 화면에서 원래·바꾼 얼굴이 같아 보인다는 제보 확인(S15P31B204-892).
  // 뷰어는 한 벌의 가중치를 받아 After에만 입히고 Before는 늘 0으로 고정한다(FaceViewer). 그래서 공유 화면이 할 일은
  // 스냅숏 값을 빠짐없이 넘기고 showing만 바꾸는 것이다
  it('바꾼 값을 그대로 뷰어에 넘기고, 원래 얼굴로 바꿔도 값은 두고 showing만 바꾼다', async () => {
    replies = [
      {
        data: view('https://signed/mesh-1', {
          morphState: {
            schemaVersion: 'v1',
            weights: { 'nose.bridge_height': 1, 'contour.chin_length': 1, 'eye.size': 0.4 },
            pointStrokes: [],
            eyeEdit: null,
          },
          eyeReview: null,
        }),
      },
    ]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    // 막은 눈 가중치(eye.*)만 빠지고 코·윤곽 값은 1 그대로 간다
    const edited = { 'nose.bridge_height': 1, 'contour.chin_length': 1 }
    expect(last().showing).toBe('after')
    expect(last().weights).toEqual(edited)
    fireEvent.click(screen.getByRole('tab', { name: '원래 얼굴' }))
    expect(last().showing).toBe('before')
    expect(last().weights).toEqual(edited)
    expect(last().eyeEdit).toBeUndefined()
    fireEvent.click(screen.getByRole('tab', { name: '바꾼 얼굴' }))
    expect(last().showing).toBe('after')
  })

  it('편집 props를 넘기지 않는다', async () => {
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    const props = last()
    expect(props.weights).toEqual({ 'nose.bridge_height': 0.3 })
    expect(props.pointStrokes).toHaveLength(1)
    expect(props.layout).toBe('single')
    for (const key of [
      'pointEditEnabled',
      'noseHandleControls',
      'onNoseHandleDrag',
      'onNoseHandleCommit',
    ])
      expect(props[key]).toBeUndefined()
    expect(props.eyeEdit).toEqual({ state: EYE, review: { L: 'absent', R: 'present' } })
  })

  it('눈 판정이 없으면 eyeEdit을 넘기지 않는다', async () => {
    replies = [{ data: view('https://signed/mesh-1', { eyeReview: null }) }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(last().eyeEdit).toBeUndefined()
  })

  it('없는 링크면 만료 화면이다', async () => {
    replies = [UNAVAILABLE]
    render(<SharedViewer token="tok" />)
    expect(await screen.findByText('링크가 만료되었거나 공유가 끝났어요')).toBeTruthy()
    expect(screen.queryByTestId('viewer')).toBeNull()
  })

  it('열어 둔 동안 공유가 살아 있는지 확인하되 3D 주소는 바꾸지 않는다', async () => {
    replies = [{ data: view('https://signed/mesh-1') }, { data: view('https://signed/mesh-2') }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(calls).toBe(1)
    const rendersBefore = viewerProps.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(540_000)
    })
    expect(calls).toBe(2)
    expect(screen.getByTestId('viewer').dataset.mesh).toBe('https://signed/mesh-1')
    expect(viewerProps.length).toBe(rendersBefore)
  })

  it('기기 시계가 어긋나거나 만료 시각이 이상해도 자주 부르지 않는다', async () => {
    vi.setSystemTime(NOW + 3_600_000)
    replies = [{ data: view('https://signed/mesh-1', { urlExpiresAt: 'not-a-date' }) }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(calls).toBe(1)
  })

  it('다시 받을 때 SHR_001이면 만료 화면이다', async () => {
    replies = [{ data: view('https://signed/mesh-1') }, UNAVAILABLE]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(540_000)
    })
    expect(screen.getByText('링크가 만료되었거나 공유가 끝났어요')).toBeTruthy()
  })

  // S15P31B204-842: 편집실에서 씌운 웹 헤어를 원래 얼굴·결과 모두에 씌운다(뷰어가 Before·After 둘 다에 붙인다)
  it('공유 시점 웹 헤어를 씌우고, 원래 얼굴로 바꿔도 그대로 둔다', async () => {
    replies = [{ data: view('https://signed/mesh-1', { hairAssetId: 'dandy' }) }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(last().hairUrl).toMatch(/\/hair\/dandy\.glb$/)
    fireEvent.click(screen.getByRole('tab', { name: '원래 얼굴' }))
    expect(last().showing).toBe('before')
    expect(last().hairUrl).toMatch(/\/hair\/dandy\.glb$/)
  })

  it('헤어가 없거나 목록에 없는 헤어면 씌우지 않는다', async () => {
    replies = [{ data: view('https://signed/mesh-1', { hairAssetId: 'gone-cut' }) }]
    const first = render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(last().hairUrl).toBeNull()
    first.unmount()

    replies = [{ data: view('https://signed/mesh-1') }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(last().hairUrl).toBeNull()
  })

  it('고지 문구와 내 얼굴로 만들어 보기 버튼이 있다', async () => {
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(screen.getByText(/참고용 시뮬레이션이라 실제 결과와 다를 수 있어요/)).toBeTruthy()
    expect(screen.getByText(/의사 상담이 필요해요/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '내 얼굴로 만들어 보기' }).getAttribute('href')).toBe(
      '/',
    )
    // 카드 설명은 얼굴을 직접 바꿔 볼 수 있다고 알린다
    expect(screen.getByRole('complementary', { name: 'Preface 시작하기' }).textContent).toContain(
      '코·눈·윤곽을 직접 바꿔 볼 수 있어요',
    )
  })

  it('위에 로고를 두되 누를 수 있는 링크가 아니다(S15P31B204-841)', async () => {
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    const logo = screen.getByText('preface')
    expect(logo.closest('a')).toBeNull()
    expect(logo.closest('header')).toBeTruthy()
    // 링크는 "내 얼굴로 만들어 보기" 하나뿐이다
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('없는 링크 화면에도 로고가 있고 링크가 아니다', async () => {
    replies = [UNAVAILABLE]
    render(<SharedViewer token="tok" />)
    await screen.findByText('링크가 만료되었거나 공유가 끝났어요')
    expect(screen.getByText('preface').closest('a')).toBeNull()
    expect(screen.getByRole('link', { name: '내 얼굴로 만들어 보기' }).getAttribute('href')).toBe(
      '/',
    )
  })

  it('링크가 닫히는 시각을 서울 시간으로 보인다', async () => {
    // NOW + 7일 = 2026-11-27T00:00Z = 서울 11월 27일 오전 9시
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(screen.getByText('11월 27일 오전 9시에 링크가 닫혀요')).toBeTruthy()
  })

  it('만료 시각을 읽을 수 없으면 문구를 뺀다', async () => {
    replies = [{ data: view('https://signed/mesh-1', { expiresAt: 'not-a-date' }) }]
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(screen.queryByText(/링크가 닫혀요/)).toBeNull()
  })

  it('오른쪽 버튼 이동을 켜고 조작 안내 세 가지를 보인다', async () => {
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(last().enablePan).toBe(true)
    expect(last().rotationOnly).toBeUndefined()
    for (const label of ['드래그 회전', '스크롤 확대', '오른쪽 버튼으로 끌어 이동'])
      expect(screen.getByText(label)).toBeTruthy()
    // 터치 안내도 그려 두고 (pointer: coarse)에서만 보인다
    expect(screen.getByText('두 손가락 확대·이동')).toBeTruthy()
  })

  it('보내는 사람 이름이 있으면 위에 보이고 없으면 보이지 않는다', async () => {
    replies = [{ data: view('https://signed/mesh-1', { senderName: '지은' }) }]
    const { unmount } = render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    // 가운데 큰 제목(h1)으로 보인다
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('지은님이 보낸 시안')
    expect(screen.getByText('님이 보낸 시안', { exact: false }).textContent).toBe(
      '지은님이 보낸 시안',
    )
    unmount()

    replies = [{ data: view('https://signed/mesh-1', { senderName: null }) }]
    calls = 0
    render(<SharedViewer token="tok" />)
    await screen.findByTestId('viewer')
    expect(screen.queryByText('님이 보낸 시안', { exact: false })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('공유받은 시안')
  })
})
