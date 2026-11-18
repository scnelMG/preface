import { describe, expect, it } from 'vitest'
import {
  bangsFromMask,
  eyeWearFromMask,
  maskCategories,
  maskLooksBroken,
  maskSummary,
  poseFromResult,
  segmentationGuard,
  type Landmark,
} from './faceTracker'

/** 열 우선 4×4 행렬. 합성 회전만 만든다 */
function matrix({ yaw = 0, pitch = 0 }: { yaw?: number; pitch?: number }) {
  const y = (yaw * Math.PI) / 180
  const p = (pitch * Math.PI) / 180
  const m = new Array(16).fill(0)
  m[0] = 1
  m[5] = 1
  m[10] = Math.cos(p) * Math.cos(y)
  m[2] = -Math.sin(y)
  m[6] = Math.sin(p) * Math.cos(y)
  m[15] = 1
  return { data: m }
}

describe('poseFromResult', () => {
  it('촬영 기록용 각도(traceAngles)는 서버 식이고, 실제 회전이면 가이드 yaw와 부호가 같다(-641)', () => {
    // 열 우선 y축 회전(합성): R20 = -sin → m[2], R02 = sin → m[8]
    const t = (40 * Math.PI) / 180
    const m = new Array(16).fill(0)
    m[0] = Math.cos(t)
    m[2] = -Math.sin(t)
    m[5] = 1
    m[8] = Math.sin(t)
    m[10] = Math.cos(t)
    m[15] = 1
    const pose = poseFromResult({
      facialTransformationMatrixes: [{ data: m }],
      faceLandmarks: [
        [
          { x: 0.4, y: 0.3 },
          { x: 0.6, y: 0.6 },
        ],
      ],
    })
    expect(pose?.yaw).toBeCloseTo(40)
    expect(pose?.traceAngles?.yaw).toBeCloseTo(40)
    expect(pose?.traceAngles?.pitch).toBeCloseTo(0)
  })

  it('행렬에서 yaw = asin(-m[2]), pitch = atan2(m[6], m[10])', () => {
    const pose = poseFromResult({
      facialTransformationMatrixes: [matrix({ yaw: 30, pitch: -15 })],
      faceLandmarks: [
        [
          { x: 0.4, y: 0.3 },
          { x: 0.6, y: 0.6 },
        ],
      ],
      faceBlendshapes: [
        {
          categories: [
            { categoryName: 'eyeBlinkLeft', score: 0.9 },
            { categoryName: 'eyeBlinkRight', score: 0.2 },
          ],
        },
      ],
    })
    expect(pose?.yaw).toBeCloseTo(30)
    expect(pose?.pitch).toBeCloseTo(-15)
    expect(pose?.cx).toBeCloseTo(0.5)
    expect(pose?.cy).toBeCloseTo(0.45)
    expect(pose?.size).toBeCloseTo(0.3)
    // 한쪽만 감으면 감음이 아니다
    expect(pose?.blink).toBeCloseTo(0.2)
  })

  it('얼굴이 없으면 null', () => {
    expect(poseFromResult({ faceLandmarks: [], facialTransformationMatrixes: [] })).toBeNull()
  })
})

