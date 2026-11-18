import { describe, expect, it } from 'vitest'
import {
  CaptureTraceRecorder,
  isAppleMotion,
  TRACE_MAX_POINTS,
  TRACE_MAX_STEPS,
  serverHeadAngles,
  trackSettings,
  verticalRate,
} from './captureTrace'

/** 열 우선 4×4 회전 행렬(합성 값). y축으로 yaw, x축으로 pitch(도) */
function matrix(yawDeg: number, pitchDeg = 0): number[] {
  const y = (yawDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  // R = Ry(yaw) · Rx(pitch), 행 우선으로 계산한 뒤 열 우선으로 펼친다
  const ry = [
    [Math.cos(y), 0, Math.sin(y)],
    [0, 1, 0],
    [-Math.sin(y), 0, Math.cos(y)],
  ]
  const rx = [
    [1, 0, 0],
    [0, Math.cos(p), -Math.sin(p)],
    [0, Math.sin(p), Math.cos(p)],
  ]
  const r = ry.map((row) => [0, 1, 2].map((j) => row.reduce((s, v, k) => s + v * rx[k]![j]!, 0)))
  const out: number[] = []
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      out.push(row < 3 && col < 3 ? r[row]![col]! : row === col ? 1 : 0)
  return out
}

describe('serverHeadAngles (서버 video_scan.head_angles와 같은 식)', () => {
  it('y축 회전은 yaw, 부호를 그대로 둔다(뒤집지 않는다)', () => {
    expect(serverHeadAngles(matrix(30))!.yaw).toBeCloseTo(30, 5)
    expect(serverHeadAngles(matrix(-50))!.yaw).toBeCloseTo(-50, 5)
  })

  it('x축 회전은 pitch = asin(-R12)', () => {
    expect(serverHeadAngles(matrix(0, 20))!.pitch).toBeCloseTo(20, 5)
    expect(serverHeadAngles(matrix(0, -15))!.pitch).toBeCloseTo(-15, 5)
  })

  it('행렬이 없거나 짧으면 null', () => {
    expect(serverHeadAngles(undefined)).toBeNull()
    expect(serverHeadAngles([1, 2, 3])).toBeNull()
  })
})

describe('CaptureTraceRecorder', () => {
  const meta = {
    durationMs: 24_000,
    stopReason: 'complete' as const,
    stepsDone: 6,
    stepsTotal: 6,
    mimeType: 'video/mp4',
    bothSides: true,
  }

  it('녹화 시작 기준 ms로 [t, yaw, pitch, found]를 50ms(20 Hz)마다 남기고 소수 한 자리로 줄인다', () => {
    const rec = new CaptureTraceRecorder(1000)
    rec.sample(1000, { yaw: 55.123, pitch: -1.06 })
    rec.sample(1020, { yaw: 54, pitch: -1 }) // 50ms 안이라 버림
    rec.sample(1050, null)
    rec.sample(1100, { yaw: 50.04, pitch: 0 })
    expect(rec.build(meta, {}).trace).toEqual([
      [0, 55.1, -1.1, 1],
      [50, null, null, 0],
      [100, 50, 0, 1],
    ])
  })

  it(`trace는 ${TRACE_MAX_POINTS}점, steps는 ${TRACE_MAX_STEPS}개를 넘기지 않는다(서버 상한)`, () => {
    const rec = new CaptureTraceRecorder(0)
    for (let t = 0; t < (TRACE_MAX_POINTS + 50) * 50; t += 50) rec.sample(t, { yaw: 0, pitch: 0 })
    for (let i = 0; i < TRACE_MAX_STEPS + 5; i++) rec.step(`s${i}`, i * 10)
    const out = rec.build(meta, {})
    expect(out.trace).toHaveLength(TRACE_MAX_POINTS)
    expect(out.steps).toHaveLength(TRACE_MAX_STEPS)
  })

  it('단계는 시작 시각에 열고 다음 단계·끝에서 닫는다', () => {
    const rec = new CaptureTraceRecorder(1000)
    rec.step('recleft', 1000)
    rec.step('sweepleft', 1050)
    rec.step('backfront', 4200)
    expect(rec.build(meta, {}, 25_000).steps).toEqual([
      { name: 'recleft', startMs: 0, endMs: 50 },
      { name: 'sweepleft', startMs: 50, endMs: 3200 },
      { name: 'backfront', startMs: 3200, endMs: 24_000 },
    ])
  })

  it('버전·meta·trackSettings를 함께 담는다', () => {
    const rec = new CaptureTraceRecorder(0)
    const out = rec.build(meta, { width: 1920, height: 1080, frameRate: 30 })
    expect(out).toMatchObject({
      version: 1,
      trackerVersion: 'mediapipe-0.10.14',
      meta,
      trackSettings: { width: 1920, height: 1080, frameRate: 30 },
    })
    expect(typeof out.guideVersion).toBe('string')
  })
})

describe('trackSettings', () => {
  it('트랙 설정은 그대로 담되 기기 식별자(deviceId·groupId)는 뺀다', () => {
    const stream = {
      getVideoTracks: () => [
        {
          getSettings: () => ({
            width: 1080,
            height: 1920,
            frameRate: 30,
            resizeMode: 'none',
            deviceId: 'synthetic-device',
            groupId: 'synthetic-group',
          }),
        },
      ],
    } as unknown as MediaStream
    expect(trackSettings(stream)).toEqual({
      width: 1080,
      height: 1920,
      frameRate: 30,
      resizeMode: 'none',
    })
    expect(trackSettings(null)).toEqual({})
  })
})

describe('자이로 세로축 회전 (S15P31B204-677, 기록만)', () => {
  const META = {
    durationMs: 24_000,
    stopReason: 'complete' as const,
    stepsDone: 6,
    stepsTotal: 6,
    mimeType: 'video/mp4',
    bothSides: true,
  }
  const upright = { x: 0, y: 9.8, z: 0 } // 세워 든 휴대폰: 중력이 기기 y축
  const flat = { x: 0, y: 0, z: 9.8 } // 눕힌 휴대폰: 중력이 기기 z축

  it('세워 들든 눕히든 세상 세로축 둘레 회전만 고른다(안드로이드)', () => {
    // 실측(-733, 갤럭시 네이버 앱 11/09): 세워 들고 얼굴 둘레를 쓸면 beta가 +183° 쌓였다 → beta = 기기 y축
    expect(verticalRate({ alpha: 0, beta: 30, gamma: 0 }, upright)).toBeCloseTo(30)
    // alpha = 기기 x축(앞뒤로 숙임)은 세로축 회전이 아니다
    expect(verticalRate({ alpha: 40, beta: 0, gamma: 0 }, upright)).toBeCloseTo(0)
    // 눕히면 gamma = 기기 z축
    expect(verticalRate({ alpha: 0, beta: 0, gamma: 25 }, flat)).toBeCloseTo(25)
    // 45° 기울여 들어도 세로축 성분만
    const tilted = { x: 0, y: 9.8 * Math.SQRT1_2, z: 9.8 * Math.SQRT1_2 }
    expect(verticalRate({ alpha: 0, beta: 10, gamma: 10 }, tilted)).toBeCloseTo(10 * Math.SQRT2)
  })

  describe('아이폰(-733): 축은 같고 중력 부호만 반대다', () => {
    // 실측(아이폰 16 Pro, 11/09): 세워 들고 얼굴 둘레를 쓸면 beta가 약 +160° 쌓이고 중력 y는 -9.7
    const iosUpright = { x: 0, y: -9.8, z: 0 }
    const iosFlat = { x: 0, y: 0, z: -9.8 }

    it('세워 들고 돌면 beta(아이폰의 y축)가 세로축 회전이다', () => {
      expect(verticalRate({ alpha: 0, beta: 30, gamma: 0 }, iosUpright, true)).toBeCloseTo(30)
      // 아이폰의 alpha는 x축(앞뒤로 숙임)이라 세로축 회전이 아니다
      expect(verticalRate({ alpha: 40, beta: 0, gamma: 0 }, iosUpright, true)).toBeCloseTo(0)
      // 눕히면 gamma(아이폰의 z축)
      expect(verticalRate({ alpha: 0, beta: 0, gamma: 25 }, iosFlat, true)).toBeCloseTo(25)
    })

    it('같은 방향으로 돌면 안드로이드와 같은 부호다', () => {
      const android = verticalRate({ alpha: 0, beta: 30, gamma: 0 }, upright)
      const ios = verticalRate({ alpha: 0, beta: 30, gamma: 0 }, iosUpright, true)
      expect(Math.sign(ios!)).toBe(Math.sign(android!))
    })

    it('브라우저 정보로 아이폰·아이패드를 가린다', () => {
      expect(
        isAppleMotion({
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
          maxTouchPoints: 5,
        }),
      ).toBe(true)
      // iPadOS는 데스크톱 Mac으로 보이지만 터치가 된다
      expect(
        isAppleMotion({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          maxTouchPoints: 5,
        }),
      ).toBe(true)
      expect(
        isAppleMotion({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          maxTouchPoints: 0,
        }),
      ).toBe(false)
      expect(
        isAppleMotion({
          userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921N)',
          maxTouchPoints: 5,
        }),
      ).toBe(false)
    })
  })

  it('값이 없으면 null', () => {
    expect(verticalRate(null, upright)).toBeNull()
    expect(verticalRate({ alpha: null, beta: 0, gamma: 0 }, upright)).toBeNull()
    expect(verticalRate({ alpha: 0, beta: 0, gamma: 0 }, { x: 0, y: 0, z: 0.1 })).toBeNull()
  })

  it('각속도를 쌓아 약 20 Hz로 남기고, 센서 공백은 쌓지 않는다', () => {
    const rec = new CaptureTraceRecorder(1000)
    // 60 Hz로 1초 동안 초당 90° → 약 90°
    for (let i = 0; i <= 60; i++) rec.motion(1000 + (i * 1000) / 60, 90)
    let gyro = rec.build(META, {}).gyro!
    expect(gyro.length).toBeGreaterThanOrEqual(19)
    expect(gyro.length).toBeLessThanOrEqual(21)
    expect(gyro[0]).toEqual([0, 0])
    expect(gyro.at(-1)![1]).toBeCloseTo(90, 0)
    // 1초 공백(탭 전환) 뒤에는 그 사이를 쌓지 않는다
    rec.motion(3000, 90)
    rec.motion(3100, 90)
    gyro = rec.build(META, {}).gyro!
    expect(gyro.at(-1)![1]).toBeCloseTo(99, 0)
    rec.motion(3200, null) // 센서 값 없음: 무시
  })

  it('센서가 없으면 gyro를 싣지 않고, 상한을 넘기지 않는다', () => {
    expect(new CaptureTraceRecorder(0).build(META, {})).not.toHaveProperty('gyro')
    const rec = new CaptureTraceRecorder(0)
    for (let i = 0; i < TRACE_MAX_POINTS + 50; i++) rec.motion(i * 60, 1)
    expect(rec.build(META, {}).gyro).toHaveLength(TRACE_MAX_POINTS)
  })
})
