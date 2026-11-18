import { Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EMPTY_QUALITY, readCaptureQuality, type Mat3, type Vec3 } from './captureQuality'
import {
  colmapToThree,
  DEFAULT_FOV_DEG,
  fitPosition,
  readCamera,
  resolveCamera,
  verticalFovDeg,
  type CompareCamera,
} from './compareCamera'

// 합성 렌즈: 세로 사진, 주점이 가운데에서 조금 비켜 있다
const LENS = { w: 1080, h: 1920, f: 1450, cx: 530, cy: 980 }

/** three 카메라 → COLMAP R(D·Rcᵀ), t(−R·C). 테스트용 역변환 */
function toColmap(rotation: Mat3, center: Vec3) {
  const D = [1, -1, -1]
  const R = [0, 1, 2].map((i) => [0, 1, 2].map((j) => D[i] * rotation[j][i])) as Mat3
  const t = R.map((row) => -(row[0] * center[0] + row[1] * center[1] + row[2] * center[2])) as Vec3
  return { R, t }
}

/** 원점을 보는 똑바른 카메라의 회전(열 = 오른쪽·위·뒤) */
function lookAtOrigin(position: Vec3): Mat3 {
  const camera = new PerspectiveCamera()
  camera.position.set(...position)
  camera.lookAt(0, 0, 0)
  camera.updateMatrix()
  const m = camera.matrix.elements
  return [
    [m[0], m[4], m[8]],
    [m[1], m[5], m[9]],
    [m[2], m[6], m[10]],
  ]
}

