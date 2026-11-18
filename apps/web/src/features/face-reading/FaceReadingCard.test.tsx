import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import { getFaceReading, getFaceReadingByJob, getFaceReadingPhoto, requestFaceReading } from './api'
import { listFaceModels } from '@/features/studio/api'
import { getFrontPhoto } from '@/features/edit/api'
import { Modal } from '@/shared/ui'
import { useAuthStore } from '@/features/auth/store'
import {
  FaceReadingCard,
  FRONT_PHOTO_ALT,
  FUN_NOTICE,
  PHOTO_ALT,
  THUMBNAIL_ALT,
} from './FaceReadingCard'
import type { FaceReading } from './types'
import { POLL_MS } from './useFaceReading'
import { clearFaceReadingPhotoCache, PHOTO_RETRY_MS } from './useFaceReadingPhoto'

vi.mock('./api', () => ({
  requestFaceReading: vi.fn(),
  getFaceReadingByJob: vi.fn(),
  getFaceReading: vi.fn(),
  getFaceReadingPhoto: vi.fn(),
}))
vi.mock('@/features/studio/api', () => ({ listFaceModels: vi.fn() }))
vi.mock('@/features/edit/api', () => ({ getFrontPhoto: vi.fn() }))

const byJob = vi.mocked(getFaceReadingByJob)
const byId = vi.mocked(getFaceReading)
const request = vi.mocked(requestFaceReading)
const photo = vi.mocked(getFaceReadingPhoto)
const heads = vi.mocked(listFaceModels)
const front = vi.mocked(getFrontPhoto)

function reading(overrides: Partial<FaceReading> = {}): FaceReading {
  return {
    readingId: 'reading-1',
    jobId: 'job-1',
    status: 'DONE',
    result: {
      title: '복이 들어오는 둥근 얼굴',
      parts: [{ part: 'NOSE', name: '코', reading: '콧방울이 단단해 재물을 지키는 상이에요.' }],
      overall: '전체적으로 부드러운 인상이에요.',
      advice: [{ part: 'CHIN', change: '턱끝을 조금 세우면', effect: '결단력이 더해 보여요' }],
    },
    createdAt: '2026-10-29T07:00:00Z',
    ...overrides,
  }
}

const notFound = () => new ApiError(404, { code: 'COMMON_002', message: '없음', details: [] })

