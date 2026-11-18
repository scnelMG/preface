import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { serverHeadAngles, type TraceAngles } from './captureTrace'
import type { BangsMetrics, EyeWearMetrics, FacePose } from './guideEngine'

/**
 * 얼굴 추적(MediaPipe FaceLandmarker)과 앞머리 분할(ImageSegmenter) (S15P31B204-619).
 *
 * JS는 npm `@mediapipe/tasks-vision@0.10.14`, wasm은 jsdelivr의 같은 버전, 모델은 버전 고정 주소다.
 * 모델·wasm(약 40MB)을 저장소에 넣지 않는다(LFS 없음, docs/design/live-capture-guide.md). 주소는 여기에만 둔다.
 * 라이브러리는 촬영을 시작할 때 `import()`로 받는다(서버 렌더·다른 화면 번들에 넣지 않으려고).
 */
export const MEDIAPIPE_ASSETS = {
  wasmBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  faceModel:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  segmenterModel:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
} as const

export interface Landmark {
  x: number
  y: number
}

export interface TrackedFace extends FacePose {
  landmarks: Landmark[]
  /** 서버(`video_scan.head_angles`)와 같은 식의 머리 각도. 촬영 기록(-641)에만 쓴다. 행렬이 없으면 null */
  traceAngles: TraceAngles | null
}

interface BlendshapeCategory {
  categoryName: string
  score: number
}

/** FaceLandmarker 결과 중 쓰는 부분 */
export interface LandmarkerResultLike {
  faceLandmarks?: Landmark[][]
  facialTransformationMatrixes?: { data: number[] | Float32Array }[]
  faceBlendshapes?: { categories: BlendshapeCategory[] }[]
}

const deg = (r: number) => (r * 180) / Math.PI

/**
 * 결과 → 자세. 시험 v4와 같은 식: 변환 행렬(열 우선 4×4)에서 pitch = atan2(m[6], m[10]), yaw = asin(-m[2]).
 * 크기·중심은 얼굴 점 전체의 범위(영상 비율), 눈 감음은 두 눈 점수 중 작은 값(한쪽 윙크는 감음이 아님).
 */
export function poseFromResult(result: LandmarkerResultLike): TrackedFace | null {
  const m = result.facialTransformationMatrixes?.[0]?.data
  const lm = result.faceLandmarks?.[0]
  if (!m || !lm || lm.length === 0) return null
  const pitch = deg(Math.atan2(m[6]!, m[10]!))
  const yaw = deg(Math.asin(Math.max(-1, Math.min(1, -m[2]!))))
  let minX = 1
  let maxX = 0
  let minY = 1
  let maxY = 0
  for (const p of lm) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const categories = result.faceBlendshapes?.[0]?.categories ?? []
  const score = (name: string) => categories.find((c) => c.categoryName === name)?.score ?? 0
  const blink = Math.min(score('eyeBlinkLeft'), score('eyeBlinkRight'))
  return {
    traceAngles: serverHeadAngles(m),
    yaw,
    pitch,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    size: maxY - minY,
    blink,
    landmarks: lm,
  }
}

/** selfie_multiclass 분류: 배경 0·머리카락 1·몸 피부 2·얼굴 피부 3·옷 4·기타 5 */
const HAIR = 1
const CLOTHES = 4
const OTHER = 5
const isSkin = (c: number) => c === 2 || c === 3

/**
 * 분할 마스크 → 앞머리 수치(시험 v4 그대로).
 * 이마 영역: 이마 위쪽 점 10번 ~ 눈썹(105·334번) 위, 좌우는 두 눈썹 가운데 사이.
 * - all: 이마 전체의 머리카락 비율
 * - top: 이마 위쪽 1/3의 머리카락 비율
 * - cover: 10번 점 바로 위 띠(이마 높이의 1/4)에 머리카락이 있고 피부가 한 칸도 없는 열의 비율
 *   (머리띠가 헤어라인 바로 위를 덮어도 가림으로 세지 않는다)
 * 영역이 너무 작으면(20칸 이하) null.
 */
