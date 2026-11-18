import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/features/auth/store'
import { callsTo, fail, ok, routeFetch } from '@/features/auth/testUtils'
import { __resetRefreshState } from '@/shared/api/client'
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenStore'
import type { CompareViewerProps } from './CompareViewer'
import {
  BASE_MESH_CAPTION,
  CAPTURES_HIDDEN,
  GRAY_CAPTION,
  QUALITY_FAILED,
} from './ModelAssetsPanel'
import { INVALID_USER_ID } from './errors'
import { NO_DELETION_FAILURES, TRUNCATED_NOTICE } from './StorageSection'
import type { AdminFaceModel, AdminFaceModelAssets, AdminPage, AdminUserStorage } from './types'
import { UserModelsPage } from './UserModelsPage'

// WebGL이 없어 뷰어는 흉내만 낸다. 어떤 주소·회색 여부·카메라로 불렸는지만 본다(가짜 주소)
vi.mock('./CompareViewerLoader', () => ({
  CompareViewer: ({ meshUrl, gray, orbit, camera }: CompareViewerProps) => (
    <div
      data-testid="face-viewer"
      data-mesh={meshUrl}
      data-gray={gray ? 'true' : 'false'}
      data-orbit={orbit ? 'true' : 'false'}
      data-kind={camera.kind}
      data-aspect={camera.aspect ?? ''}
    />
  ),
}))

const USER = '00000000-0000-4000-8000-000000000001'

function model(over: Partial<AdminFaceModel> = {}): AdminFaceModel {
  return {
    faceModelId: 'fm-new',
    jobId: 'job-new',
    createdAt: '2026-11-06T03:00:00Z',
    videoDurationMs: 12000,
    jobStatus: 'SUCCEEDED',
    simulationCount: 3,
    deletedAt: null,
    deleteScheduledAt: null,
    ...over,
  }
}

function page(items: AdminFaceModel[], over: Partial<AdminPage<AdminFaceModel>> = {}) {
  return { items, page: 0, size: 20, totalElements: items.length, totalPages: 1, ...over }
}

const FUTURE = '2099-01-01T00:00:00Z'
const PAST = '2000-01-01T00:00:00Z'

function assets(over: Partial<AdminFaceModelAssets> = {}): AdminFaceModelAssets {
  return {
    faceModelId: 'fm-new',
    expiresAt: FUTURE,
    texturedMeshUrl: 'https://fake.test/textured.glb',
    baseMeshUrl: null,
    thumbnailUrl: null,
    captureImages: [],
    ...over,
  }
}

function storage(over: Partial<AdminUserStorage> = {}): AdminUserStorage {
  return {
    userId: USER,
    prefix: `users/${USER}/`,
    checkedAt: '2026-11-07T03:00:00Z',
    objects: [],
    deletionFailures: [],
    ...over,
  }
}

beforeEach(() => {
  __resetRefreshState()
  setAccessToken('admin-token', 'user')
  useAuthStore.setState({ status: 'member' })
})
afterEach(() => {
  clearAccessToken()
  vi.unstubAllGlobals()
})

