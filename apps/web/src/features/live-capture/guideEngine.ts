/**
 * 웹 실시간 촬영 가이드의 판단 부분(S15P31B204-619, docs/design/live-capture-guide.md).
 *
 * 얼굴 자세·휴대폰 기울기·앞머리 수치를 받아 단계 진행·화면 문구·음성 요청을 정한다.
 * 화면·브라우저 API에 의존하지 않는다. 시각(`now`, ms)도 밖에서 받는다. 그래서 합성 값으로 단위 테스트한다.
 * 동작은 시험 페이지 v4(`output/capture-lab/v4-arm-sweep`, 실기기 이틀 시험)를 옮겼다.
 * 바꾼 점: 최대 70초(-774, 처음 55초·시험 90초), 시각 0에서도 동작하도록 "아직 없음"을 0 대신 null로 둔다.
 * S15P31B204-623: 정면 검사(녹화 안 함)와 촬영을 나눴다. 검사를 통과하면 휴대폰을 오른쪽 끝으로 옮기게 하고,
 * 거기서 1초 멈추면 녹화를 시작한다. 순서 우 → 좌 → 정면 → 위 → 아래 → 정면.
 * S15P31B204-771: 오른쪽에서 왼쪽 끝까지 한 손으로 쭉 가는 사람이 있어, 가운데(정면)에서 멈춰 손을 바꿔 잡게 했다.
 * 순서 우 → 가운데 → 손 바꾸기 → 좌 → 정면 → 위 → 아래 → 정면.
 */

/**
 * 기준표. 값은 시험 v4와 좋은 영상 IMG_6087(iPhone 17 Pro, 팔 돌리기, 26초) 실측에서 왔다.
 * 영상 몇 개로 정한 값이라 바꿀 때는 이 표만 고친다.
 */
export const GUIDE = {
  // ── 거리·위치(시작 전) ──
  /** 얼굴 높이 / 영상 높이 최소·최대. IMG_6087은 0.28 */
  faceMin: 0.24,
  faceMax: 0.32,
  /** 얼굴 폭:높이. 타원을 그릴 때 쓴다(IMG_6087 실측 0.88) */
  faceAspect: 0.88,
  /** 얼굴 중심이 화면 가운데에서 벗어나도 되는 폭(화면 비율) */
  centerTol: 0.12,
  /** 시작 전 정면 판정(도) */
  alignFrontYaw: 10,
  /** 시작 전 휴대폰 앞뒤 기울기(deviceorientation beta, 도). 세워 들면 90 */
  tiltLow: 65,
  tiltHigh: 115,
  /** 이 시간 동안 조건을 지켜야 검사 통과 */
  alignStableMs: 2000,
  /** 검사 통과 뒤 "검사 완료"를 크게 보이는 시간 */
  checkDoneMs: 1000,
  /** 검사를 시작하고 이 시간이 지나도 앞머리 수치가 없으면 분할을 못 쓰는 기기로 보고 직접 확인을 받는다(-633) */
  segWaitMs: 10_000,
  /** 시작 전 같은 안내 음성 간격 */
  alignVoiceGapMs: 4000,

  // ── 앞머리(selfie_multiclass 분할, 머리카락 1·피부 2·3) ──
  // 앞머리를 완전히 넘겨야 통과한다(-721: 10·15·50% → 3·5·20%). 이마가 보여도 앞머리가 남아 있으면 막는다
  // 파이프라인 hairline.py가 같은 분할의 머리카락/피부 경계를 헤어라인으로 쓴다. 앞머리가 덮으면 앞머리 끝을 잡는다
  /** 이마 전체(10번 점 ~ 눈썹 위)의 머리카락 비율 */
  bangsAll: 0.03,
  /** 이마 위쪽 1/3 띠의 머리카락 비율 */
  bangsTop: 0.05,
  /** 10번 점 바로 위 띠에 피부가 하나도 안 보이는 열의 비율(헤어라인이 가려짐) */
  bangsCover: 0.2,
  /** 이마를 재는 정면 범위(도)와 초당 횟수 */
  bangsYaw: 15,
  segHz: 4,
  /** 눈 주변(눈썹 아래 ~ 눈꺼풀 아래)의 기타(5) 비율이 이 값 이상이면 안경. 시험(-622): 뿔테 9%, 맨눈 0% */
  glassesOther: 0.04,
  /**
   * 아래 눈꺼풀 아래 띠(안경 아래 테 자리, 눈썹이 닿지 않는 곳)의 머리카락 비율이 이 값 이상이면 안경(-721).
   * 검은 테는 기타가 아니라 머리카락으로 잡힌다. 시험값 없이 정한 값이라 실기기 수치로 다시 맞춘다
   */
  glassesRimHair: 0.03,

  // ── 단계 ──
  /** 정면 판정(도) */
  frontTol: 12,
  /** 좌우를 다 찍고 정면에서 머무는 시간. 정면이 한 번뿐이라 정면 프레임을 확보한다(서버 정면 ±15°) */
  frontHoldSec: 2,
  /** 옆 끝(도). IMG_6087은 ±67°지만 브라우저 추적은 옆에서 작게 읽고 자주 놓친다 */
  sideYaw: 50,
  /** 이만큼 돌았으면 얼굴을 놓쳐도 옆 끝에 닿은 것으로 본다 */
  turnSeenYaw: 35,
  lostMs: 500,
  /**
   * 35° 넘게 돈 뒤 각도가 이만큼(ms) 더 커지지 않으면 끝으로 본다(-777). 추적이 옆에서 각도를 작게 읽어
   * 실제 끝에서도 50°에 못 닿고 얼굴도 놓치지 않으면 "조금 더"만 반복했다. 사람마다 끝 각도가 달라도 각자의 끝에서 넘어간다
   */
  sideStallMs: 1000,
  /** 이보다 작게 커진 각도는 더 돈 것으로 치지 않는다(추적 떨림) */
  sideStallGrowDeg: 3,
  /**
   * 끝 멈춤은 휴대폰도 이만큼(도) 돌았을 때만 인정한다(자이로). 얼굴 각도만으로는 "끝인데 작게 읽음"과
   * "적당히 가다 멈춤"을 가를 수 없어서다. 기준은 오른쪽은 검사 통과, 왼쪽은 손 바꾸기를 마친 정면. 자이로가 없으면 끝 멈춤을 쓰지 않는다
   */
  sideStallPhoneDeg: 60,
  /** 단계 조건(반대쪽 끝·정면·고개 위·아래)이 이만큼 이어져야 인정. 옆얼굴 추적이 한 프레임씩 튀는 것을 거른다(-638) */
  stepConfirmMs: 300,
  /** 오른쪽 끝에서 이만큼 멈추면 녹화 시작, 왼쪽 끝에서도 이만큼 멈춘다 */
  sideHoldSec: 1,
  headHoldSec: 1,
  /**
   * 손 바꾸기(-771, -782): "왼손으로 바꿔 잡아요" 안내가 끝나고 이만큼 지난 뒤, 그때 얼굴이 정면이면 왼쪽으로 간다.
   * 손을 바꿨는지는 알 수 없어(흔들림 없이 바꾸는 사람도 있다) 시간으로 준다. 1초는 쥐는 중에 다음 안내가 나와 빠듯했다
   */
  switchAfterVoiceMs: 2000,
  /** 가운데(정면)가 확인된 뒤 이만큼 "좋아요, 그대로"를 보이고 손 바꾸기를 안내한다(-782) */
  toFrontHoldSec: 0.5,
  /** 검사 통과: "검사 완료" 음성이 끝나고 이만큼 쉰 뒤 오른쪽 안내를 낸다(-782). 붙어 나오면 통과했는지 알기 어렵다 */
  checkGoPauseMs: 1000,
  /** 고개 위·아래(도, 검사 때 pitch 대비). IMG_6087은 ±23° */
  headPitch: 20,
  finalFrontTimeoutMs: 6000,
  /** 마지막 정면은 정면을 이 시간 이어서 봐야 끝난다(정면도 영상에 남긴다, -634) */
  finalHoldSec: 2,
  /** 마지막 정면의 위아래 허용(도, 검사 때 pitch 대비). 고개 위·아래 기준(20°)의 절반 */
  finalPitchTol: 10,
  /** 오른쪽 이동·옆·정면·고개 단계가 이 시간 넘게 안 끝나면 안내를 다시 말한다 */
  stepNagMs: 8000,
  stepNagGapMs: 4000,

  // ── 녹화 중 경고(검사 통과 때 정면 값 대비) ──
  /** 이보다 빠르면 "천천히"(도/초). IMG_6087은 13~20°/s */
  maxSpeed: 40,
  fastPersistMs: 500,
  /** 옆모습 추적은 각도가 튀어 이 범위 밖에서는 속도를 보지 않는다 */
  fastYawLimit: 45,
  /** 거리·높이·흔들림을 보는 얼굴 각도 범위 */
  watchYaw: 50,
  /** 얼굴 높이가 검사 때의 0.8배 미만 / 1.25배 초과 */
  farRatio: 0.8,
  nearRatio: 1.25,
  /** 얼굴 세로 위치가 검사 때보다 이만큼(화면 비율) 벗어남 */
  heightTol: 0.12,
  /** 최근 1초 얼굴 세로 위치 오르내림 폭 */
  shakeRange: 0.04,
  shakeWindowMs: 1000,
  shakeMinSamples: 6,
  /** 휴대폰 앞뒤·옆 기울기 변화(도, 중력 기준) */
  tiltDrift: 20,
  tiltPersistMs: 600,
  persistMs: 300,
  /** 경고 음성 간격 */
  warnGapMs: 1200,
  /** 안내가 끝난 뒤 이 시간 동안은 음성 경고를 내지 않는다(voicePlayer가 지킨다) */
  warnGraceMs: 2000,
  /** 대기한 안내를 이어 낼 때·앞 소리를 끊고 낼 때 쉬는 시간. 말이 붙어 바로 나오는 것처럼 들렸다(-781) */
  voiceGapMs: 500,
  blinkScore: 0.5,
  blinkMs: 500,
  /**
   * 고개가 휴대폰을 따라 돎(-765): 좌우로 옮기는 동안 휴대폰이 검사 때보다 이만큼(도, 자이로) 돌았는데
   * 얼굴 각도가 그 followRatio배 미만이면 고개도 같이 돈 것이다. 고개를 고정하면 얼굴 각도 ≈ 휴대폰 회전량
   */
  followTurn: 30,
  followRatio: 0.4,
  followPersistMs: 600,

  // ── 길이 ──
  /** 모자라면 정면에서 기다린다. 서버 최소 20초에 여유 */
  minSec: 24,
  /** 서버 최대 75초 안에서 마친다(녹화가 가이드 종료 뒤 조금 더 이어져 5초 여유). 남은 단계는 건너뛴다(-774) */
  maxSec: 70,

  // ── 추적 ──
  /** 얼굴 추적 최대 횟수/초. 한 번 걸린 시간의 costRest배는 쉰다(화면 멈춤 방지) */
  maxHz: 20,
  costRest: 1.5,
  /** 좌우 막대 끝(도) */
  gaugeYaw: 70,
} as const