describe('bangsFromMask (합성 마스크)', () => {
  const W = 100
  const H = 100
  // 10번(이마 위) y=0.3, 눈썹 105·334 y=0.5, 좌우 x 0.4~0.6
  const lm: Landmark[] = []
  lm[10] = { x: 0.5, y: 0.3 }
  lm[105] = { x: 0.4, y: 0.5 }
  lm[334] = { x: 0.6, y: 0.5 }

  function mask(fill: (x: number, y: number) => number) {
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = fill(x, y)
    return m
  }

  it('이마가 다 피부면 0', () => {
    expect(
      bangsFromMask(
        mask(() => 3),
        W,
        H,
        lm,
      ),
    ).toEqual({ all: 0, top: 0, cover: 0 })
  })

  it('이마가 다 머리카락이면 모두 1', () => {
    expect(
      bangsFromMask(
        mask(() => 1),
        W,
        H,
        lm,
      ),
    ).toEqual({ all: 1, top: 1, cover: 1 })
  })

  it('이마 위쪽만 머리카락(헤어라인 위 띠도 머리카락)', () => {
    const m = bangsFromMask(
      mask((_, y) => (y < 36 ? 1 : 3)),
      W,
      H,
      lm,
    )
    // 이마 30~47행 중 30~35행(6/17)이 머리카락, 위 1/3(30~35행)은 전부
    expect(m?.all).toBeCloseTo(6 / 17)
    expect(m?.top).toBe(1)
    expect(m?.cover).toBe(1)
  })

  it('10번 바로 위가 머리띠(옷·기타)면 헤어라인 가림이 아니다', () => {
    for (const band of [4, 5, 0]) {
      // 10번(30행)까지 22~30행이 머리띠, 그 아래 이마는 피부
      const m = bangsFromMask(
        mask((_, y) => (y < 22 ? 1 : y <= 30 ? band : 3)),
        W,
        H,
        lm,
      )
      expect(m?.cover).toBe(0)
      expect(m?.all).toBe(0)
    }
  })

  it('10번 바로 위가 머리카락이고 피부가 없으면 가림', () => {
    const m = bangsFromMask(
      mask((_, y) => (y < 26 ? 4 : y <= 30 ? 1 : 3)),
      W,
      H,
      lm,
    )
    expect(m?.cover).toBe(1)
  })

  it('눈썹 바깥 끝(70·300번)이 있으면 이마 양옆까지 잰다(-721, 옆으로 흐른 앞머리)', () => {
    const wide = [...lm]
    wide[70] = { x: 0.3, y: 0.5 }
    wide[300] = { x: 0.7, y: 0.5 }
    // 가운데(0.4~0.6)는 피부, 양옆(0.3~0.4, 0.6~0.7)만 머리카락
    const sides = mask((x) => (x < 40 || x >= 60 ? 1 : 3))
    expect(bangsFromMask(sides, W, H, lm)?.all).toBe(0)
    expect(bangsFromMask(sides, W, H, wide)?.all).toBeGreaterThan(0.3)
  })

  it('영역이 너무 작으면 null', () => {
    const tiny: Landmark[] = []
    tiny[10] = { x: 0.5, y: 0.5 }
    tiny[105] = { x: 0.5, y: 0.51 }
    tiny[334] = { x: 0.51, y: 0.51 }
    expect(
      bangsFromMask(
        mask(() => 3),
        W,
        H,
        tiny,
      ),
    ).toBeNull()
  })
})

describe('eyeWearFromMask (합성 마스크)', () => {
  const W = 100
  const H = 100
  // 눈썹 105·334 y=0.5, 눈 바깥 33·263 x 0.35~0.65, 아래 눈꺼풀 145·374 y=0.6
  // → 영역 x 0.32~0.68, y 0.53~0.65
  const lm: Landmark[] = []
  lm[105] = { x: 0.4, y: 0.5 }
  lm[334] = { x: 0.6, y: 0.5 }
  lm[33] = { x: 0.35, y: 0.55 }
  lm[263] = { x: 0.65, y: 0.55 }
  lm[145] = { x: 0.4, y: 0.6 }
  lm[374] = { x: 0.6, y: 0.6 }

  function mask(fill: (x: number, y: number) => number) {
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = fill(x, y)
    return m
  }

  it('눈 주변이 다 피부면 모두 0', () => {
    expect(
      eyeWearFromMask(
        mask(() => 3),
        W,
        H,
        lm,
      ),
    ).toEqual({ other: 0, hair: 0, clothes: 0, rimHair: 0 })
  })

  it('눈 주변이 다 기타(액세서리)면 기타 1', () => {
    expect(
      eyeWearFromMask(
        mask(() => 5),
        W,
        H,
        lm,
      ),
    ).toEqual({ other: 1, hair: 0, clothes: 0, rimHair: 0 })
  })

  it('영역 밖(눈썹 위·광대 아래)은 세지 않는다', () => {
    const m = eyeWearFromMask(
      mask((_, y) => (y < 50 || y > 70 ? 1 : 3)),
      W,
      H,
      lm,
    )
    expect(m).toEqual({ other: 0, hair: 0, clothes: 0, rimHair: 0 })
  })

  it('안경테처럼 일부만 기타·머리카락·옷이면 비율', () => {
    const m = eyeWearFromMask(
      mask((x) => (x < 44 ? 5 : x < 56 ? 1 : 4)),
      W,
      H,
      lm,
    )
    expect(m?.other).toBeCloseTo(12 / 36, 1)
    expect(m?.hair).toBeCloseTo(12 / 36, 1)
    expect(m?.clothes).toBeCloseTo(12 / 36, 1)
  })

  // -721: 아래 띠 = 아래 눈꺼풀(y 0.6) ~ +0.5h(y 0.65), 눈썹이 닿지 않는 곳
  it('검은 테 아래 테(머리카락)는 아래 띠 머리카락으로 센다', () => {
    const m = eyeWearFromMask(
      mask((_, y) => (y >= 62 && y < 64 ? 1 : 3)),
      W,
      H,
      lm,
    )
    expect(m?.other).toBe(0)
    expect(m?.rimHair).toBeGreaterThan(0.3)
  })

  it('짙은 눈썹(영역 위쪽 머리카락)은 아래 띠에 넣지 않는다', () => {
    const m = eyeWearFromMask(
      mask((_, y) => (y >= 53 && y < 56 ? 1 : 3)),
      W,
      H,
      lm,
    )
    expect(m?.hair).toBeGreaterThan(0)
    expect(m?.rimHair).toBe(0)
  })

  it('눈 점이 없으면 null', () => {
    const partial: Landmark[] = []
    partial[105] = lm[105]!
    partial[334] = lm[334]!
    expect(
      eyeWearFromMask(
        mask(() => 5),
        W,
        H,
        partial,
      ),
    ).toBeNull()
  })
})

