/**
 * 관리자 모델 비교(S15P31B204-706)의 카메라 계산. three.js 없이 배열만 다뤄 서버·테스트에서도 불러올 수 있다.
 *
 * 좌표: GLB(glTF) 기준 +Y 위, 얼굴이 +Z를 본다(`features/viewer/viewPresets.ts`와 같다). 방위각 양수 = 카메라가 모델의
 * 왼쪽(+X)에 있다 = 코가 화면 왼쪽을 향한다.
 *
 * 각도 부호(yaw·pitch, qualityReport `captureViews`): GPU 워커 `view_coverage.py`가 MediaPipe와 같은 부호로 맞춘 SfM 각도다.
 * MediaPipe yaw = atan2(R[0,2], R[2,2])는 코가 (좌우 반전하지 않은) 사진의 오른쪽을 향할 때 양수이고, 촬영 방향 LEFT의 목표가
 * yaw −90°다. 코가 사진 왼쪽을 향하는 LEFT 사진은 카메라가 모델 왼쪽(+X)에 있는 것이므로 **방위각 = −yaw**로 둔다.
 * pitch는 카메라가 머리 수평면보다 위면 양수(view_coverage: asin(d·up))라 **고도 = +pitch**다.
 */

import type {
  CaptureAngle,
  CaptureQuality,
  ColmapView,
  Intrinsics,
  Mat3,
  Vec3,
} from './captureQuality'

/** 뷰어가 모델을 맞추는 크기(장면 단위). 최대 변을 이 길이로 맞춘다(FaceViewer와 같은 값) */
export const FIT_SIZE = 2.4
/** 기본 화각·거리(FaceViewer 기본과 같다) */
export const DEFAULT_FOV_DEG = 30
export const DEFAULT_DISTANCE = 6.2
const PRESET_ELEVATION_DEG = 4

export type CameraSourceKind = 'exact' | 'approx' | 'preset'

export const SOURCE_LABEL: Record<CameraSourceKind, string> = {
  exact: '사진 카메라 그대로',
  approx: '각도만 맞춤',
  preset: '기본 방향',
}

/** three `setViewOffset` 인자 */
export interface ViewOffset {
  fullWidth: number
  fullHeight: number
  x: number
  y: number
  width: number
  height: number
}

export interface CompareCamera {
  kind: CameraSourceKind
  /** `glb`: 위치가 GLB 원본 좌표라 뷰어가 모델과 같은 정규화를 건다. `fitted`: 정규화한 장면 좌표 */
  frame: 'glb' | 'fitted'
  position: Vec3
  /** three 카메라 회전(행 우선, 열 = 카메라 x·y·z축의 세계 방향). null이면 원점을 바라본다 */
  rotation: Mat3 | null
  /** 수직 화각(도) */
  fovDeg: number
  /** 사진 비율(w/h)로 고정. null이면 캔버스 비율 */
  aspect: number | null
  /** 주점(cx, cy)이 사진 가운데가 아닐 때의 보정 */
  viewOffset: ViewOffset | null
}

const DEG = 180 / Math.PI

function transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ]
}

function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

/** 수직 화각(도) = 2·atan(h / 2f) */
export function verticalFovDeg(h: number, f: number) {
  return 2 * Math.atan(h / (2 * f)) * DEG
}

/**
 * COLMAP 카메라 → three 카메라(계약 1절).
 * - 중심 C = −Rᵀ·t
 * - three 카메라 축은 x 오른쪽 · y 위 · −z 앞이라 COLMAP 축에 D = diag(1, −1, −1)을 곱한다:
 *   p_three = D·R·(X − C) → 카메라 회전(카메라→세계) = (D·R)ᵀ = Rᵀ·D
 * - 화각 2·atan(h/2f), 비율 w/h
 * - 주점: 대칭 절두체의 중심(전체 화면 가운데)이 사진의 (cx, cy)에 오도록 전체 크기 w×h 안에서 창을 (w/2 − cx, h/2 − cy)만큼 옮긴다
 */
export function colmapToThree(view: ColmapView, lens: Intrinsics): CompareCamera {
  const Rt = transpose(view.R)
  const c = mulVec(Rt, view.t)
  const position: Vec3 = [-c[0], -c[1], -c[2]]
  // Rᵀ·D: Rᵀ의 둘째·셋째 열 부호를 바꾼다
  const rotation = Rt.map((row) => [row[0], -row[1], -row[2]]) as Mat3
  const dx = lens.w / 2 - lens.cx
  const dy = lens.h / 2 - lens.cy
  return {
    kind: 'exact',
    frame: 'glb',
    position,
    rotation,
    fovDeg: verticalFovDeg(lens.h, lens.f),
    aspect: lens.w / lens.h,
    viewOffset:
      Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6
        ? null
        : { fullWidth: lens.w, fullHeight: lens.h, x: dx, y: dy, width: lens.w, height: lens.h },
  }
}

