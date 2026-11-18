import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.fn()
vi.mock('@/shared/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/Toast')>()),
  toast: (...args: unknown[]) => toast(...args),
}))

// 휴대폰·태블릿 여부는 기기 정보로 가른다(S15P31B204-892). 기본은 PC
let mobile = false
vi.mock('@/features/capture/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/capture/device')>()),
  isMobileDevice: () => mobile,
}))

const { ShareSheet, COPIED_MESSAGE } = await import('./ShareSheet')
const { latestLegalPath } = await import('@/features/legal/documents')

type Handler = () => { status?: number; data?: unknown; error?: unknown }
let routes: Record<string, Handler>
const URL_1 = 'https://preface.example/s/tok1'

beforeAll(() => {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function share(id: string, revokedAt: string | null = null) {
  return {
    shareId: id,
    createdAt: '2026-11-04T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    revokedAt,
  }
}

beforeEach(() => {
  toast.mockReset()
  mobile = false
  let list = [share('a')]
  routes = {
    'GET /simulations/s1/shares': () => ({ data: list }),
    'POST /simulations/s1/shares': () => {
      list = [share('b'), ...list]
      return {
        status: 201,
        data: { shareId: 'b', shareUrl: URL_1, expiresAt: '2099-01-01T00:00:00Z' },
      }
    },
    'DELETE /shares/a': () => {
      list = list.map((s) => (s.shareId === 'a' ? share('a', '2026-11-04T01:00:00Z') : s))
      return { status: 204 }
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const key = `${init?.method ?? 'GET'} ${url.pathname.replace(/^.*\/api\/v1/, '')}`
      const handler = routes[key]
      if (!handler) throw new Error(`라우트 없음: ${key}`)
      const { status = 200, data, error } = handler()
      return {
        ok: status < 400,
        status,
        json: async () =>
          error
            ? { success: false, data: null, error }
            : { success: true, data: data ?? null, error: null },
      }
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'share')
})

function open(hasChanges = true) {
  return render(<ShareSheet open onClose={() => {}} simulationId="s1" hasChanges={hasChanges} />)
}

describe('ShareSheet', () => {
  it('빈 시안이면 링크를 만들 수 없다', async () => {
    open(false)
    expect(await screen.findByText('변경한 뒤 공유할 수 있어요')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('안내 문구를 보인다', async () => {
    open()
    expect(
      await screen.findByText(/링크를 받은 사람은 로그인 없이 원래 얼굴과 결과 3D를 볼 수 있어요/),
    ).toBeTruthy()
    // 끝내는 방법을 구체적으로 알린다(어디서 무엇을 누르는지)
    expect(
      screen.getByText(
        /7일 뒤 자동으로 닫혀요\. 그 전에 끝내려면 이 창의 공유 중인 링크에서 공유 끝내기를 누르세요/,
      ),
    ).toBeTruthy()
  })

  it('휴대폰에서 링크를 만들면 공유하기와 링크 복사가 나온다', async () => {
    mobile = true
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByRole('button', { name: '링크 복사' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '공유하기' })).toBeTruthy()
  })

  it('링크를 만들면 목록이 새로고침된다', async () => {
    open()
    expect(await screen.findByText('공유 중인 링크 1개')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByText('공유 중인 링크 2개')).toBeTruthy()
  })

  // Windows 등 PC의 OS 공유 창은 카카오톡 PC 앱으로 이어져 헷갈린다(S15P31B204-892)
  it('PC는 공유 기능이 있어도 링크 복사만 보인다', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    expect(screen.queryByRole('button', { name: '공유하기' })).toBeNull()
  })

  it('휴대폰이라도 공유 기능이 없는 브라우저는 복사만 보인다', async () => {
    mobile = true
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    expect(screen.queryByRole('button', { name: '공유하기' })).toBeNull()
  })

  it('링크를 복사하면 붙여 넣어 보내라고 버튼 아래에 알린다', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    expect(screen.queryByText(COPIED_MESSAGE)).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '링크 복사' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      '링크를 복사했어요. 카톡이나 메시지에 붙여 넣어 보내세요.',
    )
    expect(writeText).toHaveBeenCalledWith(URL_1)
    expect(toast).not.toHaveBeenCalled()
  })

  it('복사하지 못하면 알리고 복사 안내는 보이지 않는다', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    fireEvent.click(await screen.findByRole('button', { name: '링크 복사' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('복사하지 못했어요. 다시 시도해 주세요'))
    expect(screen.queryByText(COPIED_MESSAGE)).toBeNull()
  })

  it('공유 창을 닫아도 오류를 띄우지 않는다', async () => {
    const shareFn = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError')
    })
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
    mobile = true
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    const shareButton = await screen.findByRole('button', { name: '공유하기' })
    await act(async () => {
      fireEvent.click(shareButton)
    })
    expect(shareFn).toHaveBeenCalledWith({ title: 'Preface 시안', url: URL_1 })
    expect(toast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '링크 복사' })).toBeTruthy()
  })

  it('동의가 없으면 동의 안내와 동의서 링크를 보인다', async () => {
    routes['POST /simulations/s1/shares'] = () => ({
      status: 409,
      error: { code: 'SHR_003', message: '공유하려면 얼굴 데이터 공개 동의가 필요해요' },
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByText('공유하려면 얼굴 데이터 공개 동의가 필요해요')).toBeTruthy()
    expect(screen.getByRole('link', { name: '동의서 보기' }).getAttribute('href')).toBe(
      latestLegalPath('face-public'),
    )
    expect(latestLegalPath('face-public')).toMatch(/^\/legal\/face-public\/\d{4}-\d{2}-v\d+$/)
  })

  it('방금 만든 링크의 공유를 끝내면 복사 버튼을 거두고 새 링크를 만들 수 있다', async () => {
    routes['DELETE /shares/b'] = () => ({ status: 204 })
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    const endButtons = await screen.findAllByRole('button', { name: '공유 끝내기' })
    fireEvent.click(endButtons[0])
    expect(await screen.findByRole('button', { name: '링크 만들기' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '링크 복사' })).toBeNull()
  })

  // S15P31B204-842: 편집 저장이 끝나기 전에 만들면 서버가 저장 전 상태를 스냅숏으로 떠서, 받은 사람에게 바꾼 얼굴이 안 보였다
  it('조절을 저장하는 중에는 링크를 만들지 않고, 저장이 끝나면 만들 수 있다', async () => {
    const post = vi.fn(routes['POST /simulations/s1/shares'])
    routes['POST /simulations/s1/shares'] = post
    const view = render(<ShareSheet open onClose={() => {}} simulationId="s1" hasChanges saving />)
    const button = (await screen.findByRole('button', { name: '링크 만들기' })) as HTMLButtonElement
    expect(screen.getByText(/저장하는 중이에요/)).toBeTruthy()
    fireEvent.click(button)
    await act(async () => {})
    expect(post).not.toHaveBeenCalled()

    view.rerender(
      <ShareSheet open onClose={() => {}} simulationId="s1" hasChanges saving={false} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByRole('button', { name: '링크 복사' })).toBeTruthy()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('씌워 둔 헤어를 공유에 함께 보낸다', async () => {
    let body: unknown = 'none'
    const fetchMock = vi.mocked(fetch)
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'POST') body = init.body ? JSON.parse(String(init.body)) : undefined
      return original(input, init)
    })
    render(<ShareSheet open onClose={() => {}} simulationId="s1" hasChanges hairId="dandy" />)
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByRole('button', { name: '링크 복사' })).toBeTruthy()
    expect(body).toEqual({ hairAssetId: 'dandy' })
  })

  it('공유 끝내기를 누르면 목록에서 닫힌다', async () => {
    open()
    expect(await screen.findByText('공유 중인 링크 1개')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '공유 끝내기' }))
    expect(await screen.findByText('공유 중인 링크 0개')).toBeTruthy()
  })

  function postBodies() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => init?.body)
  }

  it('보내는 사람 이름은 비어 있고 누구에게 보이는지 알린다', async () => {
    open()
    const input = (await screen.findByLabelText(
      '받는 사람에게 보일 이름 (선택)',
    )) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.getByText(/링크를 받은 사람 모두에게 보여요/)).toBeTruthy()
  })

  it('이름을 적지 않으면 본문 없이 만든다', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    expect(postBodies()).toEqual([undefined])
  })

  it('적은 이름은 앞뒤 공백을 지워 보낸다', async () => {
    open()
    fireEvent.change(await screen.findByLabelText('받는 사람에게 보일 이름 (선택)'), {
      target: { value: '  지은  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    expect(postBodies().map((b) => JSON.parse(String(b)))).toEqual([{ senderName: '지은' }])
  })

  it('20자를 넘는 이름은 만들 수 없다', async () => {
    open()
    fireEvent.change(await screen.findByLabelText('받는 사람에게 보일 이름 (선택)'), {
      target: { value: '가'.repeat(21) },
    })
    expect(screen.getByText('이름은 20자까지 쓸 수 있어요')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  const NAME_LABEL = '받는 사람에게 보일 이름 (선택)'

  it('이름 칸은 20자에서 더 쳐지지 않고, 20자를 채우면 안내한다', async () => {
    open()
    const input = (await screen.findByLabelText(NAME_LABEL)) as HTMLInputElement
    expect(input).toHaveAttribute('maxLength', '20')
    expect(screen.queryByText('최대 20자까지 쓸 수 있어요')).toBeNull()
    fireEvent.change(input, { target: { value: '가'.repeat(20) } })
    expect(screen.getByText('최대 20자까지 쓸 수 있어요')).toBeTruthy()
    expect(input).toHaveAttribute('maxLength', '20')
    expect(
      (screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('쓸 수 없는 문자를 넣으면 바로 알리고 링크를 만들지 않는다', async () => {
    open()
    fireEvent.change(await screen.findByLabelText(NAME_LABEL), {
      target: { value: '지​은' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('이름에 쓸 수 없는 문자가 있어요')
    expect(
      (screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('20자를 넘게 붙이면 자르지 않고 20자 안내와 함께 막는다', async () => {
    open()
    const input = (await screen.findByLabelText(NAME_LABEL)) as HTMLInputElement
    fireEvent.paste(input, { clipboardData: { getData: () => '가'.repeat(25) } })
    expect(input.value).toBe('가'.repeat(25))
    expect(screen.getByRole('alert')).toHaveTextContent('이름은 20자까지 쓸 수 있어요')
    expect(
      (screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('서버가 이름을 거절하면(COMMON_001) 일반 오류가 아니라 입력 옆에 알린다', async () => {
    routes['POST /simulations/s1/shares'] = () => ({
      status: 400,
      error: { code: 'COMMON_001', message: '요청 값이 올바르지 않아요' },
    })
    open()
    const input = await screen.findByLabelText(NAME_LABEL)
    fireEvent.change(input, { target: { value: '지은' } })
    fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }))
    expect(await screen.findByText('이름에 쓸 수 없는 문자가 있어요')).toBeTruthy()
    expect(screen.queryByText('링크를 만들지 못했어요. 다시 시도해 주세요')).toBeNull()
    expect(toast).not.toHaveBeenCalled()
    // 이름을 고치면 안내를 거둔다
    fireEvent.change(input, { target: { value: '지은이' } })
    expect(screen.queryByText('이름에 쓸 수 없는 문자가 있어요')).toBeNull()
  })

  it('헤어와 이름을 한 본문에 함께 보낸다', async () => {
    render(<ShareSheet open onClose={() => {}} simulationId="s1" hasChanges hairId="dandy" />)
    fireEvent.change(await screen.findByLabelText(NAME_LABEL), { target: { value: '지은' } })
    fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }))
    await screen.findByRole('button', { name: '링크 복사' })
    expect(postBodies().map((b) => JSON.parse(String(b)))).toEqual([
      { hairAssetId: 'dandy', senderName: '지은' },
    ])
  })
})