function threeCamera(spec: CompareCamera) {
  const camera = new PerspectiveCamera(spec.fovDeg, spec.aspect ?? 1, 0.01, 100)
  camera.position.set(...spec.position)
  const r = spec.rotation!
  camera.quaternion.setFromRotationMatrix(
    new Matrix4().set(
      r[0][0],
      r[0][1],
      r[0][2],
      0,
      r[1][0],
      r[1][1],
      r[1][2],
      0,
      r[2][0],
      r[2][1],
      r[2][2],
      0,
      0,
      0,
      0,
      1,
    ),
  )
  if (spec.viewOffset) {
    const o = spec.viewOffset
    camera.setViewOffset(o.fullWidth, o.fullHeight, o.x, o.y, o.width, o.height)
  }
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

describe('colmapToThree', () => {
  it('R = I, t = [0,0,d]이면 카메라는 (0,0,−d)에서 +Z를 본다', () => {
    const d = 0.45
    const I: Mat3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const camera = colmapToThree({ R: I, t: [0, 0, d] }, LENS)
    expect(camera.position.map((n) => n + 0)).toEqual([0, 0, -d])
    // 회전 = D: 카메라 앞(−z축)이 세계 +Z, 위(y축)가 세계 −Y(COLMAP y 아래)
    expect(camera.rotation!.flat().map((n) => n + 0)).toEqual([1, 0, 0, 0, -1, 0, 0, 0, -1])
  })

  it('화각·비율·주점 보정', () => {
    const camera = colmapToThree(
      { R: toColmap(lookAtOrigin([0, 0, 1]), [0, 0, 1]).R, t: [0, 0, 1] },
      LENS,
    )
    expect(camera.fovDeg).toBeCloseTo(2 * Math.atan(1920 / 2900) * (180 / Math.PI), 9)
    expect(camera.aspect).toBeCloseTo(1080 / 1920, 12)
    expect(camera.viewOffset).toEqual({
      fullWidth: 1080,
      fullHeight: 1920,
      x: 10,
      y: -20,
      width: 1080,
      height: 1920,
    })
    expect(
      colmapToThree({ R: camera.rotation!, t: [0, 0, 1] }, { ...LENS, cx: 540, cy: 960 })
        .viewOffset,
    ).toBeNull()
  })

  it('세계 점을 COLMAP 식과 같은 픽셀에 투영한다(주점 포함)', () => {
    const center: Vec3 = [0.3, 0.05, 0.35]
    const { R, t } = toColmap(lookAtOrigin(center), center)
    const camera = threeCamera(colmapToThree({ R, t }, LENS))
    for (const X of [
      [0, 0, 0],
      [0.05, 0.08, -0.02],
      [-0.07, -0.04, 0.03],
    ] as Vec3[]) {
      const xc = R.map((row, i) => row[0] * X[0] + row[1] * X[1] + row[2] * X[2] + t[i])
      const u = (LENS.f * xc[0]) / xc[2] + LENS.cx
      const v = (LENS.f * xc[1]) / xc[2] + LENS.cy
      const ndc = new Vector3(...X).project(camera)
      expect((ndc.x + 1) * 0.5 * LENS.w).toBeCloseTo(u, 6)
      expect((1 - ndc.y) * 0.5 * LENS.h).toBeCloseTo(v, 6)
    }
  })

  it('정규화(중심 이동·배율)를 카메라에 같이 걸어도 투영이 같다', () => {
    const center: Vec3 = [0.2, -0.1, 0.4]
    const { R, t } = toColmap(lookAtOrigin(center), center)
    const spec = colmapToThree({ R, t }, LENS)
    const box: Vec3 = [0.01, 0.02, -0.03]
    const k = 9.6
    const fitted = threeCamera({ ...spec, position: fitPosition(spec.position, box, k) })
    const raw = threeCamera(spec)
    const X: Vec3 = [0.04, 0.06, 0.01]
    const a = new Vector3(...X).project(raw)
    const b = new Vector3((X[0] - box[0]) * k, (X[1] - box[1]) * k, (X[2] - box[2]) * k).project(
      fitted,
    )
    expect(b.x).toBeCloseTo(a.x, 9)
    expect(b.y).toBeCloseTo(a.y, 9)
  })
})

describe('readCamera', () => {
  it('정면 카메라: 거리 d, yaw·pitch·roll 0', () => {
    const d = 0.45
    // R = D, t = [0,0,d] → 카메라 (0,0,d)에서 −Z를 보는 똑바른 카메라
    const R: Mat3 = [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ]
    const camera = colmapToThree({ R, t: [0, 0, d] }, LENS)
    expect(camera.position.map((n) => n + 0)).toEqual([0, 0, d])
    const out = readCamera(camera)
    expect(out.distance).toBeCloseTo(d, 12)
    expect(out.yaw).toBeCloseTo(0, 9)
    expect(out.pitch).toBeCloseTo(0, 9)
    expect(out.roll).toBeCloseTo(0, 9)
    expect(out.fovDeg).toBeCloseTo(verticalFovDeg(1920, 1450), 9)
  })

  it('모델 왼쪽(+X)·조금 위의 카메라는 yaw 음수(왼쪽)·pitch 양수', () => {
    const center: Vec3 = [0.5, 0.1, 0]
    const out = readCamera(colmapToThree(toColmap(lookAtOrigin(center), center), LENS))
    expect(out.yaw).toBeCloseTo(-90, 6)
    expect(out.pitch).toBeCloseTo((Math.atan2(0.1, 0.5) * 180) / Math.PI, 6)
    expect(out.roll).toBeCloseTo(0, 6)
  })

  it('카메라를 시계 반대로 기울이면 roll 양수', () => {
    const tilt = (10 * Math.PI) / 180
    // 정면 카메라를 자기 앞 축으로 10° 돌린 회전(열 = 오른쪽·위·뒤)
    const rotation: Mat3 = [
      [Math.cos(tilt), -Math.sin(tilt), 0],
      [Math.sin(tilt), Math.cos(tilt), 0],
      [0, 0, 1],
    ]
    const out = readCamera(colmapToThree(toColmap(rotation, [0, 0, 1]), LENS))
    expect(out.roll).toBeCloseTo(10, 6)
  })
})

describe('resolveCamera', () => {
  const quality = readCaptureQuality({
    focalPx: 1450,
    captureViews: {
      LEFT_45: { yaw: -44.5, pitch: 3, by: 'sfm' },
      RIGHT: { yaw: 88, pitch: null, by: 'mediapipe' },
    },
    captureCameras: {
      frame: 'glb',
      axes: 'colmap',
      camera: LENS,
      views: {
        FRONT: {
          R: [
            [1, 0, 0],
            [0, -1, 0],
            [0, 0, -1],
          ],
          t: [0, 0, 0.45],
        },
        LEFT: null,
      },
    },
  })

  it('사진 카메라가 있으면 그대로, 없으면 각도, 그것도 없으면 기본 방향', () => {
    expect(resolveCamera('FRONT', quality, null).kind).toBe('exact')
    expect(resolveCamera('LEFT_45', quality, null).kind).toBe('approx')
    expect(resolveCamera('LEFT', quality, null).kind).toBe('preset')
  })

  it('각도만 맞출 때 방위각 = −yaw, 고도 = pitch, 사진 높이로 화각을 정한다', () => {
    const camera = resolveCamera('LEFT_45', quality, { width: 1080, height: 1920 })
    const [x, y, z] = camera.position
    expect((Math.atan2(x, z) * 180) / Math.PI).toBeCloseTo(44.5, 6)
    expect((Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI).toBeCloseTo(3, 6)
    expect(camera.fovDeg).toBeCloseTo(verticalFovDeg(1920, 1450), 9)
    expect(camera.aspect).toBeCloseTo(1080 / 1920, 12)
    // 사진 크기를 모르면 기본 화각
    expect(resolveCamera('LEFT_45', quality, null).fovDeg).toBe(DEFAULT_FOV_DEG)
    // pitch가 없으면 0
    expect(resolveCamera('RIGHT', quality, null).position[1]).toBe(0)
  })

  it('기본 방향: 왼쪽은 +X, 오른쪽 45°는 −X 쪽', () => {
    expect(resolveCamera('LEFT', EMPTY_QUALITY, null).position[0]).toBeGreaterThan(0)
    expect(resolveCamera('RIGHT_45', EMPTY_QUALITY, null).position[0]).toBeLessThan(0)
    expect(resolveCamera('FRONT', EMPTY_QUALITY, null).position[0]).toBe(0)
  })
})

describe('readCaptureQuality', () => {
  it('형식이 맞지 않는 값은 버린다', () => {
    expect(readCaptureQuality(null)).toEqual(EMPTY_QUALITY)
    expect(readCaptureQuality('x')).toEqual(EMPTY_QUALITY)
    const q = readCaptureQuality({
      focalPx: -1,
      captureViews: { FRONT: { yaw: 'a' }, LEFT: { yaw: -80, pitch: 2 }, UP: { yaw: 1 } },
      captureCameras: {
        frame: 'glb',
        axes: 'colmap',
        camera: LENS,
        views: {
          // 회전 행렬이 아니다
          FRONT: {
            R: [
              [2, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
            t: [0, 0, 1],
          },
          RIGHT: { R: [[1, 0, 0]], t: [0, 0, 1] },
          LEFT_45: { R: 'x', t: [0, 0] },
        },
      },
    })
    expect(q.focalPx).toBeNull()
    expect(q.views).toEqual({ LEFT: { yaw: -80, pitch: 2, by: null } })
    expect(q.cameras?.views).toEqual({})
  })

  it('좌표계가 계약과 다르거나 렌즈값이 없으면 사진 카메라를 통째로 버린다', () => {
    const views = {
      FRONT: {
        R: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        t: [0, 0, 1],
      },
    }
    expect(
      readCaptureQuality({
        captureCameras: { frame: 'world', axes: 'colmap', camera: LENS, views },
      }).cameras,
    ).toBeNull()
    expect(
      readCaptureQuality({ captureCameras: { frame: 'glb', axes: 'opengl', camera: LENS, views } })
        .cameras,
    ).toBeNull()
    expect(
      readCaptureQuality({
        captureCameras: { frame: 'glb', axes: 'colmap', camera: { ...LENS, f: 0 }, views },
      }).cameras,
    ).toBeNull()
  })
})