export interface FacePose {
  /** 좌우(도). 카메라 기준 얼굴 방향 = 휴대폰 위치 */
  yaw: number
  /** 위아래(도) */
  pitch: number
  /** 얼굴 점 범위의 중심·높이(영상 비율 0~1) */
  cx: number
  cy: number
  size: number
  /** 두 눈 감음 점수 중 작은 값(0~1) */
  blink: number
}

/** 휴대폰 기울기. 센서가 없으면 null */
export interface PhoneTilt {
  /** deviceorientation beta(도). 시작 전 높이 확인 */
  beta: number | null
  /** 중력 벡터로 잰 앞뒤·옆 기울기(도). 녹화 중 기울기 경고 */
  fb: number | null
  side: number | null
}

export interface BangsMetrics {
  all: number
  top: number
  cover: number
  /** 같은 분할로 잰 눈 주변 비율(안경 감지 시험, S15P31B204-622). 표시만 하고 판정에는 쓰지 않는다 */
  eyes?: EyeWearMetrics | null
}

/** 눈 주변 영역의 분할 분류 비율: 기타(액세서리 5)·머리카락(1)·옷(4) */
export interface EyeWearMetrics {
  other: number
  hair: number
  clothes: number
  /** 아래 눈꺼풀 아래 띠의 머리카락 비율(검은 안경 아래 테, -721) */
  rimHair?: number
}

export interface TickInput {
  now: number
  pose: FacePose | null
  tilt?: PhoneTilt
  /** 새로 잰 앞머리 수치. undefined면 지난 값을 쓴다 */
  bangs?: BangsMetrics | null
  /** 분할 모델을 못 받았다(앞머리 확인을 건너뛴다) */
  bangsUnavailable?: boolean
  /** 휴대폰 세로축 회전 누적(도, 자이로 verticalRate). 센서가 없으면 null·undefined(-765) */
  phoneYaw?: number | null
}

/** 안내(instruction)는 끊지 않고 이어서(interrupt만 끊고 바로), 경고(warning)는 조용할 때만 */
export interface VoicePort {
  busy(): boolean
  say(key: string, options?: { force?: boolean; interrupt?: boolean }): boolean
  warn(key: string): boolean
  /** 대기 중인 안내와 지금 소리를 끊는다(카운트다운 취소) */
  cancel(): void
}

/** align = 정면 검사(녹화 안 함), toside = 오른쪽 끝으로 옮기는 중(녹화 안 함), rec = 녹화 */
export type GuidePhase = 'idle' | 'align' | 'toside' | 'rec' | 'stopping'
export type Tone = 'plain' | 'ok' | 'warn' | 'bad'
export type StopReason = 'complete' | 'max'

export type VoiceRequest =
  { kind: 'instruction'; key: string; force: boolean } | { kind: 'warning'; key: string }

