import type { ExpressionRig } from '@/features/expression/rig'
import type { EyeLimits, EyeReview, EyeState } from '@/features/edit/eyes/state'
import type { EyeReviewEvidence } from '@/features/edit/eyes/review'
import type { EyeGeometryStatus } from './eyeRig'
import type { EyeComboResult } from './useEyeLimits'
import type { ViewPreset } from './viewPresets'
import type { NoseControlId } from '@/features/edit/noseControls'
import type { FaceProfile, MeasureProfileTrial } from '@/features/edit/lab/faceProfile'

/** 하나로 보기 · 나란히 비교 */
export type CompareLayout = 'single' | 'side'
/** Before(원본 고정) · After(현재 가중치) */
export type CompareSide = 'before' | 'after'
export type ViewerStatus = 'loading' | 'ready' | 'error'

export interface NosePointStroke {
  vertex: number
  delta: [number, number, number]
}

export interface NoseHandleControl {
  id: NoseControlId
  value: number
  unavailable: boolean
}

/** 시점 요청. 같은 프리셋을 다시 눌러도 돌아가도록 nonce를 같이 바꾼다 */
export interface ViewRequest {
  preset: ViewPreset
  nonce: number
}

export interface FaceViewerProps {
  eyeEdit?: {
    state: EyeState
    review: EyeReview
    gray?: boolean
    onStatus?: (status: EyeGeometryStatus) => void
    /** 모델 파일 해시. 있으면 안전 한계를 계산하고 같은 해시·판정은 브라우저에 남긴다 */
    limitsKey?: string
    onLimits?: (limits: EyeLimits) => void
    /** 같은 엔진·판정 기준으로 미리 잰 한계(기본 모델). 워커가 이 열쇠는 다시 계산하지 않는다 */
    knownLimits?: EyeLimits
    /** 이력에 확정된 상태. 커질 때마다 조합 전체를 다시 검사한다 */
    committed?: EyeState
    onChecking?: (checking: boolean) => void
    onCombo?: (result: EyeComboResult) => void
  }

  /** 텍스처 없이 회색 재질로만 그린다(관리자 텍스처 전 메시). 눈 편집 중에는 `eyeEdit.gray`가 정한다 */
  gray?: boolean
  /** 모델 선택 화면은 회전만 허용한다. */
  rotationOnly?: boolean
  /** 레이아웃의 기준 크기·중심을 유지하면서 캔버스만 확장할 때 사용한다. CSS 픽셀 기준이다. */
  viewportFrame?: { width?: number; height: number; offsetX: number; offsetY: number }
  /** 로컬 시안: 두 모델을 반쪽 scissor로 자르지 않고 확장 캔버스에 투영한다. */
  comparisonOverflow?: boolean
  /** 화면을 기준으로 조명 방향·높이·세기를 조절한다 */
  lighting?: ViewerLighting
  /** 확대·축소 거리 범위(장면 단위, 기본 1.5~11). 메인처럼 얼굴이 무대를 넘지 않아야 하는 화면에서 좁힌다 */
  zoomRange?: { min: number; max: number }
  /**
   * 휠 확대를 보이는 모델(머리·헤어)의 화면 사각형 안에서만 받는다(메인 체험, S15P31B204-770).
   * 밖에서 굴리면 캔버스가 휠을 받지 않아 페이지가 넘어간다. 터치 두 손가락 확대는 그대로다(wheelZoomArea.ts)
   */
  zoomOnlyOverModel?: boolean
  /** 옮기기 한계(장면 단위, 기본 0.9). 바라보는 중심이 원점에서 각 축으로 이만큼까지만 간다 */
  panLimit?: number
  /** 우클릭 드래그로 화면 안에서 모델 위치를 옮긴다. 기본 화면은 기존 조작을 유지한다 */
  enablePan?: boolean
  /** 비교 진입 시 두 모델 전체를 맞춘다. 이후 확대·이동은 자유롭게 조작한다 */
  fitComparison?: boolean
  /** GLB 주소(presigned GET 또는 정적 자산) */
  meshUrl: string
  /** 씌울 헤어 GLB(정적 자산, S15P31B204-699). 없으면 민머리. Before·After에 같은 헤어가 붙는다 */
  hairUrl?: string | null
  /** 헤어를 다 씌웠거나(ready) 불러오지 못했다(error) */
  onHairStatus?: (status: 'ready' | 'error') => void
  /**
   * 씌운 헤어(두피 칠 포함)를 잠깐 숨긴다. 원본 보기를 누르고 있는 동안 켠다(S15P31B204-839).
   * 헤어 GLB·맞춘 사본은 그대로 두고 보이기만 끈다(떼면 다시 불러오지 않고 바로 보인다)
   */
  hairHidden?: boolean
  /** 모델을 변경하지 않고 헤어 파일과 맞춤을 먼저 확인한다. */
  hairProbe?: { url: string; onStatus: (status: 'ready' | 'error') => void }
  /** 생성 모델의 별도 nose rig presigned GET. 공개 샘플·이전 모델은 없다 */
  rigUrl?: string | null
  /** 받아 둔 표정 트래킹 리그(무대가 처음 켤 때 받아 넘긴다). 있으면 3D 뷰어가 표정을 얹는다 */
  expressionRig?: ExpressionRig | null
  /** After에 적용할 가중치(MorphState.weights). 누락 키는 0 */
  weights: Readonly<Record<string, number>>
  layout: CompareLayout
  /** 하나로 보기에서 보여 줄 쪽 */
  showing: CompareSide
  view: ViewRequest
  onStatusChange?: (status: ViewerStatus) => void
  /**
   * 캔버스를 그림으로 읽을 수 있게 그린 뒤 버퍼를 지우지 않는다(WebGL preserveDrawingBuffer). 썸네일 캡처(-436)에서만 켠다 —
   * 켜면 매 프레임 복사가 생겨 조금 느려진다.
   */
  capturable?: boolean
  /** weights 중 이 모델에 없는 효과(0이 아닌 것만). 미지원 안내용 */
  onUnsupportedCodes?: (codes: string[]) => void
  /** 현재 읽은 자산에서 실제 렌더할 수 있는 효과. 서버의 편집 승인과는 별도다. */
  onSupportedCodes?: (codes: string[]) => void
  onNosePreviewCheck?: (check: NosePreviewCheck | null) => void
  /** GLB에 기록된 눈별 판정과 판정 파일 해시. 누락 시 unknown/null이다. */
  onEyeReview?: (evidence: EyeReviewEvidence) => void
  onFaceProfile?: (
    current: FaceProfile | null,
    original: FaceProfile | null,
    measureTrial?: MeasureProfileTrial,
  ) => void
  pauseFaceProfile?: boolean
  pointStrokes?: readonly NosePointStroke[]
  pointEditEnabled?: boolean
  noseHandleControls?: readonly NoseHandleControl[]
  /** 상담 카드에서 선택한 코 효과의 해부학적 위치 표시 */
  highlightCodes?: readonly string[]
  onNoseHandlePreview?: (changes: readonly { id: NoseControlId; value: number }[]) => void
  onNoseHandleCommit?: () => void
}

export type NosePreviewCheck = (weights: Readonly<Record<string, number>>) => boolean

export interface ViewerLighting {
  azimuth: number
  elevation: number
  intensity: number
}
