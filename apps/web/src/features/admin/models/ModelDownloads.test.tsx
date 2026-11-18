import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminModelsApi } from './api'
import {
  GRAY_FAILED,
  GRAY_LABEL,
  ModelDownloads,
  PREPARING,
  TEXTURED_FAILED,
  TEXTURED_LABEL,
} from './ModelDownloads'
import type { AdminFaceModelAssets } from './types'

// 회색 변환(three)은 grayGlb.test.ts에서 따로 본다. 여기서는 흐름만 본다
const grayGlb = vi.fn<(blob: Blob) => Promise<ArrayBuffer>>()
vi.mock('./grayGlb', () => ({ grayGlb: (blob: Blob) => grayGlb(blob) }))

// 가짜 주소만 쓴다
const MESH = 'https://example.invalid/mesh.glb?sig=fake'
const FRESH_MESH = 'https://example.invalid/mesh.glb?sig=fresh'

function assets(over: Partial<AdminFaceModelAssets> = {}): AdminFaceModelAssets {
  return {
    faceModelId: 'fm-1',
    expiresAt: '2099-01-01T00:00:00Z',
    texturedMeshUrl: MESH,
    baseMeshUrl: null,
    thumbnailUrl: null,
    captureImages: [],
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
let saved: { name: string; href: string }[]
let created: Blob[]
const { createObjectURL, revokeObjectURL } = URL

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  created = []
  saved = []
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob)
    return `blob:fake/${created.length}`
  })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.getAttribute('href') ?? '' })
  })
})

afterEach(() => {
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  grayGlb.mockReset()
})

describe('ModelDownloads', () => {
  it('두 버튼을 보인다', () => {
    render(<ModelDownloads assets={assets()} />)
    expect(screen.getByRole('button', { name: TEXTURED_LABEL })).toBeEnabled()
    expect(screen.getByRole('button', { name: GRAY_LABEL })).toBeEnabled()
  })

  it('텍스처 GLB: 상태의 주소를 Referer 없이 받아 파일로 저장하고 주소를 푼다', async () => {
    render(<ModelDownloads assets={assets()} />)
    await userEvent.click(screen.getByRole('button', { name: TEXTURED_LABEL }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(MESH)
    expect(init.referrerPolicy).toBe('no-referrer')
    expect(saved[0]).toEqual({ name: 'face-model-fm-1.glb', href: 'blob:fake/1' })
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake/1'))
    expect(document.querySelector('a[download]')).toBeNull()
    expect(screen.getByRole('button', { name: TEXTURED_LABEL })).toBeEnabled()
  })

  it('만료된 주소면 자산을 다시 받아 새 주소로 받는다', async () => {
    const refreshed = assets({ texturedMeshUrl: FRESH_MESH })
    const spy = vi.spyOn(adminModelsApi, 'assets').mockResolvedValue(refreshed)
    const onRefreshed = vi.fn()
    render(
      <ModelDownloads
        assets={assets({ expiresAt: '2000-01-01T00:00:00Z' })}
        onRefreshed={onRefreshed}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: TEXTURED_LABEL }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(spy).toHaveBeenCalledWith('fm-1')
    expect(onRefreshed).toHaveBeenCalledWith(refreshed)
    expect(fetchMock.mock.calls[0][0]).toBe(FRESH_MESH)
  })

  it('받는 동안 두 버튼을 막고 준비 중으로 보인다. 실패하면 오류 문구', async () => {
    let finish: (response: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (finish = resolve)))
    render(<ModelDownloads assets={assets()} />)
    await userEvent.click(screen.getByRole('button', { name: TEXTURED_LABEL }))

    expect(await screen.findByRole('button', { name: PREPARING })).toBeDisabled()
    expect(screen.getByRole('button', { name: GRAY_LABEL })).toBeDisabled()
    finish(new Response(null, { status: 403 }))

    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTURED_FAILED)
    expect(saved).toHaveLength(0)
    expect(screen.getByRole('button', { name: TEXTURED_LABEL })).toBeEnabled()
  })

  it('회색 형상 GLB: 받은 GLB를 회색으로 바꿔 -gray 이름으로 저장한다', async () => {
    grayGlb.mockResolvedValue(new Uint8Array([9, 9]).buffer)
    render(<ModelDownloads assets={assets()} />)
    await userEvent.click(screen.getByRole('button', { name: GRAY_LABEL }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(grayGlb).toHaveBeenCalledTimes(1)
    expect(saved[0].name).toBe('face-model-fm-1-gray.glb')
    expect(created[0].type).toBe('model/gltf-binary')
    expect(created[0].size).toBe(2)
  })

  it('회색 변환이 실패하면 오류 문구', async () => {
    grayGlb.mockRejectedValue(new Error('parse'))
    render(<ModelDownloads assets={assets()} />)
    await userEvent.click(screen.getByRole('button', { name: GRAY_LABEL }))

    expect(await screen.findByRole('alert')).toHaveTextContent(GRAY_FAILED)
    expect(saved).toHaveLength(0)
  })
})