export interface GuideFrame {
  phase: GuidePhase
  stepIndex: number
  message: { text: string; tone: Tone }
  /** 가운데 큰 글자. 없으면 '' */
  hint: string
  oval: 'idle' | 'ok' | 'warn' | 'bad'
  sizeTag: { text: string; tone: Tone } | null
  /** 좌우 막대(%, 화면이 거울이라 뒤집어 그림). 녹화 중에만 */
  gauge: { dot: number; from: number; width: number; fast: boolean; full: boolean } | null
  recSec: number | null
  /** 녹화가 돌고 있다(녹화 단계, 또는 오른쪽 끝에 닿아 시작한 멈춤 중, -691). REC 표시·"녹화 멈춤"에 쓴다 */
  recording: boolean
  /** 이번 틱에 녹화를 시작해야 한다 */
  startRecording: boolean
  /** 이번 틱에 녹화를 마쳐야 한다 */
  stop: StopReason | null
  voice: VoiceRequest[]
  /** 검사 목록. 검사 단계에서만, 그 밖에는 null */
  checks: CheckItem[] | null
  /** 검사를 막 통과했다(checkDoneMs 동안). 화면이 "검사 완료"를 크게 보인다 */
  checkPassed: boolean
  /**
   * 화면 가운데 안내(-765). 그림은 정면 단계(front)와 고개 위·아래 단계(up·down, 멈춤 포함)에만 띄운다.
   * 휴대폰을 좌우로 옮기는 동안(오른쪽 끝으로·왼쪽 쓸기)은 그림 없이 얼굴 고정 글자만(fixed). 검사 중은 null
   */
  headGuide: 'front' | 'up' | 'down' | 'fixed' | null
  /** 앞머리·안경을 자동으로 못 잰다. 화면이 확인 버튼을 보이고 누르면 confirmBangs()를 부른다 */
  askBangsConfirm: boolean
}

/** ok 통과 · bad 걸림 · wait 아직 모름(얼굴·분할 수치 없음) · skip 이 기기에서 판단 불가 */
export type CheckState = 'ok' | 'bad' | 'wait' | 'skip'
export interface CheckItem {
  key: 'distance' | 'position' | 'front' | 'bangs' | 'glasses'
  label: string
  state: CheckState
}

interface Step {
  key: string
  label: string
  holdSec?: number
  side?: boolean
  head?: boolean
  /** 정면으로 돌아오는 단계. 안 끝나면 다시 안내한다 */
  front?: boolean
  /** 들어갈 때 안내 음성을 내지 않는다(앞 단계 음성이 함께 말했다) */
  quiet?: boolean
  /** 손을 바꿔 잡는 동안이라 흔들림·기울기·거리·고개 따라 돎 경고를 내지 않는다(-771) */
  calm?: boolean
  /** 단계를 마친 멈춤(holdSec) 동안 "그대로" 음성을 내지 않는다(짧은 쉼, -782) */
  holdQuiet?: boolean
}

/**
 * 녹화 단계(녹화는 오른쪽 끝에서 시작한다). 오른쪽 → 가운데 → 손 바꾸기 → 왼쪽 끝 → 정면 2초 → 고개 위 → 아래 → 정면.
 * key는 그 단계를 시작할 때 내는 안내 음성 파일 이름이고, 촬영 기록(captureTrace steps)의 단계 이름이다.
 * 순서를 바꾸면 captureTrace의 GUIDE_VERSION을 올린다(워커 frames_bundle.py가 버전별 순서로 구간을 자른다).
 */
export const GUIDE_STEPS: readonly Step[] = [
  // 녹화 시작 음성 하나가 "촬영을 시작합니다. 다시 정면으로 천천히"까지 말한다(-634, -771, -776, -777, -780)
  { key: 'recleft', label: '오른쪽' },
  // 가운데가 확인되면 0.5초 쉬고 손 바꾸기를 안내한다(-782)
  {
    key: 'tofront',
    label: '← 가운데로',
    holdSec: GUIDE.toFrontHoldSec,
    side: true,
    quiet: true,
    holdQuiet: true,
  },
  // 들어갈 때 "왼손으로 바꿔 잡아요", 안 끝나면 다시 말한다(front)
  { key: 'switchhand', label: '손 바꾸기', front: true, calm: true },
  { key: 'sweepleft', label: '← 왼쪽 끝까지', holdSec: GUIDE.sideHoldSec, side: true },
  { key: 'backfront', label: '정면', holdSec: GUIDE.frontHoldSec, front: true },
  { key: 'headup', label: '고개 위', holdSec: GUIDE.headHoldSec, head: true },
  { key: 'headdown', label: '고개 아래', holdSec: GUIDE.headHoldSec, head: true },
  { key: 'backfront', label: '정면' },
]

/** 단계 위치(GUIDE_STEPS 순서). 테스트와 화면이 숫자 대신 이 이름을 쓴다 */
export const STEP = {
  start: 0,
  toFront: 1,
  switchHand: 2,
  sweep: 3,
  front: 4,
  headUp: 5,
  headDown: 6,
  final: 7,
  done: 8,
} as const

/** 앞머리가 이마를 덮었는지. 세 기준 중 하나라도 넘으면 덮은 것. 수치가 없으면 막지 않는다 */
export function bangsCovered(m: BangsMetrics | null | undefined, t = GUIDE): boolean {
  if (!m) return false
  return m.all > t.bangsAll || m.top > t.bangsTop || m.cover > t.bangsCover
}

/** 안경을 썼는지. 렌즈는 피부로 잡히고 테만 기타로 잡힌다. 수치가 없으면 막지 않는다 */
export function glassesOn(m: BangsMetrics | null | undefined, t = GUIDE): boolean {
  const e = m?.eyes
  if (!e) return false
  return e.other >= t.glassesOther || (e.rimHair ?? 0) >= t.glassesRimHair
}

const pct = (v: number) => Math.round(v * 100)

type WarnKind = 'near' | 'far' | 'height' | 'shake' | 'tilt' | 'follow'

/**
 * 한 촬영의 상태 기계. 추적할 때마다 `tick`을 부른다.
 *
 * idle ─begin→ align(정면 검사) ─2초 유지→ toside(오른쪽 끝으로) ─끝에서 1초→ rec ─단계 끝·24초 이상 / 70초→ stopping
 * 검사 통과 때 정면 기준값(얼굴 크기·높이·고개·기울기)을 잡고, 녹화 중 경고와 고개 판정이 이 값을 쓴다.
 */
export class GuideEngine {
  phase: GuidePhase = 'idle'
  stepIndex = 0

