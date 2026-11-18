import { describe, expect, it } from 'vitest'
import {
  GUIDE,
  GUIDE_STEPS,
  GuideEngine,
  STEP,
  bangsCovered,
  glassesOn,
  type FacePose,
  type GuideFrame,
  type PhoneTilt,
  type VoicePort,
} from './guideEngine'
import { VoiceScheduler } from './voicePlayer'

/** 합성 값만 쓴다. 실제 얼굴 자료는 없다 */
const FRONT: FacePose = { yaw: 0, pitch: 0, cx: 0.5, cy: 0.5, size: 0.28, blink: 0 }
const LEVEL: PhoneTilt = { beta: 90, fb: 0, side: 0 }
const TICK = 50
/** 앞머리·안경 없음. 검사는 이 수치가 있어야 통과한다(-633) */
const CLEAN_BANGS = { all: 0, top: 0, cover: 0, eyes: { other: 0, hair: 0, clothes: 0 } }

function pose(patch: Partial<FacePose> = {}): FacePose {
  return { ...FRONT, ...patch }
}

/** 말은 바로 끝난 것으로 본다(멈춤이 음성 끝을 기다리지 않게). 부른 것을 기록한다 */
function fakeVoice() {
  const said: { key: string; force: boolean }[] = []
  const warned: string[] = []
  const port: VoicePort & { busyNow: boolean } = {
    busyNow: false,
    busy() {
      return this.busyNow
    },
    say(key, options) {
      said.push({ key, force: !!options?.force })
      return true
    },
    warn(key) {
      warned.push(key)
      return true
    },
    cancel() {},
  }
  return { port, said, warned }
}

function setup() {
  const voice = fakeVoice()
  const engine = new GuideEngine(voice.port)
  return { engine, ...voice }
}

/** from부터 to까지(포함하지 않음) TICK 간격으로 같은 입력을 넣고 마지막 프레임을 돌려준다 */
function run(
  engine: GuideEngine,
  from: number,
  to: number,
  poseAt: (t: number) => FacePose | null,
  tilt: PhoneTilt = LEVEL,
  withBangs = true,
): GuideFrame {
  let frame!: GuideFrame
  for (let t = from; t < to; t += TICK)
    frame = engine.tick({
      now: t,
      pose: poseAt(t),
      tilt,
      bangs: withBangs && engine.phase === 'align' ? CLEAN_BANGS : undefined,
    })
  return frame
}

/** 정면 검사를 통과해 "오른쪽 끝으로" 단계가 된 시각 */
function passCheck(engine: GuideEngine, tilt: PhoneTilt = LEVEL): number {
  engine.begin(0)
  run(engine, 0, 2100, () => FRONT, tilt)
  expect(engine.phase).toBe('toside')
  return 2100
}

/**
 * 검사 통과 → 휴대폰을 옆 끝(sign × 50°)에 둔다 → 끝에 닿은 순간 녹화가 켜지고(S15P31B204-668) 1초 멈춘 뒤 녹화 단계(rec).
 * 녹화 단계가 시작된 시각. 녹화(recStart)는 그보다 1초 앞이다
 */
function startRecording(engine: GuideEngine, sign = 1, tilt: PhoneTilt = LEVEL): number {
  for (let t = passCheck(engine, tilt); t < 20_000; t += TICK) {
    engine.tick({ now: t, pose: pose({ yaw: sign * 50 }), tilt })
    if (engine.phase === 'rec') return t
  }
  throw new Error('녹화 단계가 시작되지 않았다')
}

/** 녹화 시작 뒤 오른쪽 끝 1초 멈춤이 끝나 "가운데로" 단계가 시작된 시각(얼굴은 아직 sign × 50°) */
function reachToFront(engine: GuideEngine, sign = 1): number {
  const t0 = startRecording(engine, sign)
  run(engine, t0 + TICK, t0 + 1100, () => pose({ yaw: sign * 50 }))
  expect(engine.stepIndex).toBe(STEP.toFront)
  return t0 + 1100
}

/** 가운데로 와서(정면 0.3초) "손 바꾸기"가 시작된 시각(-771) */
function reachSwitch(engine: GuideEngine, sign = 1): number {
  // 정면(±12°) 바로 바깥까지 쓸고 와서 정면 0.4초(0.3초에 손 바꾸기가 시작된다)
  const t = sweepTo(engine, reachToFront(engine, sign), sign * 50, sign * 15)
  run(engine, t, t + 400, () => FRONT)
  expect(engine.stepIndex).toBe(STEP.switchHand)
  return t + 400
}

/** 가운데 쉼 0.5초 + 손 바꾸기(안내 뒤 2초)를 마치고 "왼쪽 끝까지" 단계가 시작된 시각(얼굴은 정면) */
function reachSweep(engine: GuideEngine, sign = 1): number {
  const t = reachSwitch(engine, sign)
  run(engine, t, t + 2700, () => FRONT)
  expect(engine.stepIndex).toBe(STEP.sweep)
  return t + 2700
}

/** yaw를 천천히(초당 10°) target까지 옮긴다. 끝난 시각을 돌려준다 */
function sweepTo(engine: GuideEngine, from: number, yawFrom: number, target: number): number {
  const dir = Math.sign(target - yawFrom)
  let yaw = yawFrom
  let t = from
  while (dir * (target - yaw) > 0) {
    yaw += dir * 0.5
    engine.tick({ now: t, pose: pose({ yaw }), tilt: LEVEL })
    t += TICK
  }
  return t
}

/** "왼쪽 끝까지" 단계에서 정면(yaw 0)에 있는 시각(손 바꾸기를 정면에서 마쳤다) */
function midSweep(engine: GuideEngine): number {
  return reachSweep(engine)
}

/** 반대쪽 끝(정면을 지나 -50°)에 0.3초 머물러 왼쪽 단계를 마친 시각(-638) */
function reachLeftEnd(engine: GuideEngine, sign = 1): number {
  const t = sweepTo(engine, reachSweep(engine, sign), 0, -sign * 50)
  run(engine, t, t + 350, () => pose({ yaw: -sign * 50 }))
  expect(engine.stepIndex).toBe(STEP.front)
  return t + 350
}

/** 왼쪽 끝까지 마치고 "정면" 단계가 시작된 시각(얼굴은 아직 -50°) */
function reachFrontStep(engine: GuideEngine): number {
  const t = reachLeftEnd(engine)
  run(engine, t, t + 1100, () => pose({ yaw: -50 }))
  return t + 1100
}

/** 고개 위·아래를 마치고 마지막 "정면" 단계가 시작된 시각(얼굴은 옆 30°라 아직 정면 아님) */
function reachFinal(engine: GuideEngine): number {
  const t = reachHead(engine)
  run(engine, t, t + 1500, () => pose({ pitch: 25 }))
  run(engine, t + 1500, t + 2900, () => pose({ yaw: 30, pitch: -25 }))
  expect(engine.stepIndex).toBe(STEP.final)
  return t + 2900
}

/** 정면 2초 멈춤까지 마치고 "고개 위" 단계가 시작된 시각 */
function reachHead(engine: GuideEngine): number {
  const t = reachFrontStep(engine)
  run(engine, t, t + 2500, () => FRONT)
  expect(engine.stepIndex).toBe(STEP.headUp)
  return t + 2500
}

describe('기준표', () => {
  it('시험 페이지 v4 값과 같고, 순서는 우 → 가운데 → 손 바꾸기 → 좌 → 정면 → 위 → 아래 → 정면(-771)', () => {
    expect(GUIDE).toMatchObject({
      faceMin: 0.24,
      faceMax: 0.32,
      faceAspect: 0.88,
      centerTol: 0.12,
      sideYaw: 50,
      sideHoldSec: 1,
      frontHoldSec: 2,
      headPitch: 20,
      maxSpeed: 40,
      minSec: 24,
      maxSec: 70,
      maxHz: 20,
      finalHoldSec: 2,
      finalFrontTimeoutMs: 6000,
    })
    expect(GUIDE_STEPS.map((s) => s.key)).toEqual([
      'recleft',
      'tofront',
      'switchhand',
      'sweepleft',
      'backfront',
      'headup',
      'headdown',
      'backfront',
    ])
  })
})