beforeEach(() => {
  byJob.mockReset()
  byId.mockReset()
  request.mockReset()
  photo.mockReset()
  heads.mockReset()
  front.mockReset()
  // 정면 사진은 기본으로 없다(예전 3D). 쓰는 테스트만 바꾼다
  front.mockRejectedValue(notFound())
  // 받아 둔 관상 사진은 모듈에 남으니 테스트마다 비운다
  clearFaceReadingPhotoCache()
  photo.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }))
  // jsdom에는 blob 주소가 없다
  URL.createObjectURL = vi.fn(() => 'blob:face-reading')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('FaceReadingCard', () => {
  it('처음이면 버튼을 보여 주고, 사진이 준비되기 전에는 막는다', async () => {
    byJob.mockRejectedValue(notFound())
    const { rerender } = render(
      <FaceReadingCard jobId="job-1" photoReady={false} jobDone={false} />,
    )

    const button = await screen.findByRole('button', { name: 'AI 관상 보기' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/얼굴 사진을 고르는 중이에요/)).toBeTruthy()
    expect(screen.getByText(FUN_NOTICE)).toBeTruthy()

    rerender(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)
    expect(screen.getByRole('button', { name: 'AI 관상 보기' })).toBeEnabled()
  })

  it('요청하면 결과가 나올 때까지 3초마다 묻고, 결과를 보여 준다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    byJob.mockRejectedValue(notFound())
    request.mockResolvedValue(reading({ status: 'PENDING', result: null }))
    byId.mockResolvedValue(reading())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    await user.click(await screen.findByRole('button', { name: 'AI 관상 보기' }))
    expect(await screen.findByRole('status')).toHaveTextContent('관상을 보는 중이에요')
    expect(byId).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(byId).toHaveBeenCalledWith('reading-1', expect.any(AbortSignal))
    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    expect(screen.getByText('코')).toBeTruthy()
    expect(screen.getByText('턱끝을 조금 세우면')).toBeTruthy()
    expect(screen.getByText(FUN_NOTICE)).toBeTruthy()
  })

  it('결과 옆에 관상에 쓴 사진을 보여 주고, 화면을 떠나면 주소를 푼다(-452)', async () => {
    byJob.mockResolvedValue(reading())
    const { unmount } = render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    const img = await screen.findByRole('img', { name: PHOTO_ALT })
    expect(img).toHaveAttribute('src', 'blob:face-reading')
    expect(photo).toHaveBeenCalledTimes(1)
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:face-reading')
  })

  it('화면을 다시 그려도(화면 복귀) 받아 둔 사진을 서버에 다시 묻지 않고 보여 준다(-891)', async () => {
    byJob.mockResolvedValue(reading())
    const first = render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toBeTruthy()
    first.unmount()

    // 서버 사진은 이미 지워졌다
    photo.mockRejectedValue(
      new ApiError(409, { code: 'READ_002', message: '사진 없음', details: [] }),
    )
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toHaveAttribute(
      'src',
      'blob:face-reading',
    )
    expect(photo).toHaveBeenCalledTimes(1)
  })

  it('로그아웃하면 받아 둔 사진을 비운다(-891)', async () => {
    useAuthStore.setState({ status: 'member' })
    byJob.mockResolvedValue(reading())
    const first = render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toBeTruthy()
    first.unmount()

    act(() => useAuthStore.getState().signOut())
    render(<FaceReadingCard jobId="job-1" photoReady jobDone />)
    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByRole('img', { name: PHOTO_ALT })).toBeNull()
  })

  it('3D가 완성돼도 받아 둔 관상 사진을 그대로 보여 준다(-891)', async () => {
    byJob.mockResolvedValue(reading())
    const { rerender } = render(
      <FaceReadingCard jobId="job-1" photoReady jobDone={false} faceModelId={null} />,
    )
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toBeTruthy()

    rerender(<FaceReadingCard jobId="job-1" photoReady jobDone faceModelId="fm-1" />)
    await act(async () => {})
    expect(screen.getByRole('img', { name: PHOTO_ALT })).toHaveAttribute('src', 'blob:face-reading')
    expect(photo).toHaveBeenCalledTimes(1)
    // 받아 둔 사진이 있으니 정면 사진·썸네일은 부르지 않는다
    expect(front).not.toHaveBeenCalled()
    expect(heads).not.toHaveBeenCalled()
  })

  it('팝업 결과 카드는 [사진·조언 | 머리글·풀이] 구조다: 조언은 사진 쪽 묶음에 있다(-601, -791)', async () => {
    byJob.mockResolvedValue(reading())
    render(
      <Modal open onClose={() => {}} title="AI 관상" className="pf-reading-modal">
        <FaceReadingCard jobId="job-1" photoReady jobDone={false} />
      </Modal>,
    )

    const img = await screen.findByRole('img', { name: PHOTO_ALT })
    // refine.css의 선택자가 가리키는 사슬: 팝업 > 본문 > 내용 > 관상 > 결과 카드
    const card = document.querySelector(
      'dialog.pf-reading-modal > div > div > .pf-reading > .pf-reading-result[data-photo]',
    )
    expect(card).not.toBeNull()
    // 사진 쪽 묶음: 사진과 그 아래 조언·재미 안내(넓은 카드에서 사진 아래를 채운다)
    const side = card?.querySelector(':scope > .pf-reading-side')
    expect(img.parentElement).toBe(side)
    expect(img).toHaveClass('pf-reading-portrait')
    expect(side?.querySelector(':scope > .pf-reading-notes')).toHaveTextContent(
      '턱끝을 조금 세우면',
    )
    expect(side?.querySelector(':scope > .pf-reading-notes')).toHaveTextContent(FUN_NOTICE)
    // 풀이 칸에는 부위 풀이만 남는다
    const details = card?.querySelector(':scope > .pf-reading-details')
    expect(details).toHaveTextContent('콧방울이 단단해')
    expect(details).not.toHaveTextContent('턱끝을 조금 세우면')
  })

  it('사진이 없으면 조언은 풀이 아래에 그대로 둔다(-791)', async () => {
    byJob.mockResolvedValue(reading())
    // 사진을 못 받았다(404 등)
    photo.mockRejectedValue(notFound())
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    const details = await screen.findByText('콧방울이 단단해', { exact: false })
    const card = details.closest('.pf-reading-result')
    expect(card).not.toHaveAttribute('data-photo')
    expect(card?.querySelector('.pf-reading-side')).toBeNull()
    expect(card?.querySelector(':scope > .pf-reading-details')).toHaveTextContent(
      '턱끝을 조금 세우면',
    )
  })

  it('관상 요청이 서버에 닿은 뒤에 사진을 불러, 새로고침 없이 보인다(-523)', async () => {
    byJob.mockRejectedValue(notFound())
    let accept: (value: FaceReading) => void = () => {}
    request.mockReturnValue(new Promise<FaceReading>((resolve) => (accept = resolve)))
    const user = userEvent.setup()
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    await user.click(await screen.findByRole('button', { name: 'AI 관상 보기' }))
    expect(await screen.findByRole('status')).toHaveTextContent('관상을 보는 중이에요')
    // 요청 응답 전에는 관상 기록이 없어 서버가 404를 준다. 부르지 않는다
    expect(photo).not.toHaveBeenCalled()

    await act(async () => accept(reading({ status: 'PENDING', result: null })))
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toHaveAttribute(
      'src',
      'blob:face-reading',
    )
    expect(photo).toHaveBeenCalledTimes(1)
  })

  it('사진을 처음에 못 받아도 잠시 뒤 다시 물어 보여 준다(-523)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    byJob.mockResolvedValue(reading())
    photo.mockRejectedValueOnce(notFound())
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    expect(screen.queryByRole('img', { name: PHOTO_ALT })).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_RETRY_MS)
    })
    expect(await screen.findByRole('img', { name: PHOTO_ALT })).toBeTruthy()
    expect(photo).toHaveBeenCalledTimes(2)
  })

  it('사진을 못 받으면 글만 보여 준다', async () => {
    byJob.mockResolvedValue(reading())
    photo.mockRejectedValue(
      new ApiError(409, { code: 'READ_002', message: '사진 없음', details: [] }),
    )
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByRole('img', { name: PHOTO_ALT })).toBeNull()
  })

  it('다시 들어오면 이미 본 관상을 보여 준다(3D 완성 뒤에는 지워진 관상 사진을 부르지 않는다)', async () => {
    byJob.mockResolvedValue(reading())
    render(<FaceReadingCard jobId="job-1" photoReady jobDone />)

    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    expect(request).not.toHaveBeenCalled()
    expect(photo).not.toHaveBeenCalled()
  })

  it('3D 완성 뒤 받아 둔 사진이 없으면 보관한 정면 사진을 보여 준다(-891)', async () => {
    byJob.mockResolvedValue(reading())
    front.mockResolvedValue({
      url: 'https://example.test/front.jpg',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    heads.mockResolvedValue({ items: [] } as unknown as Awaited<ReturnType<typeof listFaceModels>>)
    render(<FaceReadingCard jobId="job-1" photoReady jobDone faceModelId="fm-1" />)

    expect(await screen.findByRole('img', { name: FRONT_PHOTO_ALT })).toHaveAttribute(
      'src',
      'https://example.test/front.jpg',
    )
    expect(front).toHaveBeenCalledWith('fm-1', expect.any(AbortSignal))
    expect(photo).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: THUMBNAIL_ALT })).toBeNull()
  })

  it('3D 완성 뒤 관상·정면 사진이 없으면 내 모델 썸네일을, 그것도 없으면 글만 보여 준다', async () => {
    byJob.mockResolvedValue(reading())
    heads.mockResolvedValue({
      items: [
        {
          faceModelId: 'fm-1',
          title: '내 모델',
          thumbnailUrl: 'https://example.test/t.webp',
          createdAt: '',
          simulationCount: 0,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof listFaceModels>>)
    const { unmount } = render(
      <FaceReadingCard jobId="job-1" photoReady jobDone faceModelId="fm-1" />,
    )
    expect(await screen.findByRole('img', { name: THUMBNAIL_ALT })).toHaveAttribute(
      'src',
      'https://example.test/t.webp',
    )
    unmount()

    render(<FaceReadingCard jobId="job-1" photoReady jobDone faceModelId="fm-2" />)
    expect(await screen.findByText('복이 들어오는 둥근 얼굴')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByRole('img', { name: THUMBNAIL_ALT })).toBeNull()
  })

  it('3D가 완성됐는데 본 적이 없으면 카드를 숨긴다(사진이 지워짐)', async () => {
    byJob.mockRejectedValue(notFound())
    const { container } = render(<FaceReadingCard jobId="job-1" photoReady jobDone />)

    await vi.waitFor(() => expect(byJob).toHaveBeenCalled())
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('사진이 이미 지워졌다는 응답(READ_002)이면 카드를 숨긴다', async () => {
    byJob.mockRejectedValue(notFound())
    request.mockRejectedValue(
      new ApiError(409, { code: 'READ_002', message: '사진 없음', details: [] }),
    )
    const user = userEvent.setup()
    const { container } = render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    await user.click(await screen.findByRole('button', { name: 'AI 관상 보기' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('실패하면 알리고 다시 시도할 수 있다', async () => {
    byJob.mockResolvedValue(reading({ status: 'FAILED', result: null }))
    render(<FaceReadingCard jobId="job-1" photoReady jobDone={false} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('관상을 보지 못했어요')
    expect(screen.getByRole('button', { name: '다시 시도하기' })).toBeEnabled()
  })
})

describe('결과 배치 규칙(refine.css, -791)', () => {
  const css = () =>
    readFileSync(resolve(process.cwd(), 'src/features/layout/refine.css'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )

  it('[사진 | 풀이] 넓은 배치는 화면 폭이 아니라 관상 카드 폭(container query)으로 정한다', () => {
    const text = css()
    // 관상 카드가 폭 기준(container)이다
    expect(text).toMatch(/\.pf-reading \{\n {2}container-type: inline-size;\n\}/)
    // 넓은 배치(사진 220px 칸)는 @container 안에만 있다. 화면 폭(@media 720px)으로 켜면 좁은 팝업에서 풀이 칸이 몇 px만 남았다
    const wide = text.indexOf("grid-template-areas: 'photo head' 'photo details';")
    expect(wide).toBeGreaterThan(-1)
    const opener = text.lastIndexOf('@', wide)
    expect(text.slice(opener, opener + 30)).toMatch(/^@container \(min-width: \d+px\)/)
  })
})