  private message: { text: string; tone: Tone } = { text: '', tone: 'plain' }
  private voiceLog: VoiceRequest[] = []
  // 정렬
  private okSince: number | null = null
  /** 마지막 정면을 본 시작 시각 */
  private frontSince: number | null = null
  /** 지금 단계 조건이 이어진 시작 시각(stepConfirmMs) */
  private condSince: number | null = null
  /** 반대쪽 끝으로 가며 정면을 지났다. 오른쪽 끝에서 부호가 뒤집힌 프레임을 반대쪽으로 보지 않게 한다 */
  private crossedFront = false
  private checks: CheckItem[] | null = null
  private passAt: number | null = null
  private now = 0
  private beginAt = 0
  /** 사용자가 앞머리·안경을 직접 확인했다(분할을 못 쓰는 기기) */
  private bangsConfirmed = false
  private askConfirm = false
  private lastWarn = Number.NEGATIVE_INFINITY
  private sideSince: number | null = null
  private nextSeg = Number.NEGATIVE_INFINITY
  private bangs: BangsMetrics | null = null
  private bangsUnavailable = false
  // 녹화
  private recStart = 0
  /** 녹화를 이미 시작했다(오른쪽 끝에 닿은 순간, S15P31B204-668). 오른쪽 끝 1초 멈춤도 영상에 담긴다 */
  private recOn = false
  private stepStart = 0
  private holdUntil: number | null = null
  private waiting = false
  private base: { size: number; cy: number; fb: number | null; side: number | null } | null = null
  private pitch0 = 0
  private sideSign = 0
  private pitchSign = 0
  private sawTurn = false
  /** 이번 옆 단계에서 가장 많이 돈 각도와 그 각도에 닿은 시각(끝 멈춤 판정, -777) */
  private turnPeak = 0
  private turnPeakAt: number | null = null
  /** 왼쪽 쓸기를 시작한 정면(손 바꾸기를 마친 순간)의 휴대폰 회전값 */
  private phoneYawSweep0: number | null = null
  private lostSince: number | null = null
  /** 마지막으로 음성이 나오던 시각. 단계 재촉(stepNagMs)은 말이 끝난 뒤부터 센다(-781) */
  private voiceBusyAt: number | null = null
  private nagStepStart: number | null = null
  /** 검사 통과 뒤 오른쪽 안내(toright)를 냈다. "검사 완료" 음성이 끝난 시각부터 checkGoPauseMs를 센다(-782) */
  private goSaid = false
  private checkQuietSince: number | null = null
  /** 손 바꾸기 안내가 끝난(조용해진) 시각과 그 단계의 시작 시각 */
  private switchQuietSince: number | null = null
  private switchFor: number | null = null
  private nagReady = false
  private lastYaw = 0
  private prev: { yaw: number; t: number } | null = null
  private headSpeed = 0
  private blinkSince: number | null = null
  private issueSince: Record<WarnKind | 'fast', number | null> = {
    near: null,
    far: null,
    height: null,
    shake: null,
    tilt: null,
    follow: null,
    fast: null,
  }
  private cyHist: [number, number][] = []
  private maxYawPos = 0
  private maxYawNeg = 0
  /** 반대쪽 끝(두 번째 단계)에 닿았다. 녹화는 첫 쪽 끝에서 시작하므로 이것이 참이면 양쪽을 다 담았다(S0-2) */
  private farSideReached = false
  /** 지금 자이로 누적값과 검사 통과 때 값(-765) */
  private phoneYaw: number | null = null
  private phoneYaw0: number | null = null

  constructor(
    private readonly voice: VoicePort,
    private readonly t = GUIDE,
  ) {}

  /** 카메라·모델 준비가 끝났다 → 정렬 */
  begin(now: number) {
    this.phase = 'align'
    this.farSideReached = false
    this.phoneYawSweep0 = null
    this.nagStepStart = null
    this.okSince = null
    this.checks = null
    this.passAt = null
    this.beginAt = now
    this.bangsConfirmed = false
    this.askConfirm = false
    this.lastWarn = Number.NEGATIVE_INFINITY
    this.nextSeg = Number.NEGATIVE_INFINITY
    this.recOn = false
    this.say('v4ready', true)
  }

  /** 분할을 못 쓰는 기기에서 사용자가 "이마를 올리고 안경을 벗었다"고 확인했다 */
  confirmBangs() {
    this.bangsConfirmed = true
  }

  /** 양쪽 끝을 다 담았는지. 녹화는 첫 쪽 끝에 닿아야 시작하므로 반대쪽 끝만 보면 된다.
   * 끝 판정은 단계 진행과 같다(50°, 35°를 넘긴 뒤 얼굴을 놓침, 또는 35°를 넘긴 뒤 1초 더 안 돎). 수동 정지·70초 정지면 거짓일 수 있다 */
  /**
   * 끝 판정 수치(디버그, -780). 오른쪽 끝으로 가는 중이나 왼쪽 끝까지 단계에서만.
   * 얼굴 최대 각도, 기준(오른쪽: 검사 통과, 왼쪽: 손 바꾸기 마침)에서 휴대폰이 돈 각도/기준, 더 안 돈 시간
   */
  get endDebug(): string {
    const t = this.t
    const sweep = this.phase === 'rec' && this.stepIndex === STEP.sweep && this.holdUntil === null
    if (this.phase !== 'toside' && !sweep) return ''
    const ref = sweep ? this.phoneYawSweep0 : this.phoneYaw0
    const phone =
      this.phoneYaw === null || ref === null ? '-' : Math.abs(this.phoneYaw - ref).toFixed(0)
    const stall = this.turnPeakAt === null ? 0 : (this.now - this.turnPeakAt) / 1000
    return `끝 판정(${sweep ? '왼쪽' : '오른쪽'}) 35° 넘은 뒤 최대 ${this.turnPeak.toFixed(0)}°/${t.sideYaw}° · 휴대폰 ${phone}/${t.sideStallPhoneDeg}° · 더 안 돎 ${stall.toFixed(1)}초`
  }

  get bothSides(): boolean {
    return this.farSideReached
  }

  /** 사용자가 녹화를 멈췄다 */
  stop() {
    // 오른쪽 끝 멈춤 중(toside)에도 녹화는 이미 돌고 있다
    if (this.phase === 'rec' || (this.phase === 'toside' && this.recOn)) this.phase = 'stopping'
  }

  /** 이번 프레임에 앞머리 분할을 돌릴지. 검사 단계 정면(±15°)일 때만, 초당 segHz번 */
  wantsBangs(now: number, pose: FacePose | null): boolean {
    if (this.phase !== 'align') return false
    if (!pose || Math.abs(pose.yaw) >= this.t.bangsYaw || now < this.nextSeg) return false
    this.nextSeg = now + 1000 / this.t.segHz
    return true
  }

  tick(input: TickInput): GuideFrame {
    this.voiceLog = []
    const { now, pose } = input
    this.now = now
    const tilt = input.tilt ?? { beta: null, fb: null, side: null }
    if (input.bangs !== undefined) this.bangs = input.bangs
    if (input.bangsUnavailable) this.bangsUnavailable = true
    this.phoneYaw = input.phoneYaw ?? null

    if (this.phase === 'idle' || this.phase === 'stopping') return this.frame({ oval: 'idle' })

    if (pose) {
      this.lastYaw = pose.yaw
      this.lostSince = null
      if (this.prev) {
        const dt = (now - this.prev.t) / 1000
        if (dt > 0)
          this.headSpeed = this.headSpeed * 0.75 + (Math.abs(pose.yaw - this.prev.yaw) / dt) * 0.25
      }
      this.prev = { yaw: pose.yaw, t: now }
    } else {
      this.prev = null
      this.lostSince ??= now
    }

    if (this.phase === 'align') return this.align(now, pose, tilt)
    if (this.phase === 'toside') return this.toSide(now, pose)
    return this.record(now, pose, tilt)
  }