describe('정면 검사(녹화 안 함)', () => {
  it('시작하면 맞추라는 안내를 낸다', () => {
    const { engine, said } = setup()
    engine.begin(0)
    expect(engine.phase).toBe('align')
    expect(said).toEqual([{ key: 'v4ready', force: true }])
  })

  it('조건을 2초 넘게 유지하면 통과하고, 녹화 없이 오른쪽부터 찍는다고 안내한다', () => {
    const { engine, said } = setup()
    engine.begin(0)
    let frame = run(engine, 0, 2000, () => FRONT)
    expect(frame.phase).toBe('align')
    expect(frame.message).toEqual({ text: '좋아요, 그대로', tone: 'ok' })
    expect(frame.oval).toBe('ok')

    frame = run(engine, 2000, 2100, () => FRONT)
    expect(frame.phase).toBe('toside')
    expect(frame.startRecording).toBe(false)
    expect(frame.message).toEqual({ text: '검사 완료', tone: 'ok' })
    expect(said.at(-1)).toEqual({ key: 'checkdone', force: true })
  })

  it('"검사 완료" 음성이 끝나고 1초 쉰 뒤 오른쪽 안내를 낸다(-782)', () => {
    const { engine, port, said } = setup()
    const t = passCheck(engine)
    // "검사 완료"가 0.9초 나오는 동안과 그 뒤 1초는 화면도 "검사 완료"
    port.busyNow = true
    run(engine, t, t + 900, () => FRONT)
    port.busyNow = false
    let frame = run(engine, t + 900, t + 1850, () => FRONT)
    expect(frame.message).toEqual({ text: '검사 완료', tone: 'ok' })
    expect(said.some((s) => s.key === 'toright')).toBe(false)
    frame = run(engine, t + 1850, t + 2000, () => FRONT)
    expect(said.at(-1)).toEqual({ key: 'toright', force: true })
    expect(frame.message).toEqual({ text: '휴대폰을 오른쪽 끝으로 →', tone: 'plain' })
  })

  it('오른쪽 안내 전에 이미 끝에 가 있으면 오른쪽 안내는 건너뛴다(-782)', () => {
    const { engine, said } = setup()
    const t = passCheck(engine)
    run(engine, t, t + 3000, () => pose({ yaw: 50 }))
    expect(engine.phase).toBe('rec')
    expect(said.some((s) => s.key === 'toright')).toBe(false)
  })

  it('중간에 한 번이라도 벗어나면 2초를 처음부터 다시 잰다', () => {
    const { engine } = setup()
    engine.begin(0)
    run(engine, 0, 1500, () => FRONT)
    engine.tick({ now: 1500, pose: pose({ size: 0.4 }), tilt: LEVEL })
    const frame = run(engine, 1550, 3500, () => FRONT)
    expect(frame.phase).toBe('align')
    expect(run(engine, 3500, 3700, () => FRONT).phase).toBe('toside')
  })

  it.each<[string, FacePose | null, PhoneTilt, string, string]>([
    ['얼굴 없음', null, LEVEL, '얼굴이 안 보여요', 'noface'],
    ['너무 가까움', pose({ size: 0.35 }), LEVEL, '더 멀리', 'v4farther'],
    ['너무 멂', pose({ size: 0.2 }), LEVEL, '더 가까이', 'closer'],
    ['아래에서 올려다봄', FRONT, { beta: 50, fb: 0, side: 0 }, '눈높이로 올려요', 'raise'],
    ['위에서 내려다봄', FRONT, { beta: 130, fb: 0, side: 0 }, '조금 내려요', 'lower'],
    ['가운데에서 벗어남', pose({ cx: 0.65 }), LEVEL, '얼굴을 테두리에 맞춰요', 'v4ready'],
    ['정면이 아님', pose({ yaw: 15 }), LEVEL, '정면을 봐요', 'lookfront'],
  ])('%s → "%s"', (_, p, tilt, hint, key) => {
    const { engine, said } = setup()
    engine.begin(0)
    const frame = engine.tick({ now: 0, pose: p, tilt })
    expect(frame.hint).toBe(hint)
    expect(frame.message).toEqual({ text: hint, tone: 'warn' })
    expect(frame.oval).toBe('warn')
    expect(said.at(-1)).toEqual({ key, force: false })
  })

  it('기울기 센서가 없으면 높이 확인은 건너뛴다', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({
      now: 0,
      pose: FRONT,
      tilt: { beta: null, fb: null, side: null },
      bangs: CLEAN_BANGS,
    })
    expect(frame.hint).toBe('')
  })

  it('같은 문제의 음성은 4초에 한 번만 낸다', () => {
    const { engine, said } = setup()
    engine.begin(0)
    run(engine, 0, 4000, () => null)
    expect(said.filter((s) => s.key === 'noface')).toHaveLength(1)
    run(engine, 4000, 4100, () => null)
    expect(said.filter((s) => s.key === 'noface')).toHaveLength(2)
  })

  it('앞머리가 이마를 덮으면 통과하지 않는다', () => {
    const { engine } = setup()
    engine.begin(0)
    let frame!: GuideFrame
    for (let t = 0; t < 3000; t += TICK)
      frame = engine.tick({
        now: t,
        pose: FRONT,
        tilt: LEVEL,
        bangs: { all: 0.2, top: 0, cover: 0 },
      })
    expect(frame.phase).toBe('align')
    expect(frame.hint).toBe('앞머리를 머리띠로 올려 주세요')
  })
})

describe('앞머리 판정 (세 기준 중 하나라도)', () => {
  it.each([
    // -721: 앞머리를 완전히 넘겨야 통과. 10·15·50% → 3·5·20%
    [{ all: 0.031, top: 0, cover: 0 }, true],
    [{ all: 0.03, top: 0, cover: 0 }, false],
    [{ all: 0, top: 0.051, cover: 0 }, true],
    [{ all: 0, top: 0.05, cover: 0 }, false],
    [{ all: 0, top: 0, cover: 0.21 }, true],
    [{ all: 0, top: 0, cover: 0.2 }, false],
  ])('%o → %s', (metrics, covered) => {
    expect(bangsCovered(metrics)).toBe(covered)
  })

  it('분할 결과가 없으면 막지 않는다', () => {
    expect(bangsCovered(null)).toBe(false)
  })

  it('이마는 검사 단계 정면(±15°)일 때만, 초당 4번까지 잰다', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(engine.wantsBangs(0, FRONT)).toBe(true)
    expect(engine.wantsBangs(100, FRONT)).toBe(false)
    expect(engine.wantsBangs(250, pose({ yaw: 20 }))).toBe(false)
    expect(engine.wantsBangs(250, FRONT)).toBe(true)
    expect(engine.wantsBangs(300, null)).toBe(false)
  })

  it('검사를 통과한 뒤에는 재지 않는다', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    expect(engine.wantsBangs(t + 1000, FRONT)).toBe(false)
  })

  it('크기 표시에 이마 수치를 붙인다', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(engine.tick({ now: 0, pose: FRONT, tilt: LEVEL }).sizeTag).toEqual({
      text: '얼굴 28% (목표 24~32%) · 이마 확인 중',
      tone: 'ok',
    })
    expect(
      engine.tick({ now: 50, pose: FRONT, tilt: LEVEL, bangs: { all: 0.05, top: 0.2, cover: 0.3 } })
        .sizeTag?.text,
    ).toBe('얼굴 28% (목표 24~32%) · 이마 5/3 위 20/5 헤어라인가림 30/20%')
    expect(
      engine.tick({ now: 100, pose: pose({ size: 0.4 }), tilt: LEVEL, bangsUnavailable: true })
        .sizeTag,
    ).toEqual({ text: '얼굴 40% (목표 24~32%) · 이마 판단 불가', tone: 'warn' })
    expect(engine.tick({ now: 150, pose: null, tilt: LEVEL }).sizeTag?.text).toBe(
      '얼굴 없음 · 이마 판단 불가',
    )
  })

  it('안경 시험 수치(눈 주변 분할 비율)를 크기 표시 끝에 붙인다', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(
      engine.tick({
        now: 0,
        pose: FRONT,
        tilt: LEVEL,
        bangs: { all: 0, top: 0, cover: 0, eyes: { other: 0.12, hair: 0.03, clothes: 0 } },
      }).sizeTag?.text,
    ).toBe(
      '얼굴 28% (목표 24~32%) · 이마 0/3 위 0/5 헤어라인가림 0/20% · 눈 주변 기타 12% 머리카락 3% 옷 0% 아래테 머리카락 0/3%',
    )
  })
})

describe('앞머리 수치를 기다림 (분할 모델 준비 전, -633)', () => {
  const clean = { all: 0, top: 0, cover: 0, eyes: { other: 0, hair: 0, clothes: 0 } }

  it('앞머리 수치가 아직 없으면 통과하지 않고 확인 중이라고 보인다(음성 없음)', () => {
    const { engine, said } = setup()
    engine.begin(0)
    said.length = 0
    let frame!: GuideFrame
    for (let t = 0; t < 5000; t += TICK) frame = engine.tick({ now: t, pose: FRONT, tilt: LEVEL })
    expect(frame.phase).toBe('align')
    expect(frame.hint).toBe('앞머리 확인 중')
    expect(frame.askBangsConfirm).toBe(false)
    expect(said).toEqual([])
  })

  it('수치가 오면 그때부터 2초 뒤 통과한다', () => {
    const { engine } = setup()
    engine.begin(0)
    run(engine, 0, 3000, () => FRONT, LEVEL, false)
    let frame!: GuideFrame
    for (let t = 3000; t < 5100; t += TICK)
      frame = engine.tick({
        now: t,
        pose: FRONT,
        tilt: LEVEL,
        bangs: t === 3000 ? clean : undefined,
      })
    expect(frame.phase).toBe('toside')
  })

  it('분할을 못 쓰면 직접 확인 버튼을 띄우고, 누르기 전에는 통과하지 않는다', () => {
    const { engine } = setup()
    engine.begin(0)
    let frame!: GuideFrame
    for (let t = 0; t < 3000; t += TICK)
      frame = engine.tick({ now: t, pose: FRONT, tilt: LEVEL, bangsUnavailable: true })
    expect(frame.phase).toBe('align')
    expect(frame.askBangsConfirm).toBe(true)
    expect(frame.hint).toBe('앞머리·안경을 자동으로 확인하지 못했어요')
    engine.confirmBangs()
    for (let t = 3000; t < 5100; t += TICK)
      frame = engine.tick({ now: t, pose: FRONT, tilt: LEVEL })
    expect(frame.phase).toBe('toside')
  })

  it('10초가 지나도 수치가 없으면 분할을 못 쓰는 것으로 보고 확인 버튼을 띄운다', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(run(engine, 0, 9900, () => FRONT, LEVEL, false).askBangsConfirm).toBe(false)
    expect(run(engine, 9900, 10_100, () => FRONT, LEVEL, false).askBangsConfirm).toBe(true)
  })

  it('확인 버튼을 누른 뒤에는 목록의 앞머리·안경을 판단 불가로 보인다', () => {
    const { engine } = setup()
    engine.begin(0)
    engine.tick({ now: 0, pose: FRONT, tilt: LEVEL, bangsUnavailable: true })
    engine.confirmBangs()
    const frame = engine.tick({ now: 50, pose: FRONT, tilt: LEVEL })
    expect(frame.askBangsConfirm).toBe(false)
    const states = Object.fromEntries((frame.checks ?? []).map((c) => [c.key, c.state]))
    expect(states).toMatchObject({ bangs: 'skip', glasses: 'skip' })
  })

  it('분할을 못 쓰고 아직 확인하지 않았으면 목록의 앞머리는 bad', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({ now: 0, pose: FRONT, tilt: LEVEL, bangsUnavailable: true })
    const states = Object.fromEntries((frame.checks ?? []).map((c) => [c.key, c.state]))
    expect(states).toMatchObject({ bangs: 'bad', glasses: 'skip' })
  })
})