export function bangsFromMask(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  lm: Landmark[],
): BangsMetrics | null {
  const top = lm[10]
  const browL = lm[105]
  const browR = lm[334]
  if (!top || !browL || !browR) return null
  const browY = Math.min(browL.y, browR.y)
  // 눈썹 바깥 끝(70·300번)이 있으면 이마 양옆까지(관자놀이 머리는 빼게 10%씩 안쪽), 없으면 두 눈썹 가운데 사이(-721)
  const outerL = lm[70]
  const outerR = lm[300]
  const inset = outerL && outerR ? Math.abs(outerR.x - outerL.x) * 0.1 : 0
  const x0 = outerL && outerR ? Math.min(outerL.x, outerR.x) + inset : Math.min(browL.x, browR.x)
  const x1 = outerL && outerR ? Math.max(outerL.x, outerR.x) - inset : Math.max(browL.x, browR.x)
  const y0 = top.y
  const y1 = browY - (browY - top.y) * 0.15

  const X0 = Math.max(0, Math.floor(x0 * width))
  const X1 = Math.min(width, Math.ceil(x1 * width))
  const Y0 = Math.max(0, Math.floor(y0 * height))
  const Y1 = Math.min(height, Math.ceil(y1 * height))
  const Ytop = Y0 + Math.max(1, Math.round((Y1 - Y0) / 3))
  const band = Math.max(2, Math.round((Y1 - Y0) * 0.25))

  let hair = 0
  let all = 0
  let topHair = 0
  let topAll = 0
  let covered = 0
  let cols = 0
  for (let x = X0; x < X1; x++) {
    for (let y = Y0; y < Y1; y++) {
      const c = mask[y * width + x]!
      all++
      if (c === HAIR) hair++
      if (y < Ytop) {
        topAll++
        if (c === HAIR) topHair++
      }
    }
    let skin = false
    let bandHair = false
    for (let y = Math.max(0, Y0 - band); y <= Y0 && y < height; y++) {
      const c = mask[y * width + x]!
      if (isSkin(c)) {
        skin = true
        break
      }
      if (c === HAIR) bandHair = true
    }
    cols++
    // 머리띠(옷·기타)·배경은 머리카락이 아니다. 머리카락이 있고 피부가 없을 때만 가림
    if (!skin && bandHair) covered++
  }
  if (all <= 20) return null
  return { all: hair / all, top: topAll ? topHair / topAll : 0, cover: cols ? covered / cols : 0 }
}

/**
 * 분할 마스크 → 눈 주변 분류 비율(안경 감지, S15P31B204-622·-721).
 * 영역: 세로는 눈썹(105·334번)과 아래 눈꺼풀(145·374번) 사이 높이 h로 눈썹 아래 0.3h ~ 눈꺼풀 아래 0.5h
 * (눈썹 자체는 머리카락으로 나올 수 있어 뺀다), 가로는 눈 바깥 끝(33·263번)에서 눈 사이 폭의 10%씩 더.
 * 영역이 너무 작으면(20칸 이하) null.
 */
export function eyeWearFromMask(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  lm: Landmark[],
): EyeWearMetrics | null {
  const browL = lm[105]
  const browR = lm[334]
  const outerL = lm[33]
  const outerR = lm[263]
  const lidL = lm[145]
  const lidR = lm[374]
  if (!browL || !browR || !outerL || !outerR || !lidL || !lidR) return null
  const browY = Math.min(browL.y, browR.y)
  const lidY = Math.max(lidL.y, lidR.y)
  const h = lidY - browY
  const left = Math.min(outerL.x, outerR.x)
  const right = Math.max(outerL.x, outerR.x)
  const pad = (right - left) * 0.1

  const X0 = Math.max(0, Math.floor((left - pad) * width))
  const X1 = Math.min(width, Math.ceil((right + pad) * width))
  const Y0 = Math.max(0, Math.floor((browY + h * 0.3) * height))
  const Y1 = Math.min(height, Math.ceil((lidY + h * 0.5) * height))

  // 아래 띠: 아래 눈꺼풀 ~ 영역 끝. 눈썹이 닿지 않아 맨눈이면 피부뿐이다(검은 안경 아래 테 자리, -721)
  const Yrim = Math.max(Y0, Math.floor(lidY * height))
  let all = 0
  let other = 0
  let hair = 0
  let clothes = 0
  let rimAll = 0
  let rimHair = 0
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      const c = mask[y * width + x]!
      all++
      if (c === OTHER) other++
      else if (c === HAIR) hair++
      else if (c === CLOTHES) clothes++
      if (y >= Yrim) {
        rimAll++
        if (c === HAIR) rimHair++
      }
    }
  }
  if (all <= 20) return null
  return {
    other: other / all,
    hair: hair / all,
    clothes: clothes / all,
    rimHair: rimAll ? rimHair / rimAll : 0,
  }
}

