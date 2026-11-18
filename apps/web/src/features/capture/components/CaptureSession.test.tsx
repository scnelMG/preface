import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorCode } from '@/shared/api/errorCodes'
import { clearAccessToken, getAccessToken, getScope } from '@/shared/api/tokenStore'
import { POLICY_RESPONSE } from '@/features/upload/testing'
import { __resetCaptureSession, useCaptureSessionStore } from '../store'
import { EXCHANGE_OK, failResponse, okResponse } from '../testing'
import { stubLiveCaptureSupport } from '@/features/live-capture/testing'
import { CaptureSession } from './CaptureSession'

vi.mock('@/features/live-capture/LiveCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/live-capture/LiveCapture')>()
  const { FakeLiveCapture } = await import('@/features/live-capture/testing')
  return { ...actual, LiveCapture: FakeLiveCapture }
})

function openWith(hash: string) {
  window.history.replaceState(null, '', `/m/capture${hash}`)
}

/** 정책 조회(API-CAP-02)를 뺀 API 응답. 테스트가 넣은 순서대로 답한다 */
const server = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

function fetchCalls() {
  return server.mock.calls.map(([input, init]) => ({
    url: String(input),
    method: init?.method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    headers: init?.headers as Record<string, string>,
  }))
}

describe('SCR-17① 휴대폰 연결 확인', () => {
  beforeEach(() => {
    __resetCaptureSession()
    clearAccessToken()
    server.mockReset()
    // 연결 뒤 나가는 정책 조회(API-CAP-02)는 따로 답하고, 나머지는 server가 넣은 순서대로 답한다
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/uploads/policy')
          ? Promise.resolve(okResponse(POLICY_RESPONSE))
          : server(input, init),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('연결 확인 화면에는 영상 길이 안내를 두지 않는다(S15P31B204-770)', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    await screen.findByRole('heading', { name: '민서님 계정으로 촬영해요' })
    expect(screen.queryByText(/영상은 .*초 이상/)).not.toBeInTheDocument()
    expect(screen.queryByText(/권장/)).not.toBeInTheDocument()
  })

  it('fragment 토큰을 교환하고 연결된 계정을 보여 준다', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    expect(
      await screen.findByRole('heading', { name: '민서님 계정으로 촬영해요' }),
    ).toBeInTheDocument()
    expect(screen.getByText('m***@kakao.com')).toBeInTheDocument()
    expect(screen.getByText('연결은 30분 동안 유지돼요')).toBeInTheDocument()
    expect(screen.getByText('PC와 연결됨')).toBeInTheDocument()

    const [call] = fetchCalls()
    expect(call.url).toContain('/capture-links/exchange')
    expect(call.method).toBe('POST')
    expect(call.body).toEqual({ token: 'qr-token' })
    // 인증 없이 부른다
    expect(call.headers.Authorization).toBeUndefined()
    // 세션 토큰은 메모리 보관소에 capture scope로 들어간다
    expect(getAccessToken()).toBe('capture-session-token')
    expect(getScope()).toBe('capture')
    // 주소창에서 토큰을 지웠다
    expect(window.location.hash).toBe('')
  })

  it('StrictMode에서 effect가 두 번 돌아도 토큰은 한 번만 교환한다', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValue(okResponse(EXCHANGE_OK))

    render(
      <StrictMode>
        <CaptureSession />
      </StrictMode>,
    )

    await screen.findByRole('heading', { name: '민서님 계정으로 촬영해요' })
    expect(fetchCalls()).toHaveLength(1)
  })

  it('maskedEmail이 없으면 닉네임을 보여 준다', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(
      okResponse({ ...EXCHANGE_OK, user: { nickname: '민서', maskedEmail: null } }),
    )

    render(<CaptureSession />)

    expect(await screen.findByText('민서님')).toBeInTheDocument()
  })

  it('토큰 없이 열면(새로고침 등) 교환하지 않고 QR을 다시 스캔하라고 한다', async () => {
    openWith('')

    render(<CaptureSession />)

    expect(
      await screen.findByRole('heading', { name: 'QR을 다시 스캔해 주세요' }),
    ).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByText('PC와 연결됨')).not.toBeInTheDocument()
  })

  it.each([
    [410, ErrorCode.QR_EXPIRED, 'QR이 만료됐어요'],
    [409, ErrorCode.QR_ALREADY_CONNECTED, '이미 연결된 QR이에요'],
    [403, ErrorCode.CAPTURE_SCOPE_FORBIDDEN, '연결이 끝났어요'],
    [500, ErrorCode.INTERNAL_ERROR, '연결하지 못했어요'],
  ])('교환 실패 %s %s → "%s"', async (status, code, title) => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(failResponse(status, code))

    render(<CaptureSession />)

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
    // 실패해도 토큰은 주소창에서 지운다
    expect(window.location.hash).toBe('')
  })

  it('네트워크 실패면 같은 토큰으로 다시 시도할 수 있다', async () => {
    openWith('#t=qr-token')
    server
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '다시 시도' }))

    expect(
      await screen.findByRole('heading', { name: '민서님 계정으로 촬영해요' }),
    ).toBeInTheDocument()
    expect(fetchCalls().map((c) => c.body)).toEqual([{ token: 'qr-token' }, { token: 'qr-token' }])
  })

  it('"내 계정이 아니에요"는 연결을 끊고 세션 토큰을 버린다', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK)).mockResolvedValueOnce(okResponse({}))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '내 계정이 아니에요' }))

    expect(await screen.findByRole('heading', { name: '연결을 끊었어요' })).toBeInTheDocument()
    const disconnect = fetchCalls()[1]
    expect(disconnect.method).toBe('DELETE')
    expect(disconnect.url).toContain('/capture-links/lk-1')
    // 업로드 전용 세션 토큰으로 끊는다
    expect(disconnect.headers.Authorization).toBe('Bearer capture-session-token')
    expect(getAccessToken()).toBeNull()
  })

  it('끊기 요청이 실패해도 휴대폰 쪽 세션은 버린다', async () => {
    openWith('#t=qr-token')
    server
      .mockResolvedValueOnce(okResponse(EXCHANGE_OK))
      .mockResolvedValueOnce(failResponse(403, ErrorCode.CAPTURE_SCOPE_FORBIDDEN))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '내 계정이 아니에요' }))

    expect(await screen.findByRole('heading', { name: '연결을 끊었어요' })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('같은 기기에서 바로 왔으면(-457) 계정 확인 없이 촬영 가이드로 가고 PC 연결 표시를 하지 않는다', async () => {
    openWith('#t=qr-token&self=1')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    await waitFor(() => expect(useCaptureSessionStore.getState().step).toBe('guide'))
    expect(screen.queryByRole('button', { name: '계속' })).not.toBeInTheDocument()
    expect(screen.queryByText('PC와 연결됨')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('')
  })

  it('계속을 누르면 촬영 가이드 단계로 간다', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))

    await waitFor(() => expect(useCaptureSessionStore.getState().step).toBe('guide'))
  })

  it('휴대폰 종류를 묻지 않고 브라우저 정보로 판별해 보여 준다(안드로이드·기타 → 갤럭시, -442)', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    expect(await screen.findByText('갤럭시(안드로이드)로 인식했어요')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '어떤 휴대폰으로 찍나요?' })).not.toBeInTheDocument()
    expect(useCaptureSessionStore.getState().device).toBe('android')
  })

  it('아이폰 브라우저면 아이폰으로 인식하고 아이폰 촬영 방법을 안내한다', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    expect(await screen.findByText('아이폰으로 인식했어요')).toBeInTheDocument()
    expect(screen.queryByText(/사진 보관함/)).not.toBeInTheDocument()
  })

  it('아이폰이면 연결 확인에서는 기종을 묻지 않고, 영상 촬영하기를 누르면 시트로 고른다(-635)', async () => {
    polyfillDialog()
    const restore = stubLiveCaptureSupport()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))
    expect(screen.queryByRole('radiogroup', { name: '아이폰 기종' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    expect(useCaptureSessionStore.getState().step).toBe('guide')
    // 기본은 모름(보내지 않음)
    expect(screen.getByRole('radio', { name: '모름' })).toBeChecked()
    // 세대별 줄(-756): 17 줄은 대표 이름 "iPhone 17"을 보낸다
    await userEvent.click(screen.getByRole('radio', { name: 'iPhone 17' }))
    await userEvent.click(screen.getByRole('button', { name: '이 기종으로 촬영하기' }))

    expect(useCaptureSessionStore.getState().deviceModel).toBe('iPhone 17')
    expect(useCaptureSessionStore.getState().step).toBe('recording')
    restore()
  })

  it('안드로이드는 기종을 묻지 않고 브라우저 정보로 읽는다', async () => {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { getHighEntropyValues: async () => ({ model: 'SM-S921N' }) },
    })
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)

    await screen.findByText('갤럭시(안드로이드)로 인식했어요')
    expect(screen.queryByRole('radiogroup', { name: '아이폰 기종' })).not.toBeInTheDocument()
    await waitFor(() => expect(useCaptureSessionStore.getState().deviceModel).toBe('SM-S921N'))
    Reflect.deleteProperty(navigator, 'userAgentData')
  })

  it('같은 기기 아이폰도 영상 촬영하기를 누르면 시트로 기종을 고른다', async () => {
    polyfillDialog()
    const restore = stubLiveCaptureSupport()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
    openWith('#t=qr-token&self=1')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    await userEvent.click(screen.getByRole('radio', { name: 'iPhone 17e' }))
    await userEvent.click(screen.getByRole('button', { name: '이 기종으로 촬영하기' }))

    expect(useCaptureSessionStore.getState().deviceModel).toBe('iPhone 17e')
    expect(useCaptureSessionStore.getState().step).toBe('recording')
    restore()
  })

  it('기종 시트를 닫으면 촬영 가이드에 남는다', async () => {
    polyfillDialog()
    const restore = stubLiveCaptureSupport()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
    openWith('#t=qr-token&self=1')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))

    expect(useCaptureSessionStore.getState().step).toBe('guide')
    expect(screen.queryByRole('radiogroup', { name: '아이폰 기종' })).not.toBeInTheDocument()
    restore()
  })

  it('잘못 인식했으면 아래 작은 링크로 반대 종류로 바꾸고, 고른 종류가 촬영 가이드로 이어진다(-882)', async () => {
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    expect(await screen.findByText('갤럭시(안드로이드)로 인식했어요')).toBeInTheDocument()
    // 눈에 띄는 바꾸기 버튼·고르기 묶음은 없다
    expect(screen.queryByRole('button', { name: '다르면 바꾸기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '어떤 휴대폰으로 찍나요?' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '아이폰을 쓰고 있나요?' }))
    expect(useCaptureSessionStore.getState().device).toBe('iphone')
    expect(screen.getByText('아이폰으로 인식했어요')).toBeInTheDocument()
    // 다시 누르면 돌아온다
    await userEvent.click(screen.getByRole('button', { name: '갤럭시(안드로이드)를 쓰고 있나요?' }))
    expect(useCaptureSessionStore.getState().device).toBe('android')
    await userEvent.click(screen.getByRole('button', { name: '아이폰을 쓰고 있나요?' }))

    await userEvent.click(screen.getByRole('button', { name: '계속' }))

    await waitFor(() =>
      expect(useCaptureSessionStore.getState()).toMatchObject({ step: 'guide', device: 'iphone' }),
    )
    // 바꾼 종류로 "찍기 전에 확인해요"를 먼저 본다
    expect(await screen.findByRole('button', { name: '확인했어요' })).toBeInTheDocument()
    // 연결 확인 화면을 지난 뒤에는 바꾸지 않는다
    useCaptureSessionStore.getState().setDevice('android')
    expect(useCaptureSessionStore.getState().device).toBe('iphone')
  })

  it('"찍기 전에 확인해요"는 녹화 화면에서 돌아와도, 종류를 바꿔도 다시 띄운다(-882)', async () => {
    const restore = stubLiveCaptureSupport()
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))

    // 촬영 준비 → 촬영 안내로 돌아오면 팝업을 다시 띄운다
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    await userEvent.click(await screen.findByRole('button', { name: '촬영 안내로 돌아가기' }))
    expect(await screen.findByRole('dialog', { name: '찍기 전에 확인해요' })).toHaveAttribute(
      'open',
    )
    await userEvent.click(screen.getByRole('button', { name: '확인했어요' }))

    // 종류를 바꿔도 촬영 안내에 들어오면 다시 본다. 바꿔서 건너뛸 수 없다
    act(() => {
      useCaptureSessionStore.setState({ step: 'confirm' })
      useCaptureSessionStore.getState().setDevice('iphone')
    })
    await userEvent.click(screen.getByRole('button', { name: '계속' }))
    expect(await screen.findByRole('dialog', { name: '찍기 전에 확인해요' })).toHaveAttribute(
      'open',
    )
    restore()
  })

  it('촬영 준비에서 체크한 "잘 들려요"는 촬영 안내로 돌아갔다 와도 남는다(-882)', async () => {
    const restore = stubLiveCaptureSupport()
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    expect(useCaptureSessionStore.getState().soundChecked).toBe(false)
    await userEvent.click(await screen.findByRole('checkbox', { name: '잘 들려요(테스트)' }))
    expect(useCaptureSessionStore.getState().soundChecked).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: '촬영 안내로 돌아가기' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))
    expect(await screen.findByRole('checkbox', { name: '잘 들려요(테스트)' })).toBeChecked()
    restore()
  })

  it('촬영 버튼은 파일 선택 없이 웹 촬영 화면을 연다(-619)', async () => {
    polyfillDialog()
    const restore = stubLiveCaptureSupport()
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))

    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
    await userEvent.click(await screen.findByRole('button', { name: '영상 촬영하기' }))

    expect(pick).not.toHaveBeenCalled()
    expect(await screen.findByText('실시간 촬영 화면(테스트)')).toBeInTheDocument()
    restore()
  })
})