describe('maskSummary (기기별 분할 확인, -716)', () => {
  it('마스크 크기와 분류별 비율을 많은 순으로 보인다', () => {
    const mask = new Uint8Array(100)
    mask.fill(1, 0, 20) // 머리카락 20%
    mask.fill(3, 20, 70) // 얼굴 피부 50%
    expect(maskSummary(mask, 10, 10)).toBe('마스크 10x10 3:50% 0:30% 1:20%')
  })

  it('분류 번호가 0~5 밖이어도 그대로 보인다(값이 깨졌는지 보려고)', () => {
    const mask = new Uint8Array(4).fill(255)
    expect(maskSummary(mask, 2, 2)).toBe('마스크 2x2 255:100%')
  })
})

describe('maskCategories (-869)', () => {
  it('분류 번호/255 소수를 반올림해 번호로 바꾼다', () => {
    const exact = Float32Array.from([0, 1, 2, 3, 4, 5].map((c) => c / 255))
    expect([...maskCategories(exact).data]).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('소수가 조금 낮게 읽히는 기기(일부 아이폰)에서도 번호가 한 칸 밀리지 않는다', () => {
    // 라이브러리 getAsUint8Array는 255를 곱해 버림: 2.996 → 2. 옷이 얼굴 피부로, 머리카락이 배경으로 읽혔다
    const low = Float32Array.from([0, 1, 2, 3, 4, 5].map((c) => (c - 0.004) / 255))
    const { data, drift } = maskCategories(low)
    expect([...data]).toEqual([0, 1, 2, 3, 4, 5])
    expect(drift).toBeCloseTo(-0.004, 3)
  })

  it('정확한 값이면 오차는 0이다', () => {
    expect(maskCategories(Float32Array.from([0, 3 / 255])).drift).toBeCloseTo(0, 4)
  })
})

describe('maskLooksBroken (-718)', () => {
  const W = 100
  const H = 100
  // 얼굴 점이 x 0.3~0.7, y 0.2~0.8에 있다
  const lm: Landmark[] = [
    { x: 0.3, y: 0.2 },
    { x: 0.7, y: 0.8 },
    { x: 0.5, y: 0.5 },
  ]
  const fill = (inFace: number, outside = 0) => {
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const face = x >= 30 && x < 70 && y >= 20 && y < 80
        m[y * W + x] = face ? inFace : outside
      }
    return m
  }

  it('얼굴이 보이는데 마스크가 전부 배경이면 깨진 것이다(갤럭시 0:100%)', () => {
    expect(maskLooksBroken(new Uint8Array(W * H), W, H, lm)).toBe(true)
  })

  it('얼굴 자리에 피부가 있으면 정상이다', () => {
    expect(maskLooksBroken(fill(3), W, H, lm)).toBe(false)
  })

  it('얼굴 자리가 머리카락·안경으로 많이 덮여도 피부가 조금(5% 이상) 있으면 정상이다', () => {
    const m = fill(1)
    // 얼굴 상자(40x60=2400칸) 중 맨 아래 3줄(120칸, 5%)만 피부
    for (let y = 77; y < 80; y++) for (let x = 30; x < 70; x++) m[y * W + x] = 2
    expect(maskLooksBroken(m, W, H, lm)).toBe(false)
  })

  it('얼굴 점이 없으면 판단하지 않는다(false)', () => {
    expect(maskLooksBroken(new Uint8Array(W * H), W, H, [])).toBe(false)
  })
})

describe('segmentationGuard (-718)', () => {
  it('깨진 마스크가 3번 이어지면 CPU로 다시 띄우라고 한다', () => {
    const g = segmentationGuard(3)
    expect([g.report(true), g.report(true), g.report(true)]).toEqual(['keep', 'keep', 'cpu'])
  })

  it('중간에 정상 마스크가 오면 다시 센다', () => {
    const g = segmentationGuard(3)
    g.report(true)
    g.report(true)
    expect(g.report(false)).toBe('keep')
    expect([g.report(true), g.report(true)]).toEqual(['keep', 'keep'])
  })

  it('CPU에서도 3번 이어지면 포기한다(직접 확인으로)', () => {
    const g = segmentationGuard(3)
    for (let i = 0; i < 3; i++) g.report(true)
    expect([g.report(true), g.report(true), g.report(true)]).toEqual(['keep', 'keep', 'dead'])
    expect(g.report(true)).toBe('keep')
  })
})
