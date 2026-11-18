import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLiveCaptureSupported, pickMimeType, recordedFile } from './recorder'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('recorder', () => {
  it('지원하는 형식 중 mp4(H.264)를 먼저 고른다', () => {
    expect(pickMimeType((t) => t.startsWith('video/webm') || t === 'video/mp4')).toBe('video/mp4')
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=h264')
    expect(pickMimeType(() => false)).toBe('')
  })

  it('녹화 파일 이름·형식은 기본 형식으로', () => {
    const mp4 = recordedFile(['x'], 'video/mp4;codecs=avc1.640028')
    expect(mp4.name).toBe('capture.mp4')
    expect(mp4.type).toBe('video/mp4')
    const webm = recordedFile(['x'], 'video/webm;codecs=vp9')
    expect(webm.name).toBe('capture.webm')
    expect(webm.type).toBe('video/webm')
    expect(recordedFile(['x'], '').type).toBe('video/webm')
  })

  it('카메라나 MediaRecorder가 없으면 지원하지 않는다', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(isLiveCaptureSupported()).toBe(false)
    vi.stubGlobal('MediaRecorder', function MediaRecorder() {})
    // jsdom에는 mediaDevices가 없다
    expect(isLiveCaptureSupported()).toBe(false)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve() },
    })
    expect(isLiveCaptureSupported()).toBe(true)
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })
})