/** 원점을 바라보는 카메라. 방위각 양수 = 모델 왼쪽(+X), 고도 양수 = 위 */
function orbit(azimuthDeg: number, elevationDeg: number, distance: number): Vec3 {
  const az = azimuthDeg / DEG
  const el = elevationDeg / DEG
  const flat = distance * Math.cos(el)
  return [flat * Math.sin(az), distance * Math.sin(el), flat * Math.cos(az)].map((n) =>
    Math.abs(n) < 1e-12 ? 0 : n,
  ) as Vec3
}

/** 방향별 기본 방위각. LEFT는 카메라가 모델 왼쪽(+X)에 있다 */
const PRESET_AZIMUTH: Record<CaptureAngle, number> = {
  LEFT: 90,
  LEFT_45: 45,
  FRONT: 0,
  RIGHT_45: -45,
  RIGHT: -90,
}

/** 화각이 바뀌어도 머리가 비슷한 크기로 보이게 거리를 맞춘다 */
function distanceFor(fovDeg: number) {
  return (DEFAULT_DISTANCE * Math.tan(DEFAULT_FOV_DEG / 2 / DEG)) / Math.tan(fovDeg / 2 / DEG)
}

/**
 * 방향 하나의 카메라. 우선순위: 사진 카메라(captureCameras) → 각도(captureViews yaw·pitch) → 기본 방향.
 * `photo`: 사진의 실제 픽셀 크기(불러온 뒤 알 수 있다). 각도만 맞출 때 focalPx와 함께 화각을 정하고 비율을 맞춘다.
 */
export function resolveCamera(
  angle: CaptureAngle,
  quality: CaptureQuality,
  photo: { width: number; height: number } | null,
): CompareCamera {
  const exact = quality.cameras?.views[angle]
  if (exact && quality.cameras) return colmapToThree(exact, quality.cameras.intrinsics)

  const aspect = photo && photo.width > 0 && photo.height > 0 ? photo.width / photo.height : null
  const view = quality.views[angle]
  if (view) {
    const fovDeg =
      quality.focalPx && photo && photo.height > 0
        ? verticalFovDeg(photo.height, quality.focalPx)
        : DEFAULT_FOV_DEG
    return {
      kind: 'approx',
      frame: 'fitted',
      position: orbit(-view.yaw, view.pitch, distanceFor(fovDeg)),
      rotation: null,
      fovDeg,
      aspect,
      viewOffset: null,
    }
  }
  return {
    kind: 'preset',
    frame: 'fitted',
    position: orbit(PRESET_AZIMUTH[angle], PRESET_ELEVATION_DEG, DEFAULT_DISTANCE),
    rotation: null,
    fovDeg: DEFAULT_FOV_DEG,
    aspect,
    viewOffset: null,
  }
}

/** GLB 좌표 위치에 뷰어의 모델 정규화(중심 이동 · 배율 k)를 같이 건다: C' = (C − center)·k. 회전은 그대로 */
export function fitPosition(position: Vec3, center: Vec3, scale: number): Vec3 {
  return [
    (position[0] - center[0]) * scale,
    (position[1] - center[1]) * scale,
    (position[2] - center[2]) * scale,
  ]
}

export interface CameraReadout {
  /** GLB 원점까지 거리(GLB 단위) */
  distance: number
  /** 도, MediaPipe 부호(captureViews와 같은 뜻: 음수 = 왼쪽) */
  yaw: number
  /** 도, 양수 = 카메라가 위 */
  pitch: number
  /** 도, 화면에서 세계 위쪽(+Y)이 오른쪽으로 기운 각 */
  roll: number
  fovDeg: number
}

/** 사진 카메라 값 표(정확 모드). 위치는 GLB 원점 기준 */
export function readCamera(camera: CompareCamera): CameraReadout {
  const [x, y, z] = camera.position
  const distance = Math.hypot(x, y, z)
  const r = camera.rotation
  return {
    distance,
    yaw: -Math.atan2(x, z) * DEG,
    pitch: distance > 0 ? Math.asin(Math.max(-1, Math.min(1, y / distance))) * DEG : 0,
    // 세계 +Y를 카메라 축에 내린 성분: (x축·Y, y축·Y) = 회전 행렬 둘째 행의 첫째·둘째 값
    roll: r ? Math.atan2(r[1][0], r[1][1]) * DEG : 0,
    fovDeg: camera.fovDeg,
  }
}