  // ───────────── 시작 전 ─────────────

  private align(now: number, p: FacePose | null, tilt: PhoneTilt): GuideFrame {
    const t = this.t
    const far = !!p && p.size > t.faceMax
    const near = !!p && p.size < t.faceMin
    const low = tilt.beta !== null && tilt.beta < t.tiltLow
    const high = tilt.beta !== null && tilt.beta > t.tiltHigh
    const offCenter =
      !!p && (Math.abs(p.cy - 0.5) > t.centerTol || Math.abs(p.cx - 0.5) > t.centerTol)
    const turned = !!p && Math.abs(p.yaw) > t.alignFrontYaw
    const bangs = bangsCovered(this.bangs, t)
    const glasses = glassesOn(this.bangs, t)
    // 수치가 없을 때 통과시키지 않는다(분할 모델은 뒤에서 따로 받아 늦게 준비된다, -633)
    const segDead =
      this.bangsUnavailable || (this.bangs == null && now - this.beginAt >= t.segWaitMs)
    const segPending = !this.bangsConfirmed && !segDead && this.bangs == null
    this.askConfirm = !this.bangsConfirmed && segDead

    // 화면 목록은 모든 항목을, 안내(글자·음성)는 첫 문제 하나만
    const face = (bad: boolean): CheckState => (!p ? 'wait' : bad ? 'bad' : 'ok')
    const seg = (bad: boolean, ask: CheckState): CheckState =>
      this.bangsConfirmed
        ? 'skip'
        : this.askConfirm
          ? ask
          : this.bangs == null
            ? 'wait'
            : bad
              ? 'bad'
              : 'ok'
    this.checks = [
      { key: 'distance', label: '거리', state: face(far || near) },
      { key: 'position', label: '위치', state: low || high ? 'bad' : face(offCenter) },
      { key: 'front', label: '정면', state: face(turned) },
      { key: 'bangs', label: '앞머리', state: seg(bangs, 'bad') },
      { key: 'glasses', label: '안경', state: seg(glasses, 'skip') },
    ]

    let issue: [string, string] | null = null
    if (!p) issue = ['noface', '얼굴이 안 보여요']
    else if (far) issue = ['v4farther', '더 멀리']
    else if (near) issue = ['closer', '더 가까이']
    else if (low) issue = ['raise', '눈높이로 올려요']
    else if (high) issue = ['lower', '조금 내려요']
    else if (offCenter) issue = ['v4ready', '얼굴을 테두리에 맞춰요']
    else if (turned) issue = ['lookfront', '정면을 봐요']
    else if (this.askConfirm) issue = ['bangs', '앞머리·안경을 자동으로 확인하지 못했어요']
    else if (segPending) issue = ['', '앞머리 확인 중']
    else if (!this.bangsConfirmed && bangs) issue = ['bangs', '앞머리를 머리띠로 올려 주세요']
    else if (!this.bangsConfirmed && glasses) issue = ['glasses', '안경을 벗어 주세요']

    if (issue) {
      this.message = { text: issue[1], tone: 'warn' }
      this.okSince = null
      // 앞머리 확인 중(분할 모델 준비 중)은 음성 없이 글자만
      if (issue[0] && now - this.lastWarn > t.alignVoiceGapMs) {
        this.say(issue[0], false)
        this.lastWarn = now
      }
      return this.frame({ hint: issue[1], oval: 'warn', pose: p })
    }
    this.message = { text: '좋아요, 그대로', tone: 'ok' }
    this.okSince ??= now
    if (now - this.okSince > t.alignStableMs && p) {
      // 검사 통과: 정면 기준값을 잡고 오른쪽 끝으로 옮기게 한다(녹화는 아직)
      this.pitch0 = p.pitch
      this.base = { size: p.size, cy: p.cy, fb: tilt.fb, side: tilt.side }
      this.phoneYaw0 = this.phoneYaw
      this.issueSince.follow = null
      this.phase = 'toside'
      this.passAt = now
      this.stepStart = now
      this.sawTurn = false
      this.sideSince = null
      this.lastWarn = now
      // "검사 완료"만 말하고, 끝난 뒤 1초 쉬고 오른쪽 안내를 낸다(toSide, -782)
      this.goSaid = false
      this.checkQuietSince = null
      this.message = { text: '검사 완료', tone: 'ok' }
      this.say('checkdone', true)
    }
    return this.frame({ oval: 'ok', pose: p })
  }

  // ───────────── 오른쪽 끝으로(녹화 전) ─────────────

  /**
   * 오른쪽 끝(|yaw| ≥ sideYaw, 35° 넘게 돈 뒤 얼굴을 놓침, 또는 35° 넘게 돈 뒤 1초 더 안 돎)에 처음 닿으면 녹화를 시작하고, 1초 멈추면 왼쪽 쓸기로 간다.
   * 녹화를 멈춤 뒤에 시작하면 오른쪽 옆모습 멈춤이 영상에 없어, 멈춤이 녹화되는 왼쪽만 많이 찍혔다(S15P31B204-668).
   * 좌우 부호는 보지 않는다(시험 때 화면 거울 때문에 부호가 헷갈렸다). 처음 간 쪽을 오른쪽으로 보고 반대쪽으로 쓸게 한다.
   */
  private toSide(now: number, p: FacePose | null): GuideFrame {
    const t = this.t
    // 녹화는 끝에 닿은 순간 시작했다. 1초 멈춤을 못 해도 상한(maxSec)에서 마친다(-691)
    const recSec = this.recOn ? (now - this.recStart) / 1000 : null
    if (recSec !== null && recSec >= t.maxSec) {
      this.phase = 'stopping'
      return { ...this.frame({ oval: 'ok', pose: p, recSec }), stop: 'max' }
    }
    if (p && Math.abs(p.yaw) > t.turnSeenYaw) this.sawTurn = true
    const follow = this.trackFollow(now, p)
    if (follow && now - this.lastWarn > t.warnGapMs) this.warnAt('wheadfix', now)
    const lostLong = this.lostSince !== null && now - this.lostSince > t.lostMs
    const stalled = !!p && this.stalled(Math.abs(p.yaw), now, this.phoneYaw0)
    const atSide =
      (!!p && Math.abs(p.yaw) >= t.sideYaw) || (!p && this.sawTurn && lostLong) || stalled
    let startRecording = false
    if (!this.goSaid) {
      // 안내 전에 이미 끝에 가 있으면 오른쪽 안내는 건너뛴다(곧 녹화 시작 안내가 나온다)
      if (atSide) this.goSaid = true
      else if (this.voice.busy()) this.checkQuietSince = null
      else {
        this.checkQuietSince ??= now
        if (now - this.checkQuietSince >= t.checkGoPauseMs) {
          this.goSaid = true
          this.stepStart = now
          this.say('toright', true)
        }
      }
    }
    if (atSide) {
      this.sideSign = p ? Math.sign(p.yaw) : Math.sign(this.lastYaw) || 1
      this.sideSince ??= now
      this.message = { text: '좋아요, 그대로', tone: 'ok' }
      if (!this.recOn) {
        this.recOn = true
        this.recStart = now
        this.stepIndex = 0 // 촬영 기록의 첫 단계(recleft)가 이 멈춤부터 시작한다
        startRecording = true
      }
      if (now - this.sideSince >= t.sideHoldSec * 1000) return this.startRec(now, p)
    } else {
      this.sideSince = null
      this.message = this.goSaid
        ? { text: '휴대폰을 오른쪽 끝으로 →', tone: 'plain' }
        : { text: '검사 완료', tone: 'ok' }
      if (this.goSaid && this.nagDue(now) && now - this.lastWarn > t.stepNagGapMs) {
        this.say('goright', false)
        this.lastWarn = now
      }
    }
    return {
      ...this.frame({
        hint: follow ? '고개는 정면 그대로' : '',
        oval: atSide ? 'ok' : 'idle',
        pose: p,
        gauge: true,
        recSec: this.recOn ? (now - this.recStart) / 1000 : null,
      }),
      startRecording,
    }
  }