describe('검사 목록 (검사 모드 화면)', () => {
  const clean = { all: 0, top: 0, cover: 0, eyes: { other: 0, hair: 0, clothes: 0 } }
  const states = (frame: GuideFrame) =>
    Object.fromEntries((frame.checks ?? []).map((c) => [c.key, c.state]))

  it('검사 단계에서는 다섯 항목을 순서대로 보인다', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({ now: 0, pose: FRONT, tilt: LEVEL, bangs: clean })
    expect(frame.checks?.map((c) => c.label)).toEqual(['거리', '위치', '정면', '앞머리', '안경'])
    expect(states(frame)).toEqual({
      distance: 'ok',
      position: 'ok',
      front: 'ok',
      bangs: 'ok',
      glasses: 'ok',
    })
  })

  it('걸린 항목은 모두 bad로 보인다(안내는 첫 문제 하나)', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({
      now: 0,
      pose: pose({ size: 0.4, cx: 0.7, yaw: 20 }),
      tilt: LEVEL,
      bangs: { all: 0.2, top: 0, cover: 0, eyes: { other: 0.09, hair: 0, clothes: 0 } },
    })
    expect(states(frame)).toEqual({
      distance: 'bad',
      position: 'bad',
      front: 'bad',
      bangs: 'bad',
      glasses: 'bad',
    })
    expect(frame.hint).toBe('더 멀리')
  })

  it('휴대폰 기울기가 벗어나면 위치가 bad', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({
      now: 0,
      pose: FRONT,
      tilt: { beta: 40, fb: 0, side: 0 },
      bangs: clean,
    })
    expect(states(frame).position).toBe('bad')
  })

  it('분할 수치가 아직 없으면 앞머리·안경은 wait, 분할을 못 쓰면 앞머리는 확인 필요(bad)', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(states(engine.tick({ now: 0, pose: FRONT, tilt: LEVEL }))).toMatchObject({
      bangs: 'wait',
      glasses: 'wait',
    })
    expect(
      states(engine.tick({ now: 50, pose: FRONT, tilt: LEVEL, bangsUnavailable: true })),
    ).toMatchObject({ bangs: 'bad', glasses: 'skip' })
  })

  it('얼굴이 없으면 얼굴 항목은 wait', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(states(engine.tick({ now: 0, pose: null, tilt: LEVEL, bangs: clean }))).toMatchObject({
      distance: 'wait',
      position: 'wait',
      front: 'wait',
    })
  })

  it('검사를 통과하면 목록을 거두고 1초 동안 검사 완료를 알린다', () => {
    const { engine } = setup()
    engine.begin(0)
    const end = run(engine, 0, 2100, () => FRONT)
    expect(engine.phase).toBe('toside')
    expect(end.checks).toBeNull()
    expect(end.checkPassed).toBe(true)
    const later = run(engine, 2100, 3100, () => FRONT)
    expect(later.checkPassed).toBe(false)
  })

  it('녹화 중에는 목록도 완료 표시도 없다', () => {
    const { engine } = setup()
    const t = startRecording(engine)
    const frame = engine.tick({ now: t + TICK, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(frame.checks).toBeNull()
    expect(frame.checkPassed).toBe(false)
  })
})

describe('안경 판정 (눈 주변 기타 비율)', () => {
  const eyesWith = (other: number) => ({ other, hair: 0, clothes: 0 })

  it.each([
    [{ all: 0, top: 0, cover: 0, eyes: eyesWith(0.04) }, true],
    [{ all: 0, top: 0, cover: 0, eyes: eyesWith(0.039) }, false],
    [{ all: 0, top: 0, cover: 0, eyes: eyesWith(0) }, false],
    [{ all: 0, top: 0, cover: 0, eyes: null }, false],
    [{ all: 0, top: 0, cover: 0 }, false],
    // -721: 검은 테는 머리카락으로 잡힌다. 눈 아래 띠(눈썹이 닿지 않는 곳)의 머리카락 3% 이상이면 안경
    [{ all: 0, top: 0, cover: 0, eyes: { other: 0, hair: 0.05, clothes: 0, rimHair: 0.03 } }, true],
    [
      { all: 0, top: 0, cover: 0, eyes: { other: 0, hair: 0.05, clothes: 0, rimHair: 0.029 } },
      false,
    ],
  ])('%o → %s', (metrics, on) => {
    expect(glassesOn(metrics)).toBe(on)
  })

  it('분할 결과가 없으면 막지 않는다', () => {
    expect(glassesOn(null)).toBe(false)
    expect(glassesOn(undefined)).toBe(false)
  })

  it('안경을 쓰면 통과하지 않고 벗어 달라고 말한다', () => {
    const { engine, said } = setup()
    engine.begin(0)
    let frame!: GuideFrame
    for (let t = 0; t < 3000; t += TICK)
      frame = engine.tick({
        now: t,
        pose: FRONT,
        tilt: LEVEL,
        bangs: { all: 0, top: 0, cover: 0, eyes: eyesWith(0.09) },
      })
    expect(frame.phase).toBe('align')
    expect(frame.hint).toBe('안경을 벗어 주세요')
    expect(said.map((s) => s.key)).toContain('glasses')
  })

  it('앞머리와 안경이 같이 걸리면 앞머리를 먼저 말한다', () => {
    const { engine } = setup()
    engine.begin(0)
    const frame = engine.tick({
      now: 0,
      pose: FRONT,
      tilt: LEVEL,
      bangs: { all: 0.2, top: 0, cover: 0, eyes: eyesWith(0.09) },
    })
    expect(frame.hint).toBe('앞머리를 머리띠로 올려 주세요')
  })

  it('맨눈이면 통과한다', () => {
    const { engine } = setup()
    engine.begin(0)
    let frame!: GuideFrame
    for (let t = 0; t < 3000; t += TICK)
      frame = engine.tick({
        now: t,
        pose: FRONT,
        tilt: LEVEL,
        bangs: { all: 0, top: 0, cover: 0, eyes: eyesWith(0) },
      })
    expect(frame.phase).toBe('toside')
  })
})

