import { describe, expect, it } from 'vitest'
import { createMotionProbe } from './motionProbe'

const UP = { x: 0, y: 9.8, z: 0 }

describe('motionProbe (자이로 원인 확인용, -733)', () => {
  it('세 축 각속도를 시간으로 쌓는다(값 단위 그대로)', () => {
    const p = createMotionProbe()
    // 1초 동안 gamma 90/초 → gamma 누적 90
    for (let t = 0; t <= 1000; t += 50) p.add(t, { alpha: 0, beta: 0, gamma: 90 }, UP, 50)
    const s = p.snapshot()
    expect(s.gamma).toBeCloseTo(90, 5)
    expect(s.alpha).toBe(0)
    expect(s.beta).toBe(0)
  })

  it('지금 계산(verticalRate)으로 쌓은 값도 같이 낸다', () => {
    const p = createMotionProbe()
    for (let t = 0; t <= 1000; t += 50) p.add(t, { alpha: 0, beta: 90, gamma: 0 }, UP, 50)
    // 세워 들면 중력이 y축이라 투영 = beta(기기 y축, -733 실측)
    expect(p.snapshot().vertical).toBeCloseTo(90, 5)
  })

  it('200 ms 넘는 공백은 쌓지 않는다(기록과 같은 규칙)', () => {
    const p = createMotionProbe()
    p.add(0, { alpha: 0, beta: 0, gamma: 90 }, UP, 16)
    p.add(500, { alpha: 0, beta: 0, gamma: 90 }, UP, 16)
    expect(p.snapshot().gamma).toBe(0)
  })

  it('마지막 중력·interval·표본 수를 남긴다', () => {
    const p = createMotionProbe()
    p.add(0, { alpha: 1, beta: 2, gamma: 3 }, { x: 0.1, y: -9.7, z: 1.2 }, 0.016)
    const s = p.snapshot()
    expect(s.gravity).toEqual({ x: 0.1, y: -9.7, z: 1.2 })
    expect(s.interval).toBe(0.016)
    expect(s.count).toBe(1)
  })

  it('reset이면 0부터 다시 쌓는다', () => {
    const p = createMotionProbe()
    for (let t = 0; t <= 1000; t += 50) p.add(t, { alpha: 10, beta: 0, gamma: 0 }, UP, 50)
    p.reset()
    expect(p.snapshot()).toMatchObject({ alpha: 0, beta: 0, gamma: 0, vertical: 0, count: 0 })
  })

  it('값이 없는 축은 0으로 보고, 각속도가 통째로 없으면 건너뛴다', () => {
    const p = createMotionProbe()
    p.add(0, null, UP, 16)
    p.add(50, null, UP, 16)
    expect(p.snapshot().count).toBe(0)
  })

  it('디버그 한 줄', () => {
    const p = createMotionProbe()
    for (let t = 0; t <= 1000; t += 50) p.add(t, { alpha: 0, beta: 90, gamma: 0 }, UP, 50)
    expect(p.text()).toBe(
      '자이로 α 0 β 90 γ 0 · 투영 90 · 중력 0.0/9.8/0.0 · interval 50 · 표본 21',
    )
  })
})