  /** 오른쪽 끝 1초 멈춤이 끝났다 → 녹화 단계. 녹화는 끝에 닿은 순간 이미 시작했다(recStart도 그때) */
  private startRec(now: number, p: FacePose | null): GuideFrame {
    const first = !this.recOn
    this.recOn = true
    this.phase = 'rec'
    if (first) this.recStart = now
    this.stepIndex = 0
    this.stepStart = now
    this.holdUntil = null
    this.waiting = false
    this.sawTurn = false
    this.lostSince = null
    this.condSince = null
    this.crossedFront = false
    this.maxYawPos = p ? Math.max(0, p.yaw) : 0
    this.maxYawNeg = p ? Math.min(0, p.yaw) : 0
    // 사용자는 이미 오른쪽 끝에 왔다. 아직 나오는 검사 안내(7초)를 끊고 바로 말한다.
    // 줄을 세우면 왼쪽 안내가 9초 늦는다(-630)
    this.say(GUIDE_STEPS[0]!.key, true, true)
    return { ...this.frame({ oval: 'ok', pose: p }), startRecording: first }
  }

  // ───────────── 녹화 중 ─────────────

  private record(now: number, p: FacePose | null, tilt: PhoneTilt): GuideFrame {
    const t = this.t
    const sec = (now - this.recStart) / 1000
    if (sec >= t.maxSec) {
      this.phase = 'stopping'
      return { ...this.frame({ oval: 'ok', pose: p, recSec: sec }), stop: 'max' }
    }
    const step = GUIDE_STEPS[this.stepIndex]
    if (p) {
      this.maxYawPos = Math.max(this.maxYawPos, p.yaw)
      this.maxYawNeg = Math.min(this.maxYawNeg, p.yaw)
    }

    // 눈 감음. 고개 위·아래 단계는 보지 않는다: 숙이면 눈꺼풀이 눈을 덮어 감은 것처럼 잡힌다(-868)
    if (p && !step?.head && p.blink > t.blinkScore) this.blinkSince ??= now
    else this.blinkSince = null

    // 거리·높이·흔들림: 고개 단계와 얼굴이 옆일 때는 보지 않는다
    const base = this.base
    const calm = !!step?.calm
    const watch = !!(base && step && !step.head && !calm && p && Math.abs(p.yaw) < t.watchYaw)
    if (watch && p) {
      this.cyHist.push([now, p.cy])
      while (this.cyHist.length && now - this.cyHist[0]![0] > t.shakeWindowMs) this.cyHist.shift()
    } else this.cyHist = []
    const cys = this.cyHist.map((h) => h[1])
    const shakeNow =
      cys.length >= t.shakeMinSamples && Math.max(...cys) - Math.min(...cys) > t.shakeRange
    const cond: Record<WarnKind, boolean> = {
      far: watch && p!.size < base!.size * t.farRatio,
      near: watch && p!.size > base!.size * t.nearRatio,
      height: watch && Math.abs(p!.cy - base!.cy) > t.heightTol,
      shake: watch && shakeNow,
      // 고개 위·아래 단계에서도 휴대폰은 그대로여야 하므로 본다
      tilt:
        !!step &&
        !calm &&
        base?.fb != null &&
        tilt.fb != null &&
        (Math.abs(tilt.fb - base.fb) > t.tiltDrift ||
          (base.side != null &&
            tilt.side != null &&
            Math.abs(tilt.side - base.side) > t.tiltDrift)),
      // 좌우로 옮기는 단계(오른쪽 끝 멈춤·가운데로·왼쪽 쓸기)에서만
      follow: !!step && (this.stepIndex === STEP.start || !!step.side) && this.followNow(p),
    }
    for (const k of Object.keys(cond) as WarnKind[]) {
      if (cond[k]) this.issueSince[k] ??= now
      else this.issueSince[k] = null
    }
    const lasting = (k: WarnKind) => {
      const since = this.issueSince[k]
      const persist =
        k === 'tilt' ? t.tiltPersistMs : k === 'follow' ? t.followPersistMs : t.persistMs
      return since !== null && now - since > persist
    }
    const fastNow = !!(
      step?.side &&
      this.holdUntil === null &&
      p &&
      Math.abs(p.yaw) < t.fastYawLimit &&
      this.headSpeed > t.maxSpeed
    )
    if (fastNow) this.issueSince.fast ??= now
    else this.issueSince.fast = null

    // 화면은 매 프레임 즉시
    const hint = cond.near
      ? '더 멀리'
      : cond.far
        ? '더 가까이'
        : cond.height
          ? p!.cy < base!.cy
            ? '↓ 눈높이로'
            : '↑ 눈높이로'
          : cond.tilt
            ? '똑바로'
            : lasting('follow')
              ? '고개는 정면 그대로'
              : cond.shake
                ? '흔들지 마세요'
                : fastNow
                  ? '천천히'
                  : ''

    // 음성: 이어질 때만, 간격을 두고, 멈춤 중에는 내지 않는다. 안내를 끊지 않는다(voicePlayer)
    if (this.holdUntil === null && now - this.lastWarn > t.warnGapMs) {
      const fastSince = this.issueSince.fast
      if (lasting('near')) this.warnAt('wfar', now)
      else if (lasting('far')) this.warnAt('wnear', now)
      else if (lasting('height')) this.warnAt('wheight', now)
      else if (lasting('tilt')) this.warnAt('wupright', now)
      else if (lasting('follow')) this.warnAt('wheadfix', now)
      else if (lasting('shake')) this.warnAt('wsteady', now)
      else if (fastNow && fastSince !== null && now - fastSince > t.fastPersistMs) {
        // 빠름은 실제로 말했을 때만 간격을 잰다(시험 v4 그대로)
        if (this.warn('wslow')) this.lastWarn = now
      } else if (this.blinkSince !== null && now - this.blinkSince > t.blinkMs)
        this.warnAt('weyes', now)
    }

