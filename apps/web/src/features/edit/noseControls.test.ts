import { describe, expect, it } from 'vitest'
import { noseControls, noseControlChanges, SAMPLE_NOSE_CATALOG } from './noseControls'

describe('코 부위별 조절', () => {
  it('네 슬라이더를 승인 범위의 1% 단위로 조절한다', () => {
    expect(noseControls(SAMPLE_NOSE_CATALOG, {}).map((control) => control.step)).toEqual([
      0.01, 0.01, 0.01, 0.01,
    ])
    expect(SAMPLE_NOSE_CATALOG.parts[0].items.every((item) => item.step === 0.01)).toBe(true)
  })

  it('내림의 높이·회전을 한 묶음으로 반대 부호에 저장한다', () => {
    const control = noseControls(SAMPLE_NOSE_CATALOG, {})[2]
    expect(noseControlChanges(control, 0.5)).toEqual([
      { code: 'nose.tip_height', value: -0.3 },
      { code: 'nose.tip_rotation', value: -0.2 },
    ])
    expect(
      noseControls(SAMPLE_NOSE_CATALOG, { 'nose.tip_height': -0.3, 'nose.tip_rotation': -0.2 })[2]
        .value,
    ).toBe(0.5)
  })
  it('기존 개별 값은 평균으로 덮지 않고 구분한다', () => {
    const weights = { 'nose.tip_height': 0.6, 'nose.tip_rotation': 0.1 }
    expect(noseControls(SAMPLE_NOSE_CATALOG, weights)[2].mixed).toBe(true)
    expect(weights).toEqual({ 'nose.tip_height': 0.6, 'nose.tip_rotation': 0.1 })
  })
  it('두 코드 중 하나라도 실제 모델에 없으면 내림을 막는다', () => {
    const control = noseControls(SAMPLE_NOSE_CATALOG, {}, ['nose.tip_height'])[2]
    expect(control.unavailable).toBe(true)
    expect(noseControlChanges(control, 0.5)).toEqual([])
    expect(noseControls(SAMPLE_NOSE_CATALOG, {}, null).every((c) => c.unavailable)).toBe(true)
  })
  it('회전 코드가 없는 이전 카탈로그에 새 코드를 쓰지 않는다', () => {
    const catalog = structuredClone(SAMPLE_NOSE_CATALOG)
    catalog.parts[0].items = catalog.parts[0].items.filter((p) => p.code !== 'nose.tip_rotation')
    expect(noseControlChanges(noseControls(catalog, {})[2], 1)).toEqual([])
  })
  it('카탈로그 범위의 교집합을 지키고 잘못된 입력을 막는다', () => {
    const catalog = structuredClone(SAMPLE_NOSE_CATALOG)
    catalog.parts[0].items.find((p) => p.code === 'nose.tip_rotation')!.min = -0.2
    const control = noseControls(catalog, {})[2]
    expect(control.max).toBe(1)
    expect(control.rawMax).toBe(0.5)
    expect(noseControlChanges(control, 1)[1].value).toBe(-0.2)
    expect(noseControlChanges(control, NaN)).toEqual([])
    catalog.parts[0].items.find((p) => p.code === 'nose.tip_rotation')!.min = 2
    expect(noseControls(catalog, {})[2].unavailable).toBe(true)
  })
  it('승인된 비대칭 안전 범위를 화면의 -100%~+100%에 대응시킨다', () => {
    const catalog = structuredClone(SAMPLE_NOSE_CATALOG)
    const bridge = catalog.parts[0].items.find((p) => p.code === 'nose.bridge_height')!
    bridge.min = -0.25
    bridge.max = 0.4
    const control = noseControls(catalog, { 'nose.bridge_height': 0.2 })[0]
    expect([control.min, control.value, control.max]).toEqual([-1, 0.5, 1])
    expect(noseControlChanges(control, -1)).toEqual([{ code: 'nose.bridge_height', value: -0.25 }])
    expect(noseControlChanges(control, 1)).toEqual([{ code: 'nose.bridge_height', value: 0.4 }])
    expect(noseControlChanges(control, 0)).toEqual([{ code: 'nose.bridge_height', value: 0 }])
  })
  it('한 방향만 승인된 조절은 중립에서 그 방향으로만 움직인다', () => {
    const catalog = structuredClone(SAMPLE_NOSE_CATALOG)
    const bridge = catalog.parts[0].items.find((p) => p.code === 'nose.bridge_height')!
    bridge.min = 0
    bridge.max = 0.5
    const [control] = noseControls(catalog, {})
    expect([control.min, control.max, control.unavailable]).toEqual([0, 1, false])
    expect(noseControlChanges(control, -1)).toEqual([{ code: bridge.code, value: 0 }])
    expect(noseControlChanges(control, 1)).toEqual([{ code: bridge.code, value: 0.5 }])
    expect(noseControls(catalog, { [bridge.code]: 0.25 })[0].value).toBe(0.5)
  })
})