/**
 * 디버그 화면용(-716): 마스크 크기와 분류별 비율(많은 순). 기기마다 분할 결과가 다른지 보려고 쓴다.
 * 판정에는 쓰지 않는다.
 */
export function maskSummary(mask: ArrayLike<number>, width: number, height: number): string {
  const counts = new Map<number, number>()
  for (let i = 0; i < mask.length; i++) counts.set(mask[i]!, (counts.get(mask[i]!) ?? 0) + 1)
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}:${Math.round((n / mask.length) * 100)}%`)
  return `마스크 ${width}x${height} ${parts.join(' ')}`
}

/**
 * 분할 마스크의 소수 값(분류 번호/255) → 분류 번호(-869).
 * 라이브러리 `getAsUint8Array()`는 255를 곱한 뒤 반올림 없이 버린다. GPU가 소수를 조금 낮게 돌려주는 기기(일부 아이폰)에서
 * 2.99…가 2로 잘려 번호가 전부 한 칸 밀렸다(옷 → 얼굴 피부, 머리카락 → 배경, 안경테 → 옷). 앞머리·안경이 0%로 통과했다.
 * `drift`는 정수에서 가장 멀리 벗어난 값(부호 포함, 디버그 화면용).
 */
export function maskCategories(values: Float32Array): { data: Uint8Array; drift: number } {
  const data = new Uint8Array(values.length)
  let drift = 0
  for (let i = 0; i < values.length; i++) {
    const scaled = values[i]! * 255
    const category = Math.round(scaled)
    data[i] = category
    const off = scaled - category
    if (Math.abs(off) > Math.abs(drift)) drift = off
  }
  return { data, drift }
}

/** 얼굴 상자 안 피부 비율이 이보다 낮으면 깨진 마스크(-718). 앞머리·안경이 덮어도 볼·턱 피부는 남는다 */
const MASK_MIN_SKIN = 0.05

/**
 * 분할 마스크가 깨졌는지(-718). 얼굴 점이 잡혔는데 얼굴 상자 안에 피부가 거의 없으면 깨진 결과다.
 * 일부 기기·브라우저(갤럭시 네이버 앱)에서 GPU 분할이 전부 배경(0)으로 나와, 수치 0%로 앞머리·안경을 통과시켰다.
 * 얼굴 점이 없으면 판단하지 않는다(false).
 */
export function maskLooksBroken(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  lm: Landmark[],
): boolean {
  let minX = 1
  let maxX = 0
  let minY = 1
  let maxY = 0
  for (const p of lm) {
    if (!p) continue
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const X0 = Math.max(0, Math.floor(minX * width))
  const X1 = Math.min(width, Math.ceil(maxX * width))
  const Y0 = Math.max(0, Math.floor(minY * height))
  const Y1 = Math.min(height, Math.ceil(maxY * height))
  let all = 0
  let skin = 0
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      all++
      if (isSkin(mask[y * width + x]!)) skin++
    }
  }
  if (all === 0) return false
  return skin / all < MASK_MIN_SKIN
}

/**
 * 깨진 마스크가 이어질 때 할 일(-718). limit번 이어지면 GPU → CPU로 다시 띄우고('cpu'),
 * CPU에서도 limit번 이어지면 포기한다('dead' → 직접 확인). 정상 마스크가 오면 다시 센다.
 */
export function segmentationGuard(limit = 3) {
  let streak = 0
  let stage: 'gpu' | 'cpu' | 'dead' = 'gpu'
  return {
    report(broken: boolean): 'keep' | 'cpu' | 'dead' {
      if (!broken || stage === 'dead') {
        streak = 0
        return 'keep'
      }
      if (++streak < limit) return 'keep'
      streak = 0
      stage = stage === 'gpu' ? 'cpu' : 'dead'
      return stage
    },
  }
}

export interface FaceTracker {
  /** 한 프레임 추적. 실패하면 null(얼굴 없음과 같게 다룬다) */
  detect(video: HTMLVideoElement, now: number): TrackedFace | null
  /** 앞머리 수치(눈 주변 안경 시험 수치 `eyes` 포함). 분할 모델이 아직 없거나 실패하면 undefined(지난 값 유지) */
  measureBangs(
    video: HTMLVideoElement,
    now: number,
    landmarks: Landmark[],
  ): BangsMetrics | null | undefined
  /** 분할 모델을 못 받았다. 앞머리 확인만 건너뛴다 */
  readonly segmenterFailed: boolean
  /** 마지막 분할 마스크 요약(디버그 화면용, -716). 아직 없으면 빈 문자열 */
  readonly maskDebug: string
  close(): void
}

/**
 * 얼굴 모델을 받는다. 실패하면 reject(촬영 불가). 분할 모델은 기다리지 않고 따로 받는다 — 실패해도 촬영은 진행한다.
 */
export async function createFaceTracker(): Promise<FaceTracker> {
  const {
    FilesetResolver,
    FaceLandmarker,
    ImageSegmenter: Segmenter,
  } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_ASSETS.wasmBase)
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.faceModel, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: true,
  })

  let segmenter: ImageSegmenter | null = null
  let segmenterFailed = false
  let maskDebug = ''
  let closed = false
  const guard = segmentationGuard()
  const loadSegmenter = (delegate: 'GPU' | 'CPU') =>
    Segmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.segmenterModel, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    })
      .then((created) => {
        if (closed) created.close()
        else segmenter = created
      })
      .catch(() => {
        segmenterFailed = true
      })
  void loadSegmenter('GPU')

  return {
    detect(video, now) {
      try {
        return poseFromResult(landmarker.detectForVideo(video, now))
      } catch {
        return null
      }
    },
    measureBangs(video, now, landmarks) {
      if (!segmenter) return undefined
      let metrics: BangsMetrics | null | undefined
      // 콜백 안에서 정해진다(타입 좁히기를 피하려고 as)
      let broken = null as boolean | null
      try {
        // 콜백 형태: 마스크는 콜백 안에서만 유효하다(끝나면 라이브러리가 지운다)
        segmenter.segmentForVideo(video, now, (result) => {
          const mask = result.categoryMask
          if (!mask) return
          // getAsUint8Array()는 쓰지 않는다: 버림 변환이라 일부 기기에서 번호가 밀린다(-869)
          const { data, drift } = maskCategories(mask.getAsFloat32Array())
          maskDebug = `${maskSummary(data, mask.width, mask.height)} · 소수 오차 ${drift.toFixed(4)}`
          broken = maskLooksBroken(data, mask.width, mask.height, landmarks)
          // 깨진 마스크는 수치로 쓰지 않는다(null = 아직 못 잼, 오래가면 직접 확인으로)
          if (broken) {
            metrics = null
            return
          }
          metrics = bangsFromMask(data, mask.width, mask.height, landmarks)
          if (metrics) metrics.eyes = eyeWearFromMask(data, mask.width, mask.height, landmarks)
        })
      } catch {
        segmenterFailed = true
        segmenter = null
      }
      if (broken !== null && segmenter) {
        const action = guard.report(broken)
        if (action !== 'keep') {
          segmenter.close()
          segmenter = null
          // 'cpu': GPU 분할 결과를 이 기기에서 못 읽는다고 보고 CPU로 다시 띄운다. 'dead': 직접 확인으로 넘긴다
          if (action === 'cpu') void loadSegmenter('CPU')
          else segmenterFailed = true
        }
      }
      return metrics
    },
    get segmenterFailed() {
      return segmenterFailed
    },
    get maskDebug() {
      return maskDebug
    },
    close() {
      closed = true
      landmarker.close()
      segmenter?.close()
      segmenter = null
    },
  }
}