describe('오른쪽 끝으로(녹화 전)', () => {
  it('오른쪽 끝에 닿아 시작한 녹화는 1초 멈춤 전이라도 녹화 중으로 보이고, 70초에 마친다(-691)', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    let frame = engine.tick({ now: t, pose: pose({ yaw: 40 }), tilt: LEVEL })
    expect(frame.recording).toBe(false)
    // 끝(52°)에 잠깐 닿아 녹화가 시작되고, 1초 전에 30°로 물러나 머문다(35° 아래라 끝 멈춤이 아니다)
    frame = engine.tick({ now: t + TICK, pose: pose({ yaw: 52 }), tilt: LEVEL })
    expect(frame.startRecording).toBe(true)
    const recAt = t + TICK
    frame = run(engine, recAt + TICK, recAt + 3000, () => pose({ yaw: 30 }))
    expect(engine.phase).toBe('toside')
    expect(frame.recording).toBe(true)
    expect(frame.recSec).toBeCloseTo(2.95, 1)
    frame = run(engine, recAt + 3000, recAt + 70_000, () => pose({ yaw: 30 }))
    expect(frame.stop).toBeNull()
    frame = engine.tick({ now: recAt + 70_000, pose: pose({ yaw: 30 }), tilt: LEVEL })
    expect(frame.stop).toBe('max')
    expect(engine.phase).toBe('stopping')
  })

  it('오른쪽 끝 멈춤 중 녹화도 사용자가 멈출 수 있다', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    engine.tick({ now: t, pose: pose({ yaw: 52 }), tilt: LEVEL })
    engine.stop()
    expect(engine.phase).toBe('stopping')
  })

  it('옆 끝(50°)에 닿는 순간 녹화를 켜고, 1초 멈추면 녹화 단계로 가며 시작 안내를 낸다', () => {
    // S15P31B204-668: 멈춤 뒤에 녹화를 시작하면 오른쪽 옆모습 멈춤이 영상에 없어 왼쪽만 많이 찍혔다
    const { engine, said } = setup()
    const t = passCheck(engine)
    let frame = engine.tick({ now: t, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(frame.startRecording).toBe(true)
    expect(frame.phase).toBe('toside')
    let again = false
    for (let now = t + TICK; now < t + 1000; now += TICK)
      again ||= engine.tick({ now, pose: pose({ yaw: 50 }), tilt: LEVEL }).startRecording
    expect(again).toBe(false) // 녹화는 한 번만 켠다
    expect(engine.phase).toBe('toside')
    frame = engine.tick({ now: t + 1000, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(frame.startRecording).toBe(false)
    expect(engine.phase).toBe('rec')
    expect(said.at(-1)).toEqual({ key: 'recleft', force: true })
    // 녹화 시간은 끝에 닿은 순간부터
    frame = engine.tick({ now: t + 1000 + TICK, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(frame.recSec).toBeCloseTo(1.05)
  })

  it('오른쪽 끝 멈춤 중에도 녹화를 멈출 수 있다', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    run(engine, t, t + 500, () => pose({ yaw: 50 }))
    engine.stop()
    expect(engine.phase).toBe('stopping')
  })

  it('끝에 닿기 전에는 녹화하지 않고 옮기라고 보여 준다', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    const end = sweepTo(engine, t, 0, 45)
    const frame = engine.tick({ now: end, pose: pose({ yaw: 45 }), tilt: LEVEL })
    expect(frame.phase).toBe('toside')
    expect(frame.startRecording).toBe(false)
    expect(frame.message).toEqual({ text: '휴대폰을 오른쪽 끝으로 →', tone: 'plain' })
  })

  it('끝에서 1초가 되기 전에 벗어나면 1초를 다시 잰다', () => {
    const { engine } = setup()
    const t = passCheck(engine)
    run(engine, t, t + 600, () => pose({ yaw: 50 }))
    run(engine, t + 600, t + 700, () => pose({ yaw: 40 }))
    expect(run(engine, t + 700, t + 1600, () => pose({ yaw: 50 })).phase).toBe('toside')
    engine.tick({ now: 1700 + t, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(engine.phase).toBe('rec')
  })

  it('35° 넘게 돈 뒤 얼굴을 0.5초 넘게 놓치면 끝에 닿은 것으로 본다', () => {
    const { engine } = setup()
    let t = passCheck(engine)
    t = sweepTo(engine, t, 0, 40)
    let started = false
    for (let now = t; now < t + 1500; now += TICK)
      started ||= engine.tick({ now, pose: null, tilt: LEVEL }).startRecording
    expect(started).toBe(true) // 놓친 지 0.5초에 끝으로 보고 녹화를 켠다
    expect(engine.phase).toBe('toside')
    run(engine, t + 1500, t + 1700, () => null)
    expect(engine.phase).toBe('rec')
  })

  it('35°까지 돌지 않았으면 얼굴을 놓쳐도 시작하지 않는다', () => {
    const { engine } = setup()
    let t = passCheck(engine)
    t = sweepTo(engine, t, 0, 20)
    expect(run(engine, t, t + 3000, () => null).phase).toBe('toside')
  })

  it('8초 넘게 끝에 못 가면 "오른쪽 끝까지"를 4초 간격으로', () => {
    const { engine, said } = setup()
    const t = passCheck(engine)
    // 오른쪽 안내(검사 완료 1초 뒤)부터 8초를 센다(-782)
    run(engine, t, t + 8900, () => pose({ yaw: 20 }))
    expect(said.filter((s) => s.key === 'goright')).toHaveLength(0)
    run(engine, t + 8900, t + 9200, () => pose({ yaw: 20 }))
    expect(said.filter((s) => s.key === 'goright')).toHaveLength(1)
    run(engine, t + 9200, t + 13_300, () => pose({ yaw: 20 }))
    expect(said.filter((s) => s.key === 'goright')).toHaveLength(2)
  })

  it('녹화 전에는 경고 음성을 내지 않는다', () => {
    const { engine, warned } = setup()
    const t = passCheck(engine)
    run(engine, t, t + 3000, () => pose({ yaw: 20, size: 0.4, blink: 0.9 }))
    expect(warned).toEqual([])
  })
})

describe('추적이 튀어도 단계를 건너뛰지 않는다 (-638)', () => {
  it('오른쪽 끝에서 한 프레임 반대 부호로 튀어도 가운데로 단계를 끝내지 않는다', () => {
    const { engine } = setup()
    const t = reachToFront(engine)
    engine.tick({ now: t, pose: pose({ yaw: 55 }), tilt: LEVEL })
    engine.tick({ now: t + TICK, pose: pose({ yaw: -52 }), tilt: LEVEL })
    run(engine, t + 2 * TICK, t + 1000, () => pose({ yaw: 55 }))
    expect(engine.stepIndex).toBe(STEP.toFront)
  })

  it('반대쪽 각도가 이어져도(부호 뒤집힘) 정면이 아니면 가운데로 단계를 끝내지 않는다', () => {
    const { engine } = setup()
    const t = reachToFront(engine)
    run(engine, t, t + 1500, () => pose({ yaw: -55 }))
    expect(engine.stepIndex).toBe(STEP.toFront)
  })

  it('가운데로 단계는 정면이 한 프레임만 보여도 넘어가지 않는다', () => {
    const { engine } = setup()
    const t = reachToFront(engine)
    engine.tick({ now: t, pose: FRONT, tilt: LEVEL })
    run(engine, t + TICK, t + 1000, () => pose({ yaw: 30 }))
    expect(engine.stepIndex).toBe(STEP.toFront)
  })

  it('정면을 지나 반대쪽 끝에 0.3초 머물러야 끝난다', () => {
    const { engine } = setup()
    const t = sweepTo(engine, reachSweep(engine), 0, -50)
    run(engine, t, t + 250, () => pose({ yaw: -50 }))
    expect(engine.stepIndex).toBe(STEP.sweep)
    run(engine, t + 250, t + 350, () => pose({ yaw: -50 }))
    expect(engine.stepIndex).toBe(STEP.front)
  })

  it('오른쪽 끝에서 한 번 -36°로 튄 뒤 얼굴을 놓쳐도 가운데로 단계를 끝내지 않는다', () => {
    const { engine } = setup()
    const t = reachToFront(engine)
    engine.tick({ now: t, pose: pose({ yaw: -36 }), tilt: LEVEL })
    run(engine, t + TICK, t + 2000, () => null)
    expect(engine.stepIndex).toBe(STEP.toFront)
  })

  it('정면 단계는 한 프레임 정면으로 튀어도 넘어가지 않는다', () => {
    const { engine } = setup()
    const t = reachFrontStep(engine)
    engine.tick({ now: t, pose: FRONT, tilt: LEVEL })
    run(engine, t + TICK, t + 3000, () => pose({ yaw: -40 }))
    expect(engine.stepIndex).toBe(STEP.front)
  })

  it('고개 위·아래는 한 프레임 튀어도 넘어가지 않는다', () => {
    const { engine } = setup()
    const t = reachHead(engine)
    engine.tick({ now: t, pose: pose({ pitch: 25 }), tilt: LEVEL })
    run(engine, t + TICK, t + 1000, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.headUp)
  })
})

describe('재촉은 말이 끝난 뒤부터 (-781)', () => {
  it('오른쪽 안내(6초)가 나오는 동안은 "오른쪽 끝까지" 8초를 세지 않고, 첫 재촉 뒤로는 4초마다', () => {
    const { engine, port, said } = setup()
    const t0 = passCheck(engine)
    const nags = () => said.filter((s) => s.key === 'goright').length
    // 검사 완료 뒤 1초에 오른쪽 안내가 나오고(-782), 그 안내가 6초 이어진다
    run(engine, t0, t0 + 1100, () => pose({ yaw: 10 }))
    expect(said.at(-1)?.key).toBe('toright')
    port.busyNow = true
    run(engine, t0 + 1100, t0 + 7100, () => pose({ yaw: 10 }))
    port.busyNow = false
    run(engine, t0 + 7100, t0 + 15_000, () => pose({ yaw: 10 }))
    expect(nags()).toBe(0)
    run(engine, t0 + 15_000, t0 + 15_300, () => pose({ yaw: 10 }))
    expect(nags()).toBe(1)
    // 재촉 자체가 말하는 중이어도 다음 재촉은 4초 간격으로
    port.busyNow = true
    run(engine, t0 + 15_300, t0 + 17_200, () => pose({ yaw: 10 }))
    port.busyNow = false
    run(engine, t0 + 17_200, t0 + 19_400, () => pose({ yaw: 10 }))
    expect(nags()).toBe(2)
  })
})

describe('녹화 단계 (우 → 가운데 → 손 바꾸기 → 좌 → 정면 → 위 → 아래 → 정면)', () => {
  it('오른쪽 끝에서 녹화를 시작하면 "촬영을 시작해요. …가운데로…"만 말하고 바로 가운데로 온다(-771)', () => {
    const { engine, said } = setup()
    const t0 = startRecording(engine)
    const frame = engine.tick({ now: t0 + TICK, pose: pose({ yaw: 50 }), tilt: LEVEL })
    expect(engine.stepIndex).toBe(STEP.toFront)
    expect(frame.message.text).toBe('← 가운데로')
    run(engine, t0 + 2 * TICK, t0 + 3000, () => pose({ yaw: 30 }))
    expect(said.filter((s) => s.key === 'recleft')).toHaveLength(1)
    expect(said.some((s) => ['tofront', 'switchhand', 'sweepleft'].includes(s.key))).toBe(false)
  })

  it('가운데(정면)가 0.3초 이어지면 0.5초 "그대로"를 보인 뒤 손을 바꿔 잡으라고 말한다(-771, -782)', () => {
    const { engine, said } = setup()
    const t = sweepTo(engine, reachToFront(engine), 50, 15)
    let frame = run(engine, t, t + 250, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.toFront)
    frame = run(engine, t + 250, t + 400, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.switchHand)
    // 가운데 확인 뒤 0.5초 쉼: 음성 없이 화면만 "좋아요, 그대로"
    expect(frame.message.text).toBe('좋아요, 그대로')
    expect(said.some((s) => s.key === 'switchhand' || s.key === 'holdside')).toBe(false)
    frame = run(engine, t + 400, t + 750, () => FRONT)
    expect(said.some((s) => s.key === 'switchhand')).toBe(false)
    frame = run(engine, t + 750, t + 1000, () => FRONT)
    expect(said.at(-1)).toEqual({ key: 'switchhand', force: true })
    expect(said.some((s) => s.key === 'holdside')).toBe(false)
    frame = run(engine, t + 1000, t + 1100, () => FRONT)
    expect(frame.message.text).toBe('손 바꾸기')
    expect(frame.headGuide).toBe('front')
  })

  it('손 바꾸기는 안내가 끝나고 2초 뒤 "왼쪽 끝까지"를 말한다(-782)', () => {
    const { engine, said } = setup()
    // reachSwitch 뒤 0.4초쯤 가운데 쉼이 끝나 손 바꾸기 안내가 나온다(가짜 음성은 바로 끝난다)
    const t = reachSwitch(engine)
    run(engine, t, t + 2300, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.switchHand)
    const frame = run(engine, t + 2300, t + 2700, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.sweep)
    expect(frame.message.text).toBe('← 왼쪽 끝까지')
    expect(said.at(-1)).toEqual({ key: 'sweepleft', force: true })
  })

  it('손 바꾸기 2초는 안내 음성이 끝난 뒤부터 세고, 그때 얼굴이 정면이 아니면 정면에 보일 때까지 기다린다(-782)', () => {
    const { engine, port } = setup()
    const t = reachSwitch(engine)
    run(engine, t, t + 500, () => FRONT)
    port.busyNow = true
    run(engine, t + 500, t + 3500, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.switchHand)
    port.busyNow = false
    run(engine, t + 3500, t + 5400, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.switchHand)
    // 2초가 지났지만 손을 바꾸느라 얼굴이 안 보이거나 옆을 본다
    run(engine, t + 5400, t + 6000, () => null)
    run(engine, t + 6000, t + 6500, () => pose({ yaw: 30 }))
    expect(engine.stepIndex).toBe(STEP.switchHand)
    // 정면에 보이면 바로 넘어간다(정면을 다시 1초 기다리지 않는다)
    run(engine, t + 6500, t + 6600, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.sweep)
  })

  it('손 바꾸는 동안은 흔들림·기울기·거리 경고를 내지 않는다(-771)', () => {
    const { engine, warned } = setup()
    const t = reachSwitch(engine)
    const frame = run(
      engine,
      t,
      t + 1500,
      (now) => pose({ cy: (now / TICK) % 2 ? 0.44 : 0.56, size: 0.4 }),
      { beta: 90, fb: 30, side: -30 },
    )
    expect(frame.hint).toBe('')
    expect(warned).toEqual([])
  })

  it('옆 끝 멈춤은 앞 안내 음성이 끝날 때까지 기다린다', () => {
    const { engine, said, port } = setup()
    const t = reachLeftEnd(engine)
    port.busyNow = true
    run(engine, t, t + 3000, () => pose({ yaw: -50 }))
    expect(said.at(-1)?.key).toBe('holdside')
    port.busyNow = false
    run(engine, t + 3000, t + 3100, () => pose({ yaw: -50 }))
    expect(said.at(-1)?.key).toBe('backfront')
  })

  it.each([
    ['양수 쪽에서 시작', 1],
    ['음수 쪽에서 시작', -1],
  ])('처음 간 끝(%s)의 반대쪽 끝까지 쓴다', (_, sign) => {
    const { engine, said } = setup()
    const t = reachSweep(engine, sign)
    // 같은 쪽으로 더 가도 끝나지 않는다
    run(engine, t, t + 500, () => pose({ yaw: sign * 60 }))
    expect(engine.stepIndex).toBe(STEP.sweep)
    // 정면을 지나 반대쪽 50°에 0.3초 머물면 끝나고 멈춘다
    const end = sweepTo(engine, t + 500, sign * 60, -sign * 50)
    run(engine, end, end + 350, () => pose({ yaw: -sign * 50 }))
    expect(engine.stepIndex).toBe(STEP.front)
    expect(said.at(-1)).toEqual({ key: 'holdside', force: true })
  })

  it('반대쪽으로 35° 넘게 돈 뒤 얼굴을 0.5초 넘게 놓치면 끝에 닿은 것으로 본다', () => {
    const { engine } = setup()
    let t = reachSweep(engine)
    t = sweepTo(engine, t, 50, -40)
    // 0.5초 놓쳐야 끝으로 보고, 그 상태가 0.3초 이어져야 인정한다
    run(engine, t, t + 800, () => null)
    expect(engine.stepIndex).toBe(STEP.sweep)
    run(engine, t + 800, t + 900, () => null)
    expect(engine.stepIndex).toBe(STEP.front)
  })

  it('정면은 정면(±12°)이 될 때까지 넘어가지 않고, 8초 넘으면 다시 안내한다', () => {
    const { engine, said } = setup()
    const t = reachFrontStep(engine)
    expect(said.at(-1)).toEqual({ key: 'backfront', force: true })
    run(engine, t, t + 8100, () => pose({ yaw: -50 }))
    expect(engine.stepIndex).toBe(STEP.front)
    expect(said.filter((s) => s.key === 'backfront' && !s.force)).toHaveLength(1)
  })

  it('정면에 오면 2초 머문 뒤 고개 위를 안내한다', () => {
    const { engine, said } = setup()
    const t = reachFrontStep(engine)
    // 정면 0.3초 이어져 인정 → 2초 멈춤
    run(engine, t, t + 2200, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.headUp)
    expect(said.at(-1)?.key).toBe('backfront')
    run(engine, t + 2200, t + 2500, () => FRONT)
    expect(said.at(-1)).toEqual({ key: 'headup', force: true })
  })

  it('고개 위·아래는 검사 때 pitch 대비, 첫 방향의 반대쪽까지', () => {
    const { engine, said } = setup()
    let t = reachHead(engine)
    // 부호는 기기마다 다를 수 있어 처음 20° 넘은 쪽을 "위"로 본다
    run(engine, t, t + 350, () => pose({ pitch: -21 }))
    expect(engine.stepIndex).toBe(STEP.headDown)
    t = run(engine, t + 350, t + 1400, () => pose({ pitch: -21 })) && t + 1400
    expect(said.at(-1)).toEqual({ key: 'headdown', force: true })
    run(engine, t, t + 400, () => pose({ pitch: -30 }))
    expect(engine.stepIndex).toBe(STEP.headDown)
    run(engine, t + 400, t + 750, () => pose({ pitch: 21 }))
    expect(engine.stepIndex).toBe(STEP.final)
  })

  it('마지막 정면은 정면을 2초 유지해야 끝난다(그동안 "그대로")', () => {
    const { engine } = setup()
    const t = reachFinal(engine)
    const frame = run(engine, t, t + 1900, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.final)
    expect(frame.message).toEqual({ text: '좋아요, 그대로', tone: 'ok' })
    run(engine, t + 1900, t + 2100, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.done)
  })

  it('마지막 정면에서 벗어나면 2초를 다시 잰다', () => {
    const { engine } = setup()
    const t = reachFinal(engine)
    run(engine, t, t + 1500, () => FRONT)
    run(engine, t + 1500, t + 1600, () => pose({ yaw: 30 }))
    run(engine, t + 1600, t + 3500, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.final)
    run(engine, t + 3500, t + 3700, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.done)
  })

  it('마지막 정면은 고개를 숙이거나 든 채(좌우만 정면)로는 2초를 세지 않는다(-700)', () => {
    const { engine } = setup()
    const t = reachFinal(engine)
    run(engine, t, t + 3000, () => pose({ pitch: -18 }))
    expect(engine.stepIndex).toBe(STEP.final)
    run(engine, t + 3000, t + 4900, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.final)
    run(engine, t + 4900, t + 5100, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.done)
  })

  it('"정면으로 돌아와요" 안내가 나오는 동안은 2초·6초를 세지 않는다(-700)', () => {
    const { engine, port } = setup()
    const t = reachFinal(engine)
    port.busyNow = true
    run(engine, t, t + 7000, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.final)
    port.busyNow = false
    run(engine, t + 7000, t + 8900, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.final)
    run(engine, t + 8900, t + 9100, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.done)
  })

  it('마지막 정면이 끝내 안 되면 6초 뒤 마친다', () => {
    const { engine } = setup()
    const t = reachFinal(engine)
    run(engine, t, t + 5900, () => pose({ yaw: 30 }))
    expect(engine.stepIndex).toBe(STEP.final)
    run(engine, t + 5900, t + 6200, () => pose({ yaw: 30 }))
    expect(engine.stepIndex).toBe(STEP.done)
  })

  it('다 마치면 "촬영이 끝났어요"를 보인다', () => {
    const { engine } = setup()
    const t = reachFinal(engine)
    run(engine, t, 30_000, () => FRONT)
    const frame = engine.tick({ now: 30_000, pose: FRONT, tilt: LEVEL })
    expect(engine.phase).toBe('stopping')
    expect(frame.message.text).toBe('촬영이 끝났어요')
  })

  it('24초 전에 다 하면 정면에서 기다렸다가 24초에 마친다', () => {
    const { engine, said } = setup()
    const t0 = startRecording(engine)
    let now = run(engine, t0 + TICK, t0 + 1100, () => pose({ yaw: 50 })) && t0 + 1100
    // 가운데로(정면 0.3초 + 쉼 0.5초) → 손 바꾸기(안내 뒤 2초) → 왼쪽 끝
    now = run(engine, now, now + 3400, () => FRONT) && now + 3400
    now = run(engine, now, now + 1400, () => pose({ yaw: -50 })) && now + 1400
    now = run(engine, now, now + 2500, () => FRONT) && now + 2500
    now = run(engine, now, now + 1600, () => pose({ pitch: 25 })) && now + 1600
    now = run(engine, now, now + 1600, () => pose({ pitch: -25 })) && now + 1600
    let frame = run(engine, now, now + 2200, () => FRONT)
    expect(engine.stepIndex).toBe(STEP.done)
    expect(said.some((s) => s.key === 'finishwait' && s.force)).toBe(true)
    expect(frame.message.text).toMatch(/^정면에서 잠깐만요 \(\d+초\)$/)
    expect(frame.stop).toBeNull()

    // 24초는 녹화가 켜진 순간(오른쪽 끝에 닿음, 녹화 단계 1초 전)부터 잰다
    frame = run(engine, now + 200, t0 + 23_000, () => FRONT)
    expect(frame.stop).toBeNull()
    frame = engine.tick({ now: t0 + 23_000, pose: FRONT, tilt: LEVEL })
    expect(frame.stop).toBe('complete')
    expect(engine.phase).toBe('stopping')
  })

  it('70초가 되면 남은 단계를 건너뛰고 마친다', () => {
    const { engine } = setup()
    // 녹화는 오른쪽 끝에 닿은 순간(녹화 단계 1초 전)부터 잰다
    const rec = startRecording(engine) - 1000
    let frame = run(engine, rec + 1000 + TICK, rec + 70_000, () => FRONT)
    expect(frame.stop).toBeNull()
    expect(engine.stepIndex).toBe(STEP.sweep)
    frame = engine.tick({ now: rec + 70_000, pose: FRONT, tilt: LEVEL })
    expect(frame.stop).toBe('max')
    // 마친 뒤에는 아무것도 하지 않는다
    expect(engine.tick({ now: rec + 70_100, pose: FRONT, tilt: LEVEL }).stop).toBeNull()
  })

  it('녹화 시간을 초로 알려 준다', () => {
    const { engine } = setup()
    const t0 = startRecording(engine)
    // 오른쪽 끝 1초 멈춤도 녹화에 들어 있다
    expect(engine.tick({ now: t0 + 1234, pose: FRONT, tilt: LEVEL }).recSec).toBeCloseTo(2.234)
  })

  it('반대쪽 끝에 8초 넘게 못 가면 "조금 더"를 4초 간격으로', () => {
    const { engine, said } = setup()
    const t = reachSweep(engine)
    run(engine, t, t + 8100, () => pose({ yaw: -20 }))
    expect(said.filter((s) => s.key === 'more')).toHaveLength(1)
    run(engine, t + 8100, t + 12_200, () => pose({ yaw: -20 }))
    expect(said.filter((s) => s.key === 'more')).toHaveLength(2)
  })

  it('좌우 막대는 지금 위치와 지금까지 담은 범위(시작한 오른쪽 끝 포함, 화면이 거울이라 뒤집어 그림)', () => {
    const { engine } = setup()
    const t = sweepTo(engine, midSweep(engine), 0, -35)
    const frame = engine.tick({ now: t, pose: pose({ yaw: -35 }), tilt: LEVEL })
    const pos = (yaw: number) => 50 - (yaw / GUIDE.gaugeYaw) * 50
    expect(frame.gauge?.dot).toBeCloseTo(pos(-35))
    expect(frame.gauge?.from).toBeCloseTo(pos(50))
    expect(frame.gauge?.width).toBeCloseTo(pos(-35) - pos(50))
    expect(frame.gauge?.full).toBe(false)
  })
})

describe('녹화 중 경고', () => {
  /** "왼쪽 끝까지" 단계에서 정면 근처(yaw 0)에 왔을 때 값을 바꿔 넣는다 */
  function warnWith(
    patch: Partial<FacePose>,
    ms: number,
    tilt: PhoneTilt = LEVEL,
  ): { warned: string[]; frame: GuideFrame } {
    const { engine, warned } = setup()
    const t = midSweep(engine)
    const frame = run(engine, t, t + ms, () => pose(patch), tilt)
    return { warned, frame }
  }

  it.each<[string, Partial<FacePose>, PhoneTilt, string, string]>([
    ['가까워짐(×1.25 초과)', { size: 0.36 }, LEVEL, 'wfar', '더 멀리'],
    ['멀어짐(×0.8 미만)', { size: 0.21 }, LEVEL, 'wnear', '더 가까이'],
    ['높이(세로 ±12%)', { cy: 0.65 }, LEVEL, 'wheight', '↑ 눈높이로'],
    ['높이(위로)', { cy: 0.35 }, LEVEL, 'wheight', '↓ 눈높이로'],
    ['기울기(앞뒤 20°)', {}, { beta: 90, fb: 25, side: 0 }, 'wupright', '똑바로'],
    ['기울기(옆 20°)', {}, { beta: 90, fb: 0, side: -25 }, 'wupright', '똑바로'],
  ])('%s → 화면 "%s"·음성 %s', (_, patch, tilt, key, hint) => {
    const { warned, frame } = warnWith(patch, 800, tilt)
    expect(warned).toEqual([key])
    expect(frame.hint).toBe(hint)
    expect(frame.oval).toBe('bad')
  })

  it('경고 기준은 검사 통과 때 정면 값이다', () => {
    const { engine, warned } = setup()
    engine.begin(0)
    // 검사 때 얼굴 높이 0.25
    run(engine, 0, 2100, () => pose({ size: 0.25 }))
    let t = 2100
    for (; t < 20_000; t += TICK)
      if (engine.tick({ now: t, pose: pose({ yaw: 50 }), tilt: LEVEL }).startRecording) break
    t = run(engine, t + TICK, t + 1100, () => pose({ yaw: 50, size: 0.25 })) && t + 1100
    // 0.25 × 1.25 = 0.3125 넘음
    run(engine, t, t + 800, () => pose({ yaw: 20, size: 0.32 }))
    expect(warned).toEqual(['wfar'])
  })

  it('화면 힌트는 바로, 음성은 0.3초 이어져야(기울기는 0.6초)', () => {
    let r = warnWith({ size: 0.36 }, 300)
    expect(r.frame.hint).toBe('더 멀리')
    expect(r.warned).toEqual([])
    r = warnWith({}, 600, { beta: 90, fb: 25, side: 0 })
    expect(r.warned).toEqual([])
  })

  it('경고 음성은 1.2초 간격', () => {
    const { warned } = warnWith({ size: 0.36 }, 1700)
    expect(warned).toEqual(['wfar', 'wfar'])
  })

  it('흔들림: 1초 안 세로 위치가 4% 넘게 오르내린다', () => {
    const { engine, warned } = setup()
    const t = midSweep(engine)
    const frame = run(engine, t, t + 900, (now) => pose({ cy: (now / TICK) % 2 ? 0.475 : 0.525 }))
    expect(frame.hint).toBe('흔들지 마세요')
    expect(warned).toEqual(['wsteady'])
  })

  it('빠름: 옆으로 쓸 때 40°/s 넘게 0.5초 이어지면', () => {
    const { engine, warned } = setup()
    const t = midSweep(engine)
    // 50ms마다 3° = 60°/s. 정면 근처를 왔다 갔다 해서 옆 끝에는 닿지 않는다
    const frame = run(engine, t, t + 1200, (now) => pose({ yaw: ((now / TICK) % 10) * 3 - 15 }))
    expect(warned).toContain('wslow')
    expect(frame.gauge?.fast).toBe(true)
  })

  it('빠름: 얼굴이 ±45° 밖이면 보지 않는다(옆모습 추적이 흔들림)', () => {
    const { engine, warned } = setup()
    const t = sweepTo(engine, midSweep(engine), 0, -35)
    // -46~-49°를 빠르게 오간다(-50°에 닿지 않게)
    run(engine, t, t + 2000, (now) => pose({ yaw: -46 - ((now / TICK) % 2) * 3 }))
    expect(warned).not.toContain('wslow')
  })

  it('빠름·거리 경고는 멈춤 중에는 내지 않는다', () => {
    const { engine, warned } = setup()
    let t = sweepTo(engine, midSweep(engine), 0, -50)
    t = run(engine, t, t + 350, () => pose({ yaw: -50 })) && t + 350
    expect(engine.stepIndex).toBe(STEP.front)
    // 멈춤(1초) 동안 가까워져도 음성 경고 없음
    const frame = run(engine, t, t + 900, () => pose({ yaw: -30, size: 0.4 }))
    expect(frame.message.text).toBe('좋아요, 그대로')
    expect(warned).toEqual([])
  })

  it('눈 감음: 0.5초 넘게', () => {
    let r = warnWith({ blink: 0.8 }, 500)
    expect(r.warned).toEqual([])
    r = warnWith({ blink: 0.8 }, 700)
    expect(r.warned).toEqual(['weyes'])
  })

  it('고개 위·아래 단계에서는 거리·높이를 보지 않는다', () => {
    const { engine, warned } = setup()
    const t = reachHead(engine)
    run(engine, t, t + 1000, () => pose({ cy: 0.7 }))
    expect(warned).toEqual([])
  })

  it('고개 위·아래 단계에서는 눈 감음을 보지 않는다(숙이면 눈꺼풀이 눈을 덮어 감은 것처럼 잡힌다)', () => {
    const { engine, warned } = setup()
    const t = reachHead(engine)
    run(engine, t, t + 1000, () => pose({ blink: 0.9 }))
    expect(warned).toEqual([])
  })

  it('검사 안내가 길게 나오는 중에 오른쪽 끝에 닿아도 녹화 시작·왼쪽 안내가 바로 나온다(실제 음성 길이)', () => {
    // public/voice/capture의 실제 길이(ms). 합성 값
    const dur: Record<string, number> = { v4ready: 1380, checkdone: 6173, recleft: 4984 }
    let clock = 0
    let endAt = Number.POSITIVE_INFINITY
    const played: [number, string][] = []
    const scheduler = new VoiceScheduler({
      now: () => clock,
      play: (key) => {
        played.push([clock, key])
        endAt = clock + (dur[key] ?? 1500)
      },
      pause: () => {},
    })
    const engine = new GuideEngine(scheduler)
    engine.begin(0)
    let recAt = -1
    for (let t = 0; t < 12_000; t += TICK) {
      clock = t
      if (t >= endAt) {
        endAt = Number.POSITIVE_INFINITY
        scheduler.handleEnded()
      }
      // 검사 통과(2초) 직후 곧바로 오른쪽 끝으로 옮겨 머문다
      const frame = engine.tick({
        now: t,
        pose: pose({ yaw: t < 2200 ? 0 : 55 }),
        tilt: LEVEL,
        bangs: t === 0 ? CLEAN_BANGS : undefined,
      })
      if (frame.startRecording) recAt = t
    }
    expect(recAt).toBeGreaterThan(0)
    const at = (key: string) => played.find(([, k]) => k === key)?.[0]
    // 녹화는 끝에 닿은 순간 켜지고, 1초 멈춤이 끝나면 왼쪽 안내가 앞 안내를 끊고 바로 나온다
    expect(at('recleft')).toBe(recAt + 1000)
    expect(at('sweepleft')).toBeUndefined()
  })

  it('안내 직후 2초는 경고 음성을 내지 않는다(실제 재생 순서 규칙)', () => {
    let clock = 0
    const played: string[] = []
    const scheduler = new VoiceScheduler({
      now: () => clock,
      play: async (key) => {
        played.push(key)
      },
    })
    const engine = new GuideEngine(scheduler)
    const t0 = startRecording(engine)
    // 앞 안내(v4ready, checkdone, recleft)가 모두 t0에 끝났다
    clock = t0
    while (scheduler.busy()) scheduler.handleEnded()
    played.length = 0
    // 안내가 끝난 뒤 2초 안에 가까워져도 경고를 내지 않는다
    for (let t = t0 + TICK; t < t0 + 1900; t += TICK) {
      clock = t
      engine.tick({ now: t, pose: pose({ yaw: 30, size: 0.4 }), tilt: LEVEL })
    }
    expect(played).toEqual([])
    for (let t = t0 + 1900; t < t0 + 3200; t += TICK) {
      clock = t
      engine.tick({ now: t, pose: pose({ yaw: 30, size: 0.4 }), tilt: LEVEL })
    }
    expect(played).toEqual(['wfar'])
  })
})

describe('수동 멈춤', () => {
  it('stop()을 부르면 더 진행하지 않는다', () => {
    const { engine } = setup()
    const t0 = startRecording(engine)
    engine.stop()
    expect(engine.phase).toBe('stopping')
    expect(engine.tick({ now: t0 + 100, pose: FRONT, tilt: LEVEL }).stop).toBeNull()
  })
})

describe('양쪽 끝 판정(S0-2)', () => {
  it('반대쪽 끝에 닿기 전에 멈추면 bothSides가 거짓이다', () => {
    const { engine } = setup()
    expect(engine.bothSides).toBe(false)
    midSweep(engine)
    expect(engine.bothSides).toBe(false)
    engine.stop()
    expect(engine.phase).toBe('stopping')
    expect(engine.bothSides).toBe(false)
  })

  it('반대쪽 끝(50°)에 닿으면 멈춤 1초를 다 채우기 전에 멈춰도 참이다', () => {
    const { engine } = setup()
    const t = sweepTo(engine, reachSweep(engine), 0, -50)
    engine.tick({ now: t, pose: pose({ yaw: -50 }), tilt: LEVEL })
    expect(engine.stepIndex).toBe(STEP.sweep)
    expect(engine.bothSides).toBe(true)
  })

  it('35°를 넘긴 뒤 얼굴을 놓쳐도(옆모습) 끝에 닿은 것으로 본다', () => {
    const { engine } = setup()
    const t = sweepTo(engine, reachSweep(engine), 0, -40)
    run(engine, t, t + 1500, () => null)
    expect(engine.bothSides).toBe(true)
  })
})

describe('끝에서 더 안 돌면 끝 (휴대폰도 60° 돌았을 때만, -777)', () => {
  /** 휴대폰 회전량(자이로 누적, 도)과 얼굴 yaw를 같이 넣는다 */
  function turn(
    engine: GuideEngine,
    from: number,
    to: number,
    phoneYaw: number | null,
    yaw: number | ((t: number) => number),
  ): GuideFrame {
    let frame!: GuideFrame
    for (let t = from; t < to; t += TICK)
      frame = engine.tick({
        now: t,
        pose: pose({ yaw: typeof yaw === 'number' ? yaw : yaw(t) }),
        tilt: LEVEL,
        phoneYaw,
      })
    return frame
  }

  /** 자이로 0으로 검사를 통과한 시각 */
  function passWithGyro(engine: GuideEngine): number {
    engine.begin(0)
    for (let t = 0; t < 2100; t += TICK)
      engine.tick({ now: t, pose: FRONT, tilt: LEVEL, bangs: CLEAN_BANGS, phoneYaw: 0 })
    expect(engine.phase).toBe('toside')
    return 2100
  }

  /** 오른쪽 끝(얼굴 50°·휴대폰 70°) → 가운데 → 손 바꾸기(휴대폰 회전 0에서 마침) → "왼쪽 끝까지"가 시작된 시각 */
  function sweepWithGyro(engine: GuideEngine): number {
    const t0 = passWithGyro(engine)
    turn(engine, t0, t0 + 1200, 70, 50)
    expect(engine.stepIndex).toBe(STEP.toFront)
    turn(engine, t0 + 1200, t0 + 1600, 0, 0)
    turn(engine, t0 + 1600, t0 + 4400, 0, 0)
    expect(engine.stepIndex).toBe(STEP.sweep)
    return t0 + 4400
  }

  it('기준표: 35° 넘게 돈 뒤 1초, 떨림 3°, 휴대폰 60°', () => {
    expect(GUIDE).toMatchObject({ sideStallMs: 1000, sideStallGrowDeg: 3, sideStallPhoneDeg: 60 })
  })

  it('왼쪽 끝에서 얼굴이 40°대로만 읽혀도 휴대폰이 60° 넘게 돌았으면 1초 뒤 넘어간다', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 900, -70, -42)
    expect(engine.stepIndex).toBe(STEP.sweep)
    turn(engine, t + 900, t + 1400, -70, -42)
    expect(engine.stepIndex).toBe(STEP.front)
    expect(engine.bothSides).toBe(true)
  })

  it('적당히 가다 멈추면(휴대폰 40°) 시간이 지나도 넘어가지 않는다', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 5000, -40, -42)
    expect(engine.stepIndex).toBe(STEP.sweep)
    expect(engine.bothSides).toBe(false)
  })

  it('디버그에 끝 판정 수치(최대 얼굴 각도·휴대폰 회전/기준·더 안 돈 시간)를 보인다(-780)', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 500, -45, -42)
    expect(engine.endDebug).toMatch(
      /^끝 판정\(왼쪽\) 35° 넘은 뒤 최대 4\d°\/50° · 휴대폰 45\/60° · 더 안 돎 0\.\d초$/,
    )
    turn(engine, t + 500, t + 1000, null, -42)
    expect(engine.endDebug).toContain('휴대폰 -/60°')
  })

  it('자이로가 없으면 끝 멈춤을 쓰지 않는다(50°·얼굴 놓침만)', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 5000, null, -42)
    expect(engine.stepIndex).toBe(STEP.sweep)
  })

  it('떨림(3° 이하)은 더 돈 것으로 치지 않는다', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 1400, -70, (now) => ((now / TICK) % 2 ? -42 : -44))
    expect(engine.stepIndex).toBe(STEP.front)
  })

  it('계속 돌고 있으면(0.7초마다 4°) 끝으로 보지 않는다', () => {
    const { engine } = setup()
    let t = sweepWithGyro(engine)
    for (const yaw of [-36, -40, -44, -48]) {
      turn(engine, t, t + 700, -70, yaw)
      t += 700
      expect(engine.stepIndex).toBe(STEP.sweep)
    }
  })

  it('35° 아래에서 멈추면 휴대폰이 돌았어도 끝으로 보지 않는다', () => {
    const { engine } = setup()
    const t = sweepWithGyro(engine)
    turn(engine, t, t + 3000, -70, -30)
    expect(engine.stepIndex).toBe(STEP.sweep)
  })

  it('오른쪽 끝도 같은 규칙: 휴대폰 70°면 녹화를 시작하고, 40°면 시작하지 않는다', () => {
    for (const [phone, want] of [
      [70, true],
      [40, false],
    ] as const) {
      const { engine } = setup()
      const t0 = passWithGyro(engine)
      let started = false
      for (let t = t0; t < t0 + 3000; t += TICK)
        if (
          engine.tick({ now: t, pose: pose({ yaw: 42 }), tilt: LEVEL, phoneYaw: phone })
            .startRecording
        )
          started = true
      expect(started).toBe(want)
    }
  })
})