    const out = (extra: Partial<GuideFrame> = {}): GuideFrame => ({
      ...this.frame({ hint, oval: hint ? 'bad' : 'ok', pose: p, recSec: sec, gauge: true }),
      ...extra,
    })

    if (this.holdUntil !== null) {
      this.message = { text: '좋아요, 그대로', tone: 'ok' }
      if (now < this.holdUntil || this.voice.busy()) return out()
      this.holdUntil = null
      this.stepStart = now
      this.sawTurn = false
      const next = GUIDE_STEPS[this.stepIndex]
      if (next && !next.quiet) this.say(next.key, true)
      return out()
    }

    if (!step) {
      if (!this.waiting) {
        this.waiting = true
        if (t.minSec - sec > 0) this.say('finishwait', true)
      }
      const left = t.minSec - sec
      this.message = {
        text: left > 0 ? `정면에서 잠깐만요 (${Math.ceil(left)}초)` : '촬영이 끝났어요',
        tone: 'ok',
      }
      if (left <= 0) {
        this.phase = 'stopping'
        return out({ stop: 'complete' })
      }
      return out()
    }

    this.message = {
      text: step.label,
      tone: step.side && this.headSpeed > t.maxSpeed ? 'bad' : 'plain',
    }
    if (
      (step.side || step.head || step.front) &&
      this.nagDue(now) &&
      now - this.lastWarn > t.stepNagGapMs
    ) {
      this.say(step.side ? 'more' : step.key, false)
      this.lastWarn = now
    }

    if (this.stepDone(this.stepIndex, p, now)) {
      this.stepIndex++
      this.frontSince = null
      this.condSince = null
      this.crossedFront = false
      if (step.holdSec) {
        this.holdUntil = now + step.holdSec * 1000
        if ((step.side || step.head) && !step.holdQuiet) this.say('holdside', true)
      } else {
        this.stepStart = now
        this.sawTurn = false
        const next = GUIDE_STEPS[this.stepIndex]
        if (next) this.message = { text: next.label, tone: 'plain' }
        if (next && !next.quiet) this.say(next.key, true)
      }
    } else if (this.stepIndex === STEP.final && this.frontSince !== null) {
      this.message = { text: '좋아요, 그대로', tone: 'ok' }
    }
    return out()
  }

  private stepDone(index: number, p: FacePose | null, now: number): boolean {
    const t = this.t
    const lostLong = this.lostSince !== null && now - this.lostSince > t.lostMs
    const rel = (q: FacePose) => q.pitch - this.pitch0
    const front = !!p && Math.abs(p.yaw) < t.frontTol
    switch (index) {
      case STEP.start:
        // 오른쪽 끝에서 녹화를 시작했다(녹화 전에 이미 1초 멈췄다). 바로 가운데로 온다
        return true
      case STEP.toFront:
        // 가운데(정면 ±12°)가 0.3초 이어지면 손 바꾸기(-771). 오른쪽 끝에서 반대 부호로 튀어도 정면이 아니라 넘어가지 않는다
        return this.held(front, now)
      case STEP.switchHand:
        // 손을 바꿨는지는 알 수 없다. 안내가 끝나고 2초 뒤, 그때 얼굴이 정면이면 왼쪽으로 간다(-771, -782).
        // 아직 바꾸느라 얼굴이 안 보이면 정면에 다시 보일 때까지 기다린다(화면을 못 보는데 안내가 지나가지 않게)
        if (this.switchFor !== this.stepStart) {
          this.switchFor = this.stepStart
          this.switchQuietSince = null
        }
        if (this.voice.busy()) {
          this.switchQuietSince = null
          return false
        }
        this.switchQuietSince ??= now
        if (now - this.switchQuietSince < t.switchAfterVoiceMs || !front) return false
        this.phoneYawSweep0 = this.phoneYaw
        return true
      case STEP.sweep: {
        // 왼쪽 끝까지 쓴다. 정면을 지난 뒤의 반대쪽만 인정한다(지금은 정면에서 시작하므로 바로 지난 것으로 본다)
        if (front) this.crossedFront = true
        if (!this.crossedFront) return this.held(false, now)
        if (p && p.yaw * this.sideSign < -t.turnSeenYaw) this.sawTurn = true
        const reached = !!p && p.yaw * this.sideSign <= -t.sideYaw
        const stalled = !!p && this.stalled(-p.yaw * this.sideSign, now, this.phoneYawSweep0)
        const atEnd = reached || (!p && this.sawTurn && lostLong) || stalled
        if (atEnd) this.farSideReached = true
        return this.held(atEnd, now)
      }
      case STEP.front:
        // 정면 프레임이 서버에 꼭 있어야 하므로(±15°) 시간이 지나도 넘기지 않는다
        return this.held(front, now)
      case STEP.headUp: {
        const up = !!p && Math.abs(rel(p)) >= t.headPitch
        // 처음 넘은 쪽을 "위"로 본다. 0.3초 이어지는 동안 같은 쪽이어야 한다
        if (up && this.condSince !== null && Math.sign(rel(p!)) !== this.pitchSign)
          this.condSince = null
        if (up) this.pitchSign = Math.sign(rel(p!))
        return this.held(up, now)
      }
      case STEP.headDown:
        return this.held(!!p && rel(p) * this.pitchSign <= -t.headPitch, now)
      case STEP.final:
        // "정면으로 돌아와요" 안내가 끝난 뒤부터 잰다(-700). 안내 중에는 2초도, 시간 제한도 흐르지 않는다
        if (this.voice.busy()) {
          this.frontSince = null
          this.stepStart = now
          return false
        }
        // 정면을 finalHoldSec 이어서 봐야 끝난다. 끝내 정면이 안 되면 finalFrontTimeoutMs 뒤 마친다.
        // 고개를 숙인 채로도 좌우는 정면이라, 위아래도 검사 때 기준 안이어야 정면으로 본다(-700)
        if (front && Math.abs(rel(p!)) < t.finalPitchTol) {
          this.frontSince ??= now
          if (now - this.frontSince >= t.finalHoldSec * 1000) return true
        } else this.frontSince = null
        return now - this.stepStart > t.finalFrontTimeoutMs
      default:
        return false
    }
  }

  /** 휴대폰은 돌았는데 얼굴 각도가 따라오지 않는다(고개도 같이 돎). 자이로·얼굴이 없으면 보지 않는다 */
  private followNow(p: FacePose | null): boolean {
    if (!p || this.phoneYaw === null || this.phoneYaw0 === null) return false
    const turned = Math.abs(this.phoneYaw - this.phoneYaw0)
    return turned >= this.t.followTurn && Math.abs(p.yaw) < turned * this.t.followRatio
  }

  /** 오른쪽 끝으로 옮기는 중(녹화 전)의 따라 돎. followPersistMs 이어져야 참 */
  private trackFollow(now: number, p: FacePose | null): boolean {
    if (!this.followNow(p)) {
      this.issueSince.follow = null
      return false
    }
    this.issueSince.follow ??= now
    return now - this.issueSince.follow > this.t.followPersistMs
  }

