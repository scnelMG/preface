/**
 * 작업 상세 `input.quality`(GPU 워커 qualityReport 원본, `unknown`)에서 사진 비교에 쓰는 값만 좁혀 읽는다(S15P31B204-706).
 * 형식이 맞지 않는 값은 조용히 버린다. 관리자 공통 타입(`features/admin/types.ts`)은 건드리지 않는다.
 *
 * - `captureCameras`(-705, 선택): 촬영 사진마다 COLMAP 카메라(`x_cam = R·X_glb + t`)와 사진 렌즈값
 * - `captureViews`: 방향마다 SfM(또는 MediaPipe) 머리 각도 {yaw, pitch}(도, MediaPipe 부호)
 * - `focalPx`: 렌즈 초점 거리(픽셀). 사진 크기를 알아야 화각이 된다
 */

/** CaptureAngle. 얼굴이 돌아가는 대로 왼쪽→정면→오른쪽 */
export const CAPTURE_ANGLES = ['LEFT', 'LEFT_45', 'FRONT', 'RIGHT_45', 'RIGHT'] as const
export type CaptureAngle = (typeof CAPTURE_ANGLES)[number]

export const ANGLE_LABEL: Record<CaptureAngle, string> = {
  LEFT: '왼쪽',
  LEFT_45: '왼쪽 45°',
  FRONT: '정면',
  RIGHT_45: '오른쪽 45°',
  RIGHT: '오른쪽',
}

export function isCaptureAngle(value: string): value is CaptureAngle {
  return (CAPTURE_ANGLES as readonly string[]).includes(value)
}

export type Vec3 = [number, number, number]
/** 행 우선 3×3 */
export type Mat3 = [Vec3, Vec3, Vec3]

/** 촬영 사진(자르기·크기 변경 없음)의 픽셀 단위 렌즈값 */
export interface Intrinsics {
  w: number
  h: number
  f: number
  cx: number
  cy: number
}

/** COLMAP 규약: x_cam = R·X_glb + t, 카메라 축 x 오른쪽 · y 아래 · z 앞 */
export interface ColmapView {
  R: Mat3
  t: Vec3
}

export interface CaptureViewAngle {
  /** 도. MediaPipe 부호(음수 = 왼쪽) */
  yaw: number
  /** 도. 양수 = 카메라가 머리보다 위 */
  pitch: number
  /** 'sfm' | 'mediapipe' 등. 없으면 null */
  by: string | null
}

export interface CaptureQuality {
  cameras: { intrinsics: Intrinsics; views: Partial<Record<CaptureAngle, ColmapView>> } | null
  views: Partial<Record<CaptureAngle, CaptureViewAngle>>
  focalPx: number | null
}

export const EMPTY_QUALITY: CaptureQuality = { cameras: null, views: {}, focalPx: null }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const out = value.map(finite)
  return out.every((n) => n !== null) ? (out as Vec3) : null
}

function det3(m: Mat3) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

/** 회전 행렬만 받는다(소수 6자리 반올림을 감안해 행 길이·행렬식이 1에서 1% 안) */
function rotation(value: unknown): Mat3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const rows = value.map(vec3)
  if (rows.some((row) => row === null)) return null
  const m = rows as Mat3
  const unit = m.every((row) => Math.abs(Math.hypot(...row) - 1) < 0.01)
  return unit && Math.abs(det3(m) - 1) < 0.01 ? m : null
}

function intrinsics(value: unknown): Intrinsics | null {
  const v = record(value)
  if (!v) return null
  const [w, h, f, cx, cy] = ['w', 'h', 'f', 'cx', 'cy'].map((key) => finite(v[key]))
  if (w === null || h === null || f === null || cx === null || cy === null) return null
  return w > 0 && h > 0 && f > 0 ? { w, h, f, cx, cy } : null
}

function cameras(value: unknown): CaptureQuality['cameras'] {
  const v = record(value)
  // 좌표계가 다르면 변환식이 틀리므로 통째로 버린다(계약: frame glb · axes colmap)
  if (!v || v.frame !== 'glb' || v.axes !== 'colmap') return null
  const lens = intrinsics(v.camera)
  const rawViews = record(v.views)
  if (!lens || !rawViews) return null
  const views: Partial<Record<CaptureAngle, ColmapView>> = {}
  for (const angle of CAPTURE_ANGLES) {
    const view = record(rawViews[angle])
    const R = rotation(view?.R)
    const t = vec3(view?.t)
    if (R && t) views[angle] = { R, t }
  }
  return { intrinsics: lens, views }
}

function viewAngles(value: unknown): CaptureQuality['views'] {
  const v = record(value)
  const out: CaptureQuality['views'] = {}
  if (!v) return out
  for (const angle of CAPTURE_ANGLES) {
    const view = record(v[angle])
    const yaw = finite(view?.yaw)
    if (yaw === null) continue
    out[angle] = {
      yaw,
      pitch: finite(view?.pitch) ?? 0,
      by: typeof view?.by === 'string' ? view.by : null,
    }
  }
  return out
}

export function readCaptureQuality(quality: unknown): CaptureQuality {
  const q = record(quality)
  if (!q) return EMPTY_QUALITY
  const focal = finite(q.focalPx)
  return {
    cameras: cameras(q.captureCameras),
    views: viewAngles(q.captureViews),
    focalPx: focal !== null && focal > 0 ? focal : null,
  }
}
