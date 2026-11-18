/**
 * 랜딩 무대의 스크롤 값(.run/landing-video/landing-r3f/src/scroll.js를 옮김, 2026-10-31).
 *
 * 숫자 하나가 페이지 전체를 움직인다: `sf` = 구간 번호 + 화면 가운데가 그 구간을 얼마나 지났는지.
 * 0.5 = 첫 화면 가운데, 1.5 = '읽기' 가운데 … 3D 무대와 문구가 매 프레임 이 값을 읽는다.
 * 스크롤은 가로채지 않는다(기본 스크롤). 화면을 떠나면 LandingStage가 값을 처음으로 되돌린다.
 */
export interface LandingScroll {
  sf: number
  /** 화면 위 머리 위치(px)와 크기 배율. 거대 글자가 따라간다 */
  head?: { x: number; y: number; s: number }
  /** 첫 장면 스캔 진행(0~1) */
  intro?: number
  /** 미리보기 구간의 콧대 값(0~1, 서비스 슬라이더 단위) */
  bridge?: number
  mx?: number
  my?: number
}

export const scroll: LandingScroll = { sf: 0.5 }

export function resetScroll() {
  scroll.sf = 0.5
  scroll.head = undefined
  scroll.intro = 0
  scroll.bridge = 0
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1)
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

/** 구간(`[data-landing-sec]`) 위치로 sf를 잰다 */
export function measure(): number {
  const secs = document.querySelectorAll('[data-landing-sec]')
  const mid = innerHeight / 2
  let sf = 0
  secs.forEach((s, i) => {
    const r = s.getBoundingClientRect()
    if (r.top <= mid) sf = i + clamp((mid - r.top) / r.height, 0, 1)
  })
  scroll.sf = sf
  return sf
}

/** 열쇠 값 사이를 단조 3차 곡선으로 잇는다: 끊기지 않는 카메라 하나 */
export function track(keys: readonly (readonly [number, number])[]) {
  const ts = keys.map((k) => k[0])
  const vs = keys.map((k) => k[1])
  const n = ts.length
  const h: number[] = []
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h[i] = ts[i + 1] - ts[i]
    d[i] = (vs[i + 1] - vs[i]) / h[i]
  }
  const m = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1]
      const w2 = h[i] + 2 * h[i - 1]
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    }
  }
  return (t: number) => {
    if (t <= ts[0]) return vs[0]
    if (t >= ts[n - 1]) return vs[n - 1]
    let i = 0
    while (t > ts[i + 1]) i++
    const s = (t - ts[i]) / h[i]
    const s2 = s * s
    const s3 = s2 * s
    return (
      (2 * s3 - 3 * s2 + 1) * vs[i] +
      (s3 - 2 * s2 + s) * h[i] * m[i] +
      (-2 * s3 + 3 * s2) * vs[i + 1] +
      (s3 - s2) * h[i] * m[i + 1]
    )
  }
}

/** 머리가 가운데(첫·끝 화면)에서 얼마나 비켜났는지(0 = 가운데, 1 = 오른쪽) */
export const away = (sf: number) => ease(ramp(sf, 0.55, 1.1)) * (1 - ease(ramp(sf, 5.0, 5.4)))
