import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IPHONE_GENERATIONS,
  detectCaptureDevice,
  iphoneGenerationOf,
  isMobileDevice,
  readDeviceModel,
} from './device'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const IPHONE_KAKAOTALK =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.8.0'
const ANDROID_KAKAOTALK =
  'Mozilla/5.0 (Linux; Android 15; SM-S928N Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 KAKAOTALK/25.8.0 (INAPP)'
const PIXEL =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const GALAXY =
  'Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36'

describe('detectCaptureDevice', () => {
  it.each([
    ['아이폰 Safari', IPHONE, 5],
    ['아이폰 Chrome', IPHONE_CHROME, 5],
    ['데스크톱처럼 보고하는 아이패드', IPAD_DESKTOP_MODE, 5],
    ['아이폰 카카오톡 인앱', IPHONE_KAKAOTALK, 5],
  ])('%s → 아이폰', (_name, ua, touch) => {
    expect(detectCaptureDevice(ua, touch)).toBe('iphone')
  })

  it.each([
    ['갤럭시 삼성 인터넷', GALAXY, 5],
    ['갤럭시 카카오톡 인앱', ANDROID_KAKAOTALK, 5],
    ['갤럭시가 아닌 안드로이드(픽셀)', PIXEL, 5],
    ['맥 데스크톱(터치 없음)', IPAD_DESKTOP_MODE, 0],
    ['알 수 없음', '', 0],
  ])('%s → 갤럭시(안드로이드)', (_name, ua, touch) => {
    expect(detectCaptureDevice(ua, touch)).toBe('android')
  })
})

describe('isMobileDevice (-457 휴대폰이면 QR 없이 바로 촬영)', () => {
  it.each([
    ['아이폰', IPHONE, 5],
    ['아이패드(데스크톱 모드)', IPAD_DESKTOP_MODE, 5],
    ['갤럭시', GALAXY, 5],
    ['안드로이드 카카오톡 인앱', ANDROID_KAKAOTALK, 5],
  ])('%s → 휴대폰', (_name, ua, touch) => {
    expect(isMobileDevice(ua, touch)).toBe(true)
  })

  it.each([
    ['맥 데스크톱', IPAD_DESKTOP_MODE, 0],
    [
      '윈도우 Chrome',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      0,
    ],
    ['알 수 없음', '', 0],
  ])('%s → PC', (_name, ua, touch) => {
    expect(isMobileDevice(ua, touch)).toBe(false)
  })
})

describe('IPHONE_GENERATIONS (-756 세대별 시트)', () => {
  /** 워커 frames_bundle.device_for_model과 같은 규칙: 포함하는 match 중 가장 긴 것 */
  type Profile = {
    match?: string[]
    equiv_mm?: number
    diag_fov_deg?: number
    video_crop?: number
    sensor_aspect?: number[]
  }
  const profiles = JSON.parse(
    readFileSync(
      join(process.cwd(), '../../services/gpu-worker/reconstruction/assets/device_profiles.json'),
      'utf-8',
    ),
  ) as Record<string, Profile>
  const resolve = (model: string) => {
    const hits = Object.entries(profiles).filter(
      ([key, p]) =>
        !key.startsWith('_') &&
        (p.match ?? []).some((m) => model.toLowerCase().includes(m.toLowerCase())),
    )
    hits.sort(
      (a, b) =>
        Math.max(...(b[1].match ?? []).map((m) => m.length)) -
        Math.max(...(a[1].match ?? []).map((m) => m.length)),
    )
    return hits[0]?.[0] ?? null
  }

  /** 워커 run_all.device_focal과 같은 식(1080x1920). 같은 값이면 렌즈 출발값이 같다 */
  const focalPx = (key: string | null) => {
    if (!key) return null
    const p = profiles[key]
    const [ax, ay] = p.sensor_aspect ?? [4, 3]
    const tDiag =
      p.diag_fov_deg !== undefined
        ? Math.tan((p.diag_fov_deg * Math.PI) / 180 / 2)
        : 21.633 / (p.equiv_mm ?? NaN)
    const tLong = (tDiag * ax) / Math.hypot(ax, ay)
    return Math.round((960 / tLong) * (p.video_crop ?? 1) * 10) / 10
  }
  const allModels = IPHONE_GENERATIONS.flatMap((g) => g.models)

  it.each(IPHONE_GENERATIONS.map((g) => [g.label, g] as const))(
    '%s → 대표 이름과 묶음 안 기종이 모두 같은 초점',
    (_label, g) => {
      const expected = focalPx(resolve(g.value))
      expect(resolve(g.value)).toMatch(/^iphone/)
      expect(expected).not.toBeNull()
      for (const model of g.models) expect(focalPx(resolve(model)), model).toBe(expected)
    },
  )

  it('세대별 초점은 1018·1222·1273 px 세 값이다', () => {
    const byLabel = Object.fromEntries(
      IPHONE_GENERATIONS.map((g) => [g.label, focalPx(resolve(g.value))]),
    )
    expect(byLabel).toEqual({
      'iPhone 18': 1018.3,
      'iPhone 17': 1018.3,
      'iPhone 17e': 1222,
      'iPhone 16': 1222,
      'iPhone 15': 1222,
      'iPhone 14': 1222,
      'iPhone 13': 1272.9,
      'iPhone 12': 1272.9,
    })
  })

  it('렌즈 표의 아이폰 match가 모두 어느 세대엔가 들어 있다', () => {
    const names = Object.entries(profiles)
      .filter(([key]) => !key.startsWith('_'))
      .flatMap(([, p]) => p.match ?? [])
      .filter((m) => m.startsWith('iPhone '))
    for (const name of names) expect(allModels).toContain(name)
  })

  it('기종은 한 세대에만 든다', () => {
    expect(new Set(allModels).size).toBe(allModels.length)
  })

  it('예전 시트에서 고른 기종 이름도 세대로 되돌린다', () => {
    expect(iphoneGenerationOf('iPhone 16 Pro Max')?.value).toBe('iPhone 16')
    expect(iphoneGenerationOf('iPhone Air')?.value).toBe('iPhone 17')
    expect(iphoneGenerationOf('iPhone 17e')?.value).toBe('iPhone 17e')
    expect(iphoneGenerationOf('iPhone 18 Pro')?.label).toBe('iPhone 18')
    expect(iphoneGenerationOf('Pixel 9')).toBeNull()
    expect(iphoneGenerationOf(null)).toBeNull()
  })
})

describe('readDeviceModel', () => {
  it('userAgentData의 model을 쓴다', async () => {
    await expect(
      readDeviceModel({
        userAgent: PIXEL,
        userAgentData: { getHighEntropyValues: async () => ({ model: 'Pixel 9' }) },
      }),
    ).resolves.toBe('Pixel 9')
  })

  it('없으면 UA의 삼성 모델명, 그것도 없으면 null', async () => {
    await expect(readDeviceModel({ userAgent: GALAXY })).resolves.toBe('SM-S928N')
    await expect(
      readDeviceModel({
        userAgent: IPHONE,
        userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('x')) },
      }),
    ).resolves.toBeNull()
  })
})
