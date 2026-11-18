import { verticalRate } from './captureTrace'

/**
 * 자이로 원인 확인용(S15P31B204-733). 디버그 화면에서만 쓴다(판정·기록에는 쓰지 않는다).
 *
 * 녹화 기록의 `gyro`는 실제 폰 회전(약 190°)의 일부(10~20°)만 쌓였다. 투영 결과 하나만 남아 원인을 가릴 수 없어서,
 * `rotationRate` 세 축을 **단위를 바꾸지 않고** 각각 시간으로 쌓고, 지금 계산(`verticalRate`)으로 쌓은 값과 나란히 보인다.
 * 폰을 세워 든 채 제자리에서 90° 돌렸을 때
 * - 어느 축이 90(도/초) 또는 1.57(라디안/초)이 되는지 → 축 대응·단위
 * - 투영 값의 부호 → 기종별 중력 부호
 * 를 읽는다. `interval`은 브라우저가 준 값 그대로(ms 또는 초).
 */

type Rate = { alpha: number | null; beta: number | null; gamma: number | null }
type Gravity = { x: number | null; y: number | null; z: number | null }

/** 기록(`CaptureTraceRecorder.motion`)과 같은 규칙: 이보다 긴 공백은 쌓지 않는다 */
const MAX_GAP_MS = 200

export interface MotionSnapshot {
  alpha: number
  beta: number
  gamma: number
  vertical: number
  gravity: Gravity | null
  interval: number | null
  count: number
}

export function createMotionProbe() {
  let s: MotionSnapshot
  let last: number | null
  const reset = () => {
    s = { alpha: 0, beta: 0, gamma: 0, vertical: 0, gravity: null, interval: null, count: 0 }
    last = null
  }
  reset()

  return {
    add(
      now: number,
      rate: Rate | null | undefined,
      gravity: Gravity | null | undefined,
      interval: number | null | undefined,
      apple = false,
    ) {
      if (!rate) return
      if (last !== null) {
        const dt = now - last
        if (dt > 0 && dt <= MAX_GAP_MS) {
          const sec = dt / 1000
          s.alpha += (rate.alpha ?? 0) * sec
          s.beta += (rate.beta ?? 0) * sec
          s.gamma += (rate.gamma ?? 0) * sec
          s.vertical += (verticalRate(rate, gravity, apple) ?? 0) * sec
        }
      }
      last = now
      s.count++
      if (gravity) s.gravity = { x: gravity.x, y: gravity.y, z: gravity.z }
      if (interval != null) s.interval = interval
    },
    reset,
    snapshot(): MotionSnapshot {
      return { ...s, gravity: s.gravity ? { ...s.gravity } : null }
    },
    /** 디버그 화면 한 줄. 각도는 소수 첫째 자리까지(라디안 단위면 1.6 같은 값이 보인다) */
    text(): string {
      const n = (v: number) => String(Math.round(v * 10) / 10)
      const g = s.gravity
      const gv = (v: number | null) => (v == null ? '-' : v.toFixed(1))
      return `자이로 α ${n(s.alpha)} β ${n(s.beta)} γ ${n(s.gamma)} · 투영 ${n(s.vertical)} · 중력 ${
        g ? `${gv(g.x)}/${gv(g.y)}/${gv(g.z)}` : '-'
      } · interval ${s.interval ?? '-'} · 표본 ${s.count}`
    },
  }
}
