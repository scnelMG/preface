import type { LiveCaptureMeta } from './LiveCapture'

/**
 * 웹 녹화 촬영 기록(captureTrace, S15P31B204-641, 실패 원인 개선 계획 S0-1·S0-8·F-3).
 * 업로드 요청에 실어 서버가 저장하고 추출 워커 claim 응답 `capture.trace`로 넘긴다(-640).
 * 모양의 원본: `contracts/frame-extraction/schemas/claim-response.schema.json`의 `capture.trace`.
 *
 * - 시각은 녹화 시작(MediaRecorder start) 기준 ms. 첫 프레임과 수십 ms 차이가 날 수 있다.
 * - 각도는 서버 `video_scan.head_angles`와 같은 식·같은 영상(거울 반전 안 한 원본)이라 yaw 음수 = 왼쪽이 서버와 맞는다.
 *   가이드 판정(`FacePose.yaw`)은 다른 식(asin)이고 부호를 보지 않으므로 기록에는 쓰지 않는다.
 */
export const TRACE_MAX_POINTS = 2_000
export const TRACE_MAX_STEPS = 30
/** 약 20 Hz */
const SAMPLE_GAP_MS = 50
/**
 * GUIDE_STEPS 순서·key를 바꾸면 올린다. 올리기 전에 추출 워커 trace cut 허용 버전 목록에 넣어 달라고 AI 담당(고우정)에게
 * 먼저 알린다 — 목록에 없는 버전이면 trace cut이 자동으로 꺼진다(-667 !517).
 */
// 2026-11-11(-771): 가운데로(tofront)·손 바꾸기(switchhand) 단계 추가. 순서 recleft·tofront·switchhand·sweepleft·backfront·headup·headdown·backfront
const GUIDE_VERSION = 'live-capture-2026-11-11'
const TRACKER_VERSION = 'mediapipe-0.10.14'

export interface TraceAngles {
  yaw: number
  pitch: number
}

export interface CaptureTrace {
  version: 1
  guideVersion: string
  trackerVersion: string
  meta: LiveCaptureMeta
  steps: { name: string; startMs: number; endMs: number }[]
  /** [tMs, yaw, pitch, found]. 놓친 표본은 각도 null, found 0 */
  trace: [number, number | null, number | null, 0 | 1][]
  /** 카메라 트랙 getSettings() 그대로(F-3) */
  trackSettings: Record<string, unknown>
  /**
   * [tMs, deg]. 휴대폰이 세상 세로축(중력 방향)으로 돈 누적 각도(S15P31B204-677, 계획 S0-9).
   * 자이로 각속도를 쌓은 값이라 MediaPipe가 얼굴을 못 찾는 옆모습(75° 넘게)에서도 이어진다.
   * 0은 녹화 시작인 오른쪽 끝(정면이 아님)이고 왼쪽 끝으로 갈수록 커진다. 부호는 기종 공통(-733, 11/09 실측 정면 약
   * +90~100, 왼쪽 끝 약 +185). 정면 기준으로 쓰려면 첫 `backfront` 단계 endMs의 값을 빼며, 그 값은 얼굴 yaw와
   * 부호가 반대다. 고개가 휴대폰을 따라 돌면 그만큼 어긋나고, 길게 찍으면 조금씩 밀린다.
   * 센서가 없거나 막힌 기기는 뺀다. 판정에는 아직 쓰지 않는다(기록만)
   */
  gyro?: [number, number][]
}

/**
 * MediaPipe 얼굴 변환 행렬(열 우선 4×4) → 서버와 같은 머리 각도(도).
 * 서버: R = M[:3,:3](행 우선), yaw = atan2(R[0,2], R[2,2]), pitch = asin(-R[1,2]). 열 우선이면 R[r][c] = m[c*4 + r].
 */