describe('영상 파일 올리기 링크 없음·지원 안 되는 브라우저(-929)', () => {
  beforeEach(() => {
    __resetCaptureSession()
    clearAccessToken()
    server.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('/uploads/policy')
          ? Promise.resolve(okResponse(POLICY_RESPONSE))
          : server(input, init),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  async function openGuide() {
    polyfillDialog()
    openWith('#t=qr-token')
    server.mockResolvedValueOnce(okResponse(EXCHANGE_OK))
    render(<CaptureSession />)
    await userEvent.click(await screen.findByRole('button', { name: '계속' }))
    await userEvent.click(await screen.findByRole('button', { name: '확인했어요' }))
  }

  it('촬영 안내에 "영상 파일 올리기" 링크와 파일 선택 입력이 없다', async () => {
    const restore = stubLiveCaptureSupport()
    await openGuide()

    expect(screen.getByRole('button', { name: '영상 촬영하기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
    // 갤러리 버튼(-590)은 없앴다
    expect(screen.queryByRole('button', { name: '갤러리에서 고르기' })).not.toBeInTheDocument()
    restore()
  })

  it('웹 녹화를 못 하는 브라우저면 다른 브라우저로 열라는 안내만 보여 준다', async () => {
    // jsdom에는 getUserMedia·MediaRecorder가 없다
    await openGuide()

    expect(
      screen.getByText('이 브라우저에서는 촬영할 수 없어요. 최신 Safari나 Chrome으로 열어 주세요'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '영상 촬영하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '영상 파일 올리기' })).not.toBeInTheDocument()
  })
})

/** jsdom에는 <dialog>의 showModal·close가 없다(shared/ui/Modal.test.tsx와 같은 흉내) */
function polyfillDialog() {
  const proto = HTMLDialogElement.prototype
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