  /**
   * 목표 쪽으로 turn(도)만큼 돌아 있다. 35° 넘게 돈 뒤 sideStallMs 동안 더 돌지 않았고,
   * 휴대폰도 기준(phoneRef)에서 sideStallPhoneDeg 넘게 돌았으면 참(-777).
   * sawTurn이 거짓(단계가 바뀌어 다시 셈)이면 기록을 지운다. 얼굴을 놓친 틱에는 부르지 않는다
   */
  private stalled(turn: number, now: number, phoneRef: number | null): boolean {
    const t = this.t
    if (!this.sawTurn || turn <= t.turnSeenYaw) {
      if (!this.sawTurn) {
        this.turnPeak = 0
        this.turnPeakAt = null
      }
      return false
    }
    if (this.turnPeakAt === null || turn > this.turnPeak + t.sideStallGrowDeg) {
      this.turnPeak = Math.max(this.turnPeak, turn)
      this.turnPeakAt = now
    }
    if (now - this.turnPeakAt < t.sideStallMs) return false
    // 자이로가 없으면(권한 거부 등) 실제로 얼마나 갔는지 몰라 끝 멈춤을 쓰지 않는다
    if (this.phoneYaw === null || phoneRef === null) return false
    return Math.abs(this.phoneYaw - phoneRef) >= t.sideStallPhoneDeg
  }

  /**
   * 단계를 시작하고 stepNagMs가 지났는지. 검사 끝처럼 긴 안내가 나오는 동안은 세지 않고, 말이 끝난 뒤부터 센다(-781).
   * 전에는 검사 끝 음성(6.9초)이 끝나고 1초 만에 "오른쪽 끝까지"가 나왔다
   */
  private nagDue(now: number): boolean {
    // 단계가 바뀌면 다시 센다. 첫 재촉 뒤로는 재촉 자체가 말이므로 더 미루지 않는다(간격은 stepNagGapMs)
    if (this.nagStepStart !== this.stepStart) {
      this.nagStepStart = this.stepStart
      this.nagReady = false
      this.voiceBusyAt = null
    }
    if (this.nagReady) return true
    if (this.voice.busy()) this.voiceBusyAt = now
    const from = Math.max(this.stepStart, this.voiceBusyAt ?? Number.NEGATIVE_INFINITY)
    this.nagReady = now - from > this.t.stepNagMs
    return this.nagReady
  }

  /** 조건이 stepConfirmMs 이어졌는지. 한 프레임짜리 튐은 넘기지 않는다 */

  private held(ok: boolean, now: number): boolean {
    if (!ok) {
      this.condSince = null
      return false
    }
    this.condSince ??= now
    return now - this.condSince >= this.t.stepConfirmMs
  }

  // ───────────── 출력 ─────────────

  private say(key: string, force: boolean, interrupt = false) {
    this.voiceLog.push({ kind: 'instruction', key, force })
    return this.voice.say(key, interrupt ? { force, interrupt } : { force })
  }

  private warn(key: string) {
    this.voiceLog.push({ kind: 'warning', key })
    return this.voice.warn(key)
  }

  private warnAt(key: string, now: number) {
    this.warn(key)
    this.lastWarn = now
  }

  private frame({
    hint = '',
    oval,
    pose,
    recSec = null,
    gauge = false,
  }: {
    hint?: string
    oval: GuideFrame['oval']
    pose?: FacePose | null
    recSec?: number | null
    gauge?: boolean
  }): GuideFrame {
    return {
      phase: this.phase,
      stepIndex: this.stepIndex,
      message: this.message,
      hint,
      oval,
      sizeTag: pose === undefined ? null : this.sizeTag(pose),
      gauge: gauge ? this.gauge(pose ?? null) : null,
      recSec,
      startRecording: false,
      stop: null,
      recording: this.phase === 'rec' || (this.phase === 'toside' && this.recOn),
      voice: this.voiceLog,
      checks: this.phase === 'align' ? this.checks : null,
      checkPassed:
        this.phase === 'toside' &&
        this.passAt !== null &&
        this.now - this.passAt < this.t.checkDoneMs,
      askBangsConfirm: this.phase === 'align' && this.askConfirm,
      headGuide: this.headGuide(),
    }
  }

  private headGuide(): GuideFrame['headGuide'] {
    if (this.phase === 'toside') return 'fixed'
    if (this.phase !== 'rec') return null
    // 단계를 마치고 멈추는 동안은 stepIndex가 이미 다음 단계라 마친 단계를 본다. 모든 단계 뒤(정면 대기)는 정면
    const step = GUIDE_STEPS[this.holdUntil !== null ? this.stepIndex - 1 : this.stepIndex]
    if (!step) return 'front'
    if (step.key === 'headup') return 'up'
    if (step.key === 'headdown') return 'down'
    // 손 바꾸기도 정면에서 하므로 정면 그림(-771)
    return step.key === 'backfront' || step.key === 'switchhand' ? 'front' : 'fixed'
  }

  private sizeTag(p: FacePose | null): GuideFrame['sizeTag'] {
    const t = this.t
    let text: string
    let tone: Tone
    if (p) {
      text = `얼굴 ${pct(p.size)}% (목표 ${pct(t.faceMin)}~${pct(t.faceMax)}%)`
      tone = p.size > t.faceMax || p.size < t.faceMin ? 'warn' : 'ok'
    } else {
      text = '얼굴 없음'
      tone = 'warn'
    }
    if (this.phase === 'align') {
      const b = this.bangs
      text += this.bangsUnavailable
        ? ' · 이마 판단 불가'
        : b == null
          ? ' · 이마 확인 중'
          : ` · 이마 ${pct(b.all)}/${pct(t.bangsAll)} 위 ${pct(b.top)}/${pct(t.bangsTop)} 헤어라인가림 ${pct(b.cover)}/${pct(t.bangsCover)}%`
      if (!this.bangsUnavailable && b?.eyes) {
        const e = b.eyes
        text += ` · 눈 주변 기타 ${pct(e.other)}% 머리카락 ${pct(e.hair)}% 옷 ${pct(e.clothes)}% 아래테 머리카락 ${pct(e.rimHair ?? 0)}/${pct(t.glassesRimHair)}%`
      }
    }
    return { text, tone }
  }

  /** 지금 휴대폰이 어디쯤(얼굴 각도)인지와 양쪽 끝까지 담은 범위 */
  private gauge(p: FacePose | null): NonNullable<GuideFrame['gauge']> {
    const t = this.t
    const pos = (yaw: number) => 50 - Math.max(-1, Math.min(1, yaw / t.gaugeYaw)) * 50
    const a = pos(this.maxYawPos)
    const b = pos(this.maxYawNeg)
    return {
      dot: pos(p ? p.yaw : this.lastYaw),
      from: Math.min(a, b),
      width: Math.abs(a - b),
      fast: this.headSpeed > t.maxSpeed,
      full: Math.min(this.maxYawPos, -this.maxYawNeg) >= t.sideYaw,
    }
  }
}
