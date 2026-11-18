import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { applyViewportFrame } from '@/features/viewer/viewportFraming'
import { presetCameraPosition } from '@/features/viewer/viewPresets'
import { MAIN_DESKTOP_SCALE, mainDesktopFrame, trialViewportFrame } from './trialFraming'

const phone = { width: 390, height: 844 }
/** 접힌 시트 위 무대(위 여백 60, 접힘 220)와 펼친 시트 위 무대(시트 540)의 측정값 */
const closed = { width: 390, height: 500, offsetX: 0, offsetY: 80 }
const opened = { width: 390, height: 244, offsetX: 0, offsetY: 240 }

describe('휴대폰 전체 화면 체험의 얼굴 크기', () => {
  it('무대 높이와 관계없이 화면 크기로 배율을 정한다', () => {
    const a = trialViewportFrame(closed, phone)
    const b = trialViewportFrame(opened, phone)
    expect(a.height).toBe(b.height)
    // 중심은 남은 무대를 따라간다
    expect(a.offsetY).toBe(80)
    expect(b.offsetY).toBe(240)
  })

  it('흔한 휴대폰에서 예전 상한(500px)보다 크게 그린다', () => {
    expect(trialViewportFrame(closed, phone).height).toBe(641)
    expect(trialViewportFrame(closed, { width: 430, height: 932 }).height).toBeGreaterThan(600)
  })

  it('짧은 화면은 높이에 맞춰 줄인다', () => {
    expect(trialViewportFrame(closed, { width: 375, height: 667 }).height).toBe(507)
  })

  it('기본 45° 시점에서 머리가 화면 폭·접힌 무대 안에 들어온다', () => {
    const frame = trialViewportFrame(closed, phone)
    const cam = new PerspectiveCamera(30, phone.width / phone.height, 0.1, 100)
    cam.position.set(...presetCameraPosition('threeQuarter', 6.2, [0, 0, 0], 4))
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    applyViewportFrame(cam, phone, frame)
    // 기본 모델 머리(장면 단위): 폭 1.77, 높이 2.4, 깊이 1.63의 타원체
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i <= 24; i++) {
      for (let k = 0; k < 24; k++) {
        const theta = (Math.PI * i) / 24
        const phi = (2 * Math.PI * k) / 24
        const p = new Vector3(
          0.885 * Math.sin(theta) * Math.cos(phi),
          1.2 * Math.cos(theta),
          0.815 * Math.sin(theta) * Math.sin(phi),
        ).project(cam)
        xs.push(((p.x + 1) * phone.width) / 2)
        ys.push(((1 - p.y) * phone.height) / 2)
      }
    }
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThan(phone.width)
    // 접힌 시트 위 무대(60~624px) 안
    expect(Math.min(...ys)).toBeGreaterThan(60)
    expect(Math.max(...ys)).toBeLessThan(624)
  })
})

describe('메인 데스크톱 얼굴 크기 (S15P31B204-840)', () => {
  const measured = { width: 800, height: 500, offsetX: 0, offsetY: 0 }
  it('무대를 키운 배율만큼 예전 상한(500px)을 키워 얼굴 : 무대 비율을 그대로 둔다', () => {
    // 1920×1080: 예전 무대 580 · 얼굴 500 → 지금 무대 725 · 얼굴 625
    expect(
      mainDesktopFrame(measured, { width: 800, height: 580 * MAIN_DESKTOP_SCALE }).height,
    ).toBe(625)
    // 1440×900: 예전 무대 558 · 얼굴 500 → 지금 무대 698 · 얼굴 625
    expect(mainDesktopFrame(measured, { width: 540, height: 698 }).height).toBe(625)
  })
  it('무대가 상한보다 낮으면 무대 높이를 따른다', () => {
    expect(mainDesktopFrame(measured, { width: 500, height: 540 }).height).toBe(540)
  })
})