export function serverHeadAngles(m: ArrayLike<number> | undefined): TraceAngles | null {
  if (!m || m.length < 16) return null
  const r02 = m[8]!
  const r22 = m[10]!
  const r12 = m[9]!
  const deg = (v: number) => (v * 180) / Math.PI
  return {
    yaw: deg(Math.atan2(r02, r22)),
    pitch: deg(Math.asin(-Math.max(-1, Math.min(1, r12)))),
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10
/** 이보다 긴 센서 공백은 쌓지 않는다(탭 전환·멈춤: 그 사이 회전을 모른다) */
const MAX_GYRO_GAP_MS = 200

/**
 * 세상 세로축(중력 방향) 둘레 회전 속도(도/초). devicemotion의 rotationRate를 기기 x·y·z축 각속도로 읽어
 * 위쪽 방향(accelerationIncludingGravity, 기기 축)에 투영한다. 휴대폰을 세워 들면 deviceorientation의
 * alpha는 오일러 각 특이점 근처라 불안정해서, 기울기와 상관없는 이 방식을 쓴다. 값이 없으면 null
 *
 * 축과 부호(S15P31B204-733, 디버그 화면 실측 11/09):
 * - rotationRate는 아이폰·안드로이드 모두 alpha = 기기 x, beta = y, gamma = z축 각속도(도/초)로 왔다. 세워 들고 얼굴
 *   둘레를 쓸면 beta가 아이폰 16 Pro +162°, 갤럭시 +183° 쌓였다. 처음(-677)엔 alpha = z, beta = x, gamma = y로 읽어
 *   세로축 회전의 일부만 쌓였다
 * - 중력값 부호만 다르다: 안드로이드는 위쪽이 +(세워 들면 y ≈ +9.8), 아이폰·아이패드(`apple`)는 아래쪽이 +(y ≈ -9.8).
 *   아이폰이면 뒤집어 같은 방향 회전이 같은 부호가 되게 한다
 */
export function verticalRate(
  rate: { alpha: number | null; beta: number | null; gamma: number | null } | null | undefined,
  gravity: { x: number | null; y: number | null; z: number | null } | null | undefined,
  apple = false,
): number | null {
  if (!rate || !gravity) return null
  const { alpha, beta, gamma } = rate
  const { x, y, z } = gravity
  if (alpha == null || beta == null || gamma == null || x == null || y == null || z == null)
    return null
  const g = Math.hypot(x, y, z)
  if (g < 1) return null // 자유 낙하·센서 이상
  const up = apple ? -1 : 1
  return (up * (alpha * x + beta * y + gamma * z)) / g
}

/** 중력값 부호가 반대인 아이폰·아이패드(사파리 엔진)인지. iPadOS는 Mac으로 보이지만 터치가 된다 */
export function isAppleMotion(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1
}

/** 녹화 중 표본·단계를 모은다. 상한을 넘기면 더 담지 않는다(서버가 넘으면 기록 전체를 버리므로) */
export class CaptureTraceRecorder {
  private readonly points: CaptureTrace['trace'] = []
  private readonly steps: { name: string; startMs: number; endMs: number | null }[] = []
  private lastSample = Number.NEGATIVE_INFINITY
  private readonly gyro: [number, number][] = []
  private gyroDeg = 0
  private lastMotion: number | null = null
  private lastGyroSample = Number.NEGATIVE_INFINITY

  constructor(private readonly startedAt: number) {}

  private t(now: number) {
    return Math.max(0, Math.round(now - this.startedAt))
  }

  /** 추적 한 번의 결과. 얼굴을 놓쳤으면 null */
  sample(now: number, angles: TraceAngles | null) {
    if (now - this.lastSample < SAMPLE_GAP_MS || this.points.length >= TRACE_MAX_POINTS) return
    this.lastSample = now
    this.points.push(
      angles
        ? [this.t(now), round1(angles.yaw), round1(angles.pitch), 1]
        : [this.t(now), null, null, 0],
    )
  }

  /** 센서 한 번(verticalRate, 도/초). 각속도를 쌓아 각도로 만들고 약 20 Hz로 남긴다 */
  motion(now: number, degPerSec: number | null) {
    if (degPerSec == null) return
    if (this.lastMotion !== null) {
      const dt = now - this.lastMotion
      if (dt > 0 && dt <= MAX_GYRO_GAP_MS) this.gyroDeg += (degPerSec * dt) / 1000
    }
    this.lastMotion = now
    if (now - this.lastGyroSample < SAMPLE_GAP_MS || this.gyro.length >= TRACE_MAX_POINTS) return
    this.lastGyroSample = now
    this.gyro.push([this.t(now), round1(this.gyroDeg)])
  }

  /** 가이드 단계가 바뀌었다(단계 키). 앞 단계를 닫는다 */
  step(name: string, now: number) {
    const t = this.t(now)
    const open = this.steps.at(-1)
    if (open && open.endMs === null) open.endMs = t
    if (this.steps.length < TRACE_MAX_STEPS) this.steps.push({ name, startMs: t, endMs: null })
  }

  /** 업로드에 실을 기록. 열린 마지막 단계는 녹화 끝(endNow, 없으면 meta.durationMs)에서 닫는다 */
  build(
    meta: LiveCaptureMeta,
    trackSettings: Record<string, unknown>,
    endNow?: number,
  ): CaptureTrace {
    const end = endNow === undefined ? meta.durationMs : this.t(endNow)
    return {
      version: 1,
      guideVersion: GUIDE_VERSION,
      trackerVersion: TRACKER_VERSION,
      meta,
      steps: this.steps.map((s) => ({ ...s, endMs: Math.max(s.startMs, s.endMs ?? end) })),
      trace: [...this.points],
      trackSettings,
      ...(this.gyro.length ? { gyro: [...this.gyro] } : {}),
    }
  }
}

/** 카메라 트랙 설정(F-3: 해상도·비율·resizeMode·fps 등)을 기록용으로. 기기를 가리키는 식별자(deviceId·groupId)는 뺀다 */
export function trackSettings(
  stream: Pick<MediaStream, 'getVideoTracks'> | null,
): Record<string, unknown> {
  const settings = stream?.getVideoTracks?.()[0]?.getSettings?.()
  if (!settings) return {}
  const copy: Record<string, unknown> = { ...settings }
  delete copy.deviceId
  delete copy.groupId
  return copy
}