describe('고개가 휴대폰을 따라 돎 (-765)', () => {
  /** 휴대폰 회전량(자이로 누적, 도)과 얼굴 yaw를 같이 넣는다 */
  function turn(
    engine: GuideEngine,
    from: number,
    to: number,
    phoneYaw: number | null,
    yaw: number,
  ): GuideFrame {
    let frame!: GuideFrame
    for (let t = from; t < to; t += TICK)
      frame = engine.tick({ now: t, pose: pose({ yaw }), tilt: LEVEL, phoneYaw })
    return frame
  }

  /** 자이로 0으로 검사를 통과한 시각 */
  function passWithGyro(engine: GuideEngine): number {
    engine.begin(0)
    for (let t = 0; t < 2100; t += TICK)
      engine.tick({ now: t, pose: FRONT, tilt: LEVEL, bangs: CLEAN_BANGS, phoneYaw: 0 })
    expect(engine.phase).toBe('toside')
    return 2100
  }

  it('기준표: 휴대폰 30° 이상, 얼굴 각도가 그 40% 미만, 0.6초', () => {
    expect(GUIDE).toMatchObject({ followTurn: 30, followRatio: 0.4, followPersistMs: 600 })
  })

  it('오른쪽 끝으로 옮길 때 휴대폰은 40° 돌았는데 얼굴이 정면이면 고개를 고정하라고 한다', () => {
    const { engine, warned } = setup()
    const t0 = passWithGyro(engine)
    let frame = turn(engine, t0, t0 + 500, 40, 2)
    expect(frame.hint).toBe('')
    frame = turn(engine, t0 + 500, t0 + 800, 40, 2)
    expect(frame.hint).toBe('고개는 정면 그대로')
    // 음성은 검사 통과 안내 뒤 경고 간격(1.2초)이 지나야
    turn(engine, t0 + 800, t0 + 1500, 40, 2)
    expect(warned).toContain('wheadfix')
  })

  it('고개를 고정하면(얼굴 각도가 휴대폰 회전을 따라가면) 경고하지 않는다', () => {
    const { engine, warned } = setup()
    const t0 = passWithGyro(engine)
    const frame = turn(engine, t0, t0 + 2000, 40, 38)
    expect(frame.hint).toBe('')
    expect(warned).not.toContain('wheadfix')
  })

  it('자이로가 없으면 보지 않는다', () => {
    const { engine, warned } = setup()
    const t0 = passCheck(engine)
    const frame = turn(engine, t0, t0 + 2000, null, 0)
    expect(frame.hint).toBe('')
    expect(warned).not.toContain('wheadfix')
  })

  it('회전량은 검사 통과 때 값에서 잰다(누적 시작값과 무관)', () => {
    const { engine, warned } = setup()
    engine.begin(0)
    for (let t = 0; t < 2100; t += TICK)
      engine.tick({ now: t, pose: FRONT, tilt: LEVEL, bangs: CLEAN_BANGS, phoneYaw: 100 })
    expect(engine.phase).toBe('toside')
    expect(turn(engine, 2100, 3100, 120, 0).hint).toBe('')
    expect(turn(engine, 3100, 4000, 140, 0).hint).toBe('고개는 정면 그대로')
    expect(warned).toContain('wheadfix')
  })

  it('왼쪽으로 쓰는 중에도 본다(휴대폰은 반대쪽 40°인데 얼굴은 정면)', () => {
    const { engine, warned } = setup()
    const t1 = passWithGyro(engine)
    // 오른쪽 끝(휴대폰 50°, 얼굴 50°)에서 녹화 시작 + 1초 멈춤 → 가운데로 → 손 바꾸기(정면 2초)
    turn(engine, t1, t1 + 1200, 50, 50)
    expect(engine.stepIndex).toBe(STEP.toFront)
    turn(engine, t1 + 1200, t1 + 1600, 0, 0)
    turn(engine, t1 + 1600, t1 + 4400, 0, 0)
    expect(engine.stepIndex).toBe(STEP.sweep)
    const t0 = t1 + 4400
    const frame = turn(engine, t0, t0 + 1000, -40, 0)
    expect(engine.stepIndex).toBe(STEP.sweep)
    expect(frame.hint).toBe('고개는 정면 그대로')
    expect(warned).toContain('wheadfix')
  })

  it('고개 위·아래 단계에서는 보지 않는다', () => {
    const { engine, warned } = setup()
    const t0 = reachHead(engine)
    const frame = turn(engine, t0, t0 + 1000, 40, 0)
    expect(frame.hint).not.toBe('고개는 정면 그대로')
    expect(warned).not.toContain('wheadfix')
  })
})

