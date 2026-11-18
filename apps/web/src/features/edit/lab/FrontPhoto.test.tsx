import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import { getFrontPhoto } from '../api'
import { FrontPhotoView, useFrontPhoto } from './FrontPhoto'

const frontPhoto = vi.hoisted(() => vi.fn<typeof getFrontPhoto>())
vi.mock('../api', () => ({ getFrontPhoto: frontPhoto }))

/** SimulationLab과 같은 연결: 사진이 있을 때만 `원본 사진` 탭 내용을 그린다 */
function Lab({ faceModelId }: { faceModelId: string | null }) {
  const url = useFrontPhoto(faceModelId)
  return url ? <FrontPhotoView url={url} /> : <p>사진 없음</p>
}

const inTenMinutes = () => new Date(Date.now() + 10 * 60_000).toISOString()

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('실험실 정면 사진 (-599)', () => {
  it('사진을 받아 가린 채(PRIVATE_MEDIA) 카드에 다 보이게 채운다', async () => {
    frontPhoto.mockResolvedValue({ url: 'https://s3.test/front.jpg', expiresAt: inTenMinutes() })
    render(<Lab faceModelId="fm-1" />)

    const photo = await screen.findByRole('img', { name: '촬영한 내 정면 사진' })
    expect(frontPhoto).toHaveBeenCalledWith('fm-1', expect.any(AbortSignal))
    expect(photo).toHaveAttribute('src', 'https://s3.test/front.jpg')
    // 화면 기록 도구에 얼굴이 찍히지 않게 가린다
    expect(photo).toHaveAttribute('data-clarity-mask', 'True')
    expect(photo).toHaveClass('object-contain')
  })

  it('사진이 없는 3D(404)면 아무것도 그리지 않는다(탭도 없다)', async () => {
    frontPhoto.mockRejectedValue(
      new ApiError(404, { code: 'COMMON_002', message: '없음', details: [] }),
    )
    render(<Lab faceModelId="fm-old" />)

    await waitFor(() => expect(frontPhoto).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('img', { name: '촬영한 내 정면 사진' })).toBeNull()
  })

  it('시안을 불러오기 전(모델 모름)에는 부르지 않는다', async () => {
    render(<Lab faceModelId={null} />)
    await act(async () => {})
    expect(frontPhoto).not.toHaveBeenCalled()
  })

  it('주소가 만료되기 전에 다시 받는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    frontPhoto
      .mockResolvedValueOnce({ url: 'https://s3.test/front-1.jpg', expiresAt: inTenMinutes() })
      .mockResolvedValueOnce({ url: 'https://s3.test/front-2.jpg', expiresAt: inTenMinutes() })
    render(<Lab faceModelId="fm-1" />)
    await screen.findByRole('img', { name: '촬영한 내 정면 사진' })
    expect(frontPhoto).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(9 * 60_000 + 1_000)
    })
    expect(frontPhoto).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('img', { name: '촬영한 내 정면 사진' })).toHaveAttribute(
      'src',
      'https://s3.test/front-2.jpg',
    )
  })
})