describe('사용자별 모델 목록', () => {
  it('서버가 준 최신순 그대로 생성 시각·영상 길이·상태·시안 수·삭제 상태를 보인다', async () => {
    routeFetch([
      [
        'GET',
        '/face-models',
        ok(
          page([
            model(),
            model({
              faceModelId: 'fm-old',
              createdAt: '2026-11-01T03:00:00Z',
              videoDurationMs: 75000,
              jobStatus: 'FAILED',
              simulationCount: 0,
              deleteScheduledAt: '2026-11-10T00:00:00Z',
            }),
            model({ faceModelId: 'fm-gone', deletedAt: '2026-11-02T00:00:00Z' }),
          ]),
        ),
      ],
      ['GET', '/storage', ok(storage())],
    ])
    render(<UserModelsPage userId={USER} />)

    const rows = await screen.findAllByRole('row')
    // 머리 행 + 모델 3개 (저장소는 객체가 없어 표가 없다)
    const body = rows.slice(1)
    expect(body).toHaveLength(3)
    expect(body[0]).toHaveTextContent('2026. 11. 06. 12:00:00')
    expect(body[0]).toHaveTextContent('12초')
    expect(body[0]).toHaveTextContent('SUCCEEDED')
    expect(body[0]).toHaveTextContent('3개')
    expect(body[1]).toHaveTextContent('1분 15초')
    expect(body[1]).toHaveTextContent('FAILED')
    expect(body[1]).toHaveTextContent('삭제 예정')
    expect(body[2]).toHaveTextContent('삭제됨')
  })

  it('다음 페이지를 누르면 page=1로 다시 부른다', async () => {
    const fetch = routeFetch([
      ['GET', '/face-models', ok(page([model()], { totalPages: 2, totalElements: 21 }))],
      ['GET', '/storage', ok(storage())],
      [
        'GET',
        '/face-models',
        ok(page([model({ faceModelId: 'fm-p2' })], { page: 1, totalPages: 2, totalElements: 21 })),
      ],
    ])
    render(<UserModelsPage userId={USER} />)
    expect(await screen.findByText('1 / 2 · 전체 21개')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('2 / 2 · 전체 21개')).toBeInTheDocument()
    const calls = callsTo(fetch, '/face-models')
    expect(String(calls[1][0])).toContain('page=1')
  })

  it('로그인하지 않았으면 부르지 않는다', () => {
    useAuthStore.setState({ status: 'anonymous' })
    const fetch = routeFetch([])
    render(<UserModelsPage userId={USER} />)
    expect(screen.getByText('로그인이 필요해요')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

const FRONT_R = [
  [1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]

/** 합성 작업 상세. input.quality만 의미가 있다 */
function jobDetail(quality: unknown) {
  return {
    jobId: 'job-new',
    userId: USER,
    status: 'SUCCEEDED',
    stage: null,
    createdAt: '2026-11-06T03:00:00Z',
    extractClaimedAt: null,
    framesReadyAt: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    extractAttempts: null,
    segments: [],
    slowestSegment: null,
    failure: null,
    previousFailures: [],
    input: {
      videoDurationMs: 12000,
      captureMethod: null,
      deviceModel: null,
      frameCount: null,
      quality,
    },
    faceModelId: 'fm-new',
  }
}

const QUALITY = {
  focalPx: 1450,
  captureViews: { LEFT_45: { yaw: -45, pitch: 2, by: 'sfm' } },
  captureCameras: {
    frame: 'glb',
    axes: 'colmap',
    camera: { w: 1080, h: 1920, f: 1450, cx: 540, cy: 960 },
    views: { FRONT: { R: FRONT_R, t: [0, 0, 0.45] }, LEFT: null },
  },
}

const PHOTOS = [
  { angle: 'RIGHT', url: 'https://fake.test/right.png' },
  { angle: 'FRONT', url: 'https://fake.test/front.png' },
  { angle: 'LEFT_45', url: 'https://fake.test/left45.png' },
  { angle: 'RIGHT_45', url: 'https://fake.test/right45.png' },
  { angle: 'LEFT', url: 'https://fake.test/left.png' },
]

type Route = [string, string, Response]

describe('모델 자산', () => {
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  async function openFirst(
    assetResponses: AdminFaceModelAssets[],
    detail: Response = ok(jobDetail(null)),
  ) {
    const fetch = routeFetch([
      ['GET', '/face-models', ok(page([model()]))],
      ['GET', '/storage', ok(storage())],
      ...assetResponses.map((body): Route => ['GET', '/assets', ok(body)]),
      ['GET', '/admin/reconstructions/job-new', detail],
    ])
    render(<UserModelsPage userId={USER} />)
    await userEvent.click(await screen.findByRole('button', { name: '보기' }))
    return fetch
  }

  it('운영(사진 없음): 텍스처·형상(회색) 3D만, 회색은 텍스처 메시를 회색으로 그린다', async () => {
    await openFirst([assets()])
    const viewers = await screen.findAllByTestId('face-viewer')
    expect(viewers).toHaveLength(2)
    expect(viewers[0]).toHaveAttribute('data-gray', 'false')
    expect(viewers[1]).toHaveAttribute('data-gray', 'true')
    expect(viewers[1]).toHaveAttribute('data-mesh', 'https://fake.test/textured.glb')
    expect(screen.getByRole('region', { name: '형상(회색)' })).toHaveTextContent(GRAY_CAPTION)
    expect(screen.getAllByText(CAPTURES_HIDDEN).length).toBeGreaterThan(0)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // 사진이 없으면 겹쳐 보기를 고를 수 없다
    expect(screen.queryByRole('button', { name: '겹쳐 보기' })).not.toBeInTheDocument()
  })

  it('보기를 누르면 모델 파일로 내려가고 그 행 버튼은 보는 중이 된다', async () => {
    await openFirst([assets()])
    await screen.findAllByTestId('face-viewer')
    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '보는 중' })).toHaveAttribute('aria-current', 'true')
  })

  it('텍스처 전 메시가 있으면 그것을 회색으로, 사진은 각도 순서로 보인다', async () => {
    await openFirst([assets({ baseMeshUrl: 'https://fake.test/base.glb', captureImages: PHOTOS })])
    const viewers = await screen.findAllByTestId('face-viewer')
    expect(viewers).toHaveLength(2)
    expect(viewers[1]).toHaveAttribute('data-gray', 'true')
    expect(viewers[1]).toHaveAttribute('data-mesh', 'https://fake.test/base.glb')
    expect(screen.getByRole('region', { name: '형상(회색)' })).toHaveTextContent(BASE_MESH_CAPTION)

    const photos = within(screen.getByRole('region', { name: '5방향 촬영 사진' })).getAllByRole(
      'img',
    )
    expect(photos.map((img) => img.getAttribute('alt'))).toEqual([
      '왼쪽 촬영 사진',
      '왼쪽 45° 촬영 사진',
      '정면 촬영 사진',
      '오른쪽 45° 촬영 사진',
      '오른쪽 촬영 사진',
    ])
    expect(photos[0]).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(photos[0].closest('[data-clarity-mask]')).not.toBeNull()
    const compare = screen.getByRole('img', { name: '정면 비교 사진' })
    expect(compare).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(compare.closest('[data-clarity-mask]')).not.toBeNull()
    expect(screen.queryByText(CAPTURES_HIDDEN)).not.toBeInTheDocument()
  })

  it('작업 품질 보고로 방향마다 사진 카메라 → 각도 → 기본 방향을 쓴다', async () => {
    await openFirst([assets({ captureImages: PHOTOS })], ok(jobDetail(QUALITY)))
    expect(await screen.findByText('사진 카메라 그대로')).toBeInTheDocument()
    let viewers = screen.getAllByTestId('face-viewer')
    expect(viewers.map((v) => v.getAttribute('data-kind'))).toEqual(['exact', 'exact'])
    // 사진 카메라 그대로면 돌리지 않고 사진 비율로 그린다
    expect(viewers[0]).toHaveAttribute('data-orbit', 'false')
    expect(Number(viewers[0].getAttribute('data-aspect'))).toBeCloseTo(1080 / 1920, 9)

    // 카메라 값 표: 정면 거리 0.450, 각도 0
    const front = document.querySelector('tr[data-angle="FRONT"]')
    expect(front).toHaveTextContent('0.450')
    expect(front).toHaveTextContent('0.0°')
    expect(document.querySelector('tr[data-angle="LEFT"]')).toHaveTextContent('카메라 없음')

    await userEvent.click(screen.getByRole('button', { name: '왼쪽 45°' }))
    expect(await screen.findByText('각도만 맞춤')).toBeInTheDocument()
    viewers = screen.getAllByTestId('face-viewer')
    expect(viewers[0]).toHaveAttribute('data-kind', 'approx')
    expect(viewers[0]).toHaveAttribute('data-orbit', 'true')

    await userEvent.click(screen.getByRole('button', { name: '왼쪽' }))
    expect(await screen.findByText('기본 방향')).toBeInTheDocument()
  })

  it('겹쳐 보기: 고른 3D 하나 위에 사진을 불투명도대로 겹친다', async () => {
    await openFirst([assets({ captureImages: PHOTOS })], ok(jobDetail(QUALITY)))
    await screen.findByText('사진 카메라 그대로')
    await userEvent.click(screen.getByRole('button', { name: '겹쳐 보기' }))
    let viewers = screen.getAllByTestId('face-viewer')
    expect(viewers).toHaveLength(1)
    expect(viewers[0]).toHaveAttribute('data-gray', 'false')
    expect(viewers[0]).toHaveAttribute('data-orbit', 'false')
    const overlay = screen.getByRole('img', { name: '정면 겹친 사진' })
    expect(overlay.style.opacity).toBe('0.5')

    fireEvent.change(screen.getByLabelText('사진 불투명도'), { target: { value: '80' } })
    expect(overlay.style.opacity).toBe('0.8')

    await userEvent.click(screen.getByRole('button', { name: '회색' }))
    viewers = screen.getAllByTestId('face-viewer')
    expect(viewers[0]).toHaveAttribute('data-gray', 'true')
    // 사진 카메라 그대로일 때는 사진을 옮기지 않는다
    expect(screen.queryByRole('button', { name: '사진 위치 되돌리기' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '왼쪽 45°' }))
    expect(screen.getByRole('button', { name: '사진 위치 되돌리기' })).toBeInTheDocument()
  })

  it('작업 상세를 못 받으면 안내하고 기본 방향으로 보인다', async () => {
    await openFirst([assets()], fail(500, 'COMMON_500'))
    expect(await screen.findByText(QUALITY_FAILED)).toBeInTheDocument()
    expect(screen.getByText('기본 방향')).toBeInTheDocument()
  })

  it('주소가 살아 있으면 다시 열어도 부르지 않는다', async () => {
    const fresh = await openFirst([assets()])
    await screen.findAllByTestId('face-viewer')
    await userEvent.click(screen.getByRole('button', { name: '보는 중' }))
    expect(callsTo(fresh, '/assets')).toHaveLength(1)
    expect(callsTo(fresh, '/admin/reconstructions/')).toHaveLength(1)
  })

  it('만료된 주소는 다시 열 때 새로 받는다', async () => {
    const fetch = await openFirst([assets({ expiresAt: PAST }), assets()])
    await screen.findAllByTestId('face-viewer')
    await userEvent.click(screen.getByRole('button', { name: '보는 중' }))
    await waitFor(() => expect(callsTo(fetch, '/assets')).toHaveLength(2))
  })

  it('서명 URL을 주소창에 올리지 않는다', async () => {
    const before = window.location.href
    await openFirst([assets()])
    await screen.findAllByTestId('face-viewer')
    expect(window.location.href).toBe(before)
  })
})

describe('S3 저장소', () => {
  it('객체마다 크기·상태 배지를, 삭제 실패를 목록으로 보인다', async () => {
    routeFetch([
      ['GET', '/face-models', ok(page([]))],
      [
        'GET',
        '/storage',
        ok(
          storage({
            objects: (['OK', 'DB_ONLY', 'S3_ONLY', 'DELETE_FAILED'] as const).map((state, i) => ({
              key: `users/${USER}/models/m${i}/mesh.glb`,
              size: 1234567,
              lastModified: '2026-11-07T03:00:00Z',
              source: 'FACE_MODEL',
              deleteScheduledAt: null,
              state,
            })),
            deletionFailures: [
              {
                objectKey: `users/${USER}/models/m3/mesh.glb`,
                reason: 'AccessDenied',
                retryCount: 3,
              },
            ],
          }),
        ),
      ],
    ])
    render(<UserModelsPage userId={USER} />)

    const section = await screen.findByRole('region', { name: 'S3 저장소' })
    await within(section).findByText('삭제 실패', { selector: 'h3' })
    const badges = section.querySelectorAll('[data-state]')
    expect([...badges].map((b) => [b.getAttribute('data-state'), b.textContent])).toEqual([
      ['OK', '정상'],
      ['DB_ONLY', 'DB에만 있음'],
      ['S3_ONLY', 'S3에만 있음'],
      ['DELETE_FAILED', '삭제 실패'],
    ])
    expect(within(section).getAllByText('1.2 MB')).toHaveLength(4)
    expect(within(section).getByText('AccessDenied')).toBeInTheDocument()
    expect(within(section).getByText('3회')).toBeInTheDocument()
    expect(within(section).queryByText(NO_DELETION_FAILURES)).not.toBeInTheDocument()
  })

  it('잘렸으면 안내를 보이고, DB에만 있는 객체는 크기·시각을 비우며 출처를 한국어로 보인다', async () => {
    const object = (key: string, source: string | null, state: 'OK' | 'DB_ONLY' | 'S3_ONLY') => ({
      key: `users/${USER}/${key}`,
      size: state === 'DB_ONLY' ? null : 2048,
      lastModified: state === 'DB_ONLY' ? null : '2026-11-07T03:00:00Z',
      source,
      deleteScheduledAt: null,
      state,
    })
    routeFetch([
      ['GET', '/face-models', ok(page([]))],
      [
        'GET',
        '/storage',
        ok(
          storage({
            truncated: true,
            objects: [
              object('uploads/a.mp4', 'FACE_UPLOAD', 'OK'),
              object('frames/0.jpg', 'FACE_UPLOAD_FRAMES', 'OK'),
              object('models/m/mesh.glb', 'FACE_MODEL', 'DB_ONLY'),
              object('captures/front.jpg', 'FACE_CAPTURE_IMAGE', 'OK'),
              object('logs/stage.json', 'JOB_STAGE_LOG', 'OK'),
              object('logs/deletion.json', 'DELETION_LOG', 'OK'),
              object('stray.bin', null, 'S3_ONLY'),
              object('new.bin', 'NEW_SOURCE', 'OK'),
            ],
          }),
        ),
      ],
    ])
    render(<UserModelsPage userId={USER} />)

    const section = await screen.findByRole('region', { name: 'S3 저장소' })
    expect(await within(section).findByText(TRUNCATED_NOTICE)).toBeInTheDocument()
    const rows = within(section).getAllByRole('row').slice(1)
    const sources = rows.map((row) => within(row).getAllByRole('cell')[3].textContent)
    expect(sources).toEqual([
      '업로드 영상',
      '추출 프레임',
      '3D 모델',
      '촬영 사진',
      '단계 로그',
      '삭제 대기 기록',
      'DB 기록 없음',
      'NEW_SOURCE',
    ])
    const dbOnly = within(rows[2]).getAllByRole('cell')
    expect(dbOnly[1]).toHaveTextContent('—')
    expect(dbOnly[2]).toHaveTextContent('—')
    expect(within(rows[0]).getAllByRole('cell')[1]).toHaveTextContent('2.0 KB')
  })

  it('잘리지 않았으면 안내가 없다', async () => {
    routeFetch([
      ['GET', '/face-models', ok(page([]))],
      ['GET', '/storage', ok(storage({ truncated: false }))],
    ])
    render(<UserModelsPage userId={USER} />)
    const section = await screen.findByRole('region', { name: 'S3 저장소' })
    await within(section).findByText(NO_DELETION_FAILURES)
    expect(within(section).queryByText(TRUNCATED_NOTICE)).not.toBeInTheDocument()
  })
})

describe('사용자 ID 형식 오류', () => {
  it('400이면 모델 목록과 저장소 모두 형식 안내를 보인다', async () => {
    routeFetch([
      ['GET', '/face-models', fail(400, 'INVALID_REQUEST')],
      ['GET', '/storage', fail(400, 'INVALID_REQUEST')],
    ])
    render(<UserModelsPage userId="not-a-uuid" />)
    await waitFor(() => expect(screen.getAllByText(INVALID_USER_ID)).toHaveLength(2))
  })
})