describe('가운데 안내 머리 (-765)', () => {
  it('검사 중에는 없고, 오른쪽으로 옮기는 동안은 그림 없이 얼굴 고정 글자만(fixed)', () => {
    const { engine } = setup()
    engine.begin(0)
    expect(run(engine, 0, 1000, () => FRONT).headGuide).toBeNull()
    const t0 = passCheck(engine)
    expect(run(engine, t0, t0 + 200, () => pose({ yaw: 20 })).headGuide).toBe('fixed')
  })

  it('왼쪽 끝 멈춤까지는 fixed, 정면 단계가 되면 정면 그림', () => {
    const { engine } = setup()
    const t = reachLeftEnd(engine)
    expect(run(engine, t, t + 500, () => pose({ yaw: -50 })).headGuide).toBe('fixed')
    const e2 = setup().engine
    const t2 = reachFrontStep(e2)
    expect(run(e2, t2, t2 + 100, () => pose({ yaw: -40 })).headGuide).toBe('front')
  })

  it('고개 위 단계는 들기, 다 들고 멈추는 동안도 들기, 고개 아래 단계는 숙이기, 마지막 정면은 정면', () => {
    const { engine } = setup()
    const t = reachHead(engine)
    expect(run(engine, t, t + 100, () => FRONT).headGuide).toBe('up')
    // 0.3초 넘게 들면 위 단계가 끝나고 1초 멈춘다(그동안 stepIndex는 이미 다음)
    const held = run(engine, t + 100, t + 600, () => pose({ pitch: 25 }))
    expect(engine.stepIndex).toBe(STEP.headDown)
    expect(held.headGuide).toBe('up')
    expect(run(engine, t + 600, t + 1500, () => pose({ pitch: 25 })).headGuide).toBe('down')
    run(engine, t + 1500, t + 2900, () => pose({ yaw: 30, pitch: -25 }))
    expect(engine.stepIndex).toBe(STEP.final)
    expect(run(engine, t + 2900, t + 3000, () => pose({ yaw: 30 })).headGuide).toBe('front')
  })

  it('왼쪽 쓸기 중에는 그림 없이 fixed', () => {
    const { engine } = setup()
    const t = reachSweep(engine)
    expect(run(engine, t, t + 200, () => pose({ yaw: 40 })).headGuide).toBe('fixed')
  })
})
