import { describe, expect, it } from 'vitest'
import { placeCard } from './TutorialCard'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const STAGE = { top: 300, left: 500, width: 560, height: 560 }

describe('안내 카드 자리', () => {
  it('3D를 만지는 단계는 무대 아래 가운데, 창 안에', () => {
    const place = placeCard('stage', null, STAGE, DESKTOP, 150)
    expect(place.width).toBe(480)
    expect(place.left + place.width / 2).toBe(780)
    expect(place.top + 150).toBeLessThanOrEqual(DESKTOP.height - 16)
  })

  it('화면 위쪽 도구 줄 버튼은 바로 아래에 붙인다', () => {
    const button = { top: 100, left: 1300, width: 36, height: 36 }
    const place = placeCard('target', button, STAGE, DESKTOP, 120)
    expect(place.top).toBe(100 + 36 + 14)
    expect(place.left + place.width).toBeLessThanOrEqual(DESKTOP.width - 16)
  })

  it('넓은 화면에서 오른쪽 패널 안 대상은 왼쪽에 붙여 패널을 가리지 않는다', () => {
    const rail = { top: 400, left: 1060, width: 120, height: 40 }
    const place = placeCard('target', rail, STAGE, DESKTOP, 120)
    expect(place.left + place.width).toBe(1060 - 14)
    expect(place.top).toBe(400 + 20 - 60)
  })

  it('좁은 화면 아래쪽 대상은 위에 붙인다', () => {
    const sheetRow = { top: 700, left: 20, width: 350, height: 60 }
    const place = placeCard('target', sheetRow, null, PHONE, 130)
    expect(place.width).toBe(340)
    expect(place.top).toBe(700 - 14 - 130)
  })
})
