/** 편집·상담 타입. 원본: API 명세서 v3.1 "공용 구조", "5. 상세 — 편집 (EDIT) · 상담 (CON)" */
import type { EyeLimits, EyeReview, EyeState } from './eyes/state'

/**
 * 원본 대비 가중치 전체. After = 원본 + 이 값 (REQ-N-11).
 * 누락한 키는 0(원본)으로 본다. 화면 % = `weight × 100` (0.2 → "+20%", REQ-N-18).
 * 1차 키는 `eye.*`·`nose.*`다 (윤곽 `contour.*`은 2차).
 */
export interface MorphState {
  schemaVersion: string
  weights: Record<string, number>
  pointStrokes?: { vertex: number; delta: [number, number, number] }[]
  eyeEdit?: EyeState | null
}

export const EMPTY_MORPH_STATE: MorphState = { schemaVersion: 'v1', weights: {} }

/**
 * API-EDIT-01 GET /morph-parameters — 슬라이더 항목과 허용 범위.
 * 응답: `{ schemaVersion, parts: [{ part, label, items: MorphParameter[] }] }`
 */
export interface MorphParameterCatalog {
  schemaVersion: string
  parts: MorphParameterGroup[]
}

export interface MorphParameterGroup {
  part: MorphPart
  /** 부위 이름(`코`) */
  label: string
  items: MorphParameter[]
}

export interface MorphParameter {
  /** `nose.bridge_height` — MorphState.weights의 키 */
  code: string
  /** 부위 안 세부(`BRIDGE`·`TIP`·`ALAR` …) */
  subPart: string
  label: string
  min: number
  max: number
  /** ⟲(항목별 되돌리기) 값 */
  default: number
  step: number
}

export type MorphPart = 'EYE' | 'NOSE' | 'CONTOUR'

/** 편집 응답 공통(EDIT-04·06·07·08, CON-01 `morphResult`) */
export interface EditResult {
  morphState: MorphState
  stateVersion: number
  currentSeq: number
  canUndo: boolean
  canRedo: boolean
  /** EDIT-04만 */
  clamped?: boolean
  /** EDIT-06만 */
  undoneSummary?: string
  /** EDIT-08만 */
  redoneSummary?: string
}

/** API-EDIT-02·03 시안 */
export interface Simulation {
  simulationId: string
  faceModelId: string
  title: string
  morphState: MorphState
  stateVersion: number
  currentSeq: number
  canUndo: boolean
  canRedo: boolean
  hasChanges: boolean
  editApprovalPending?: boolean
  /** 서버가 모델·GLB·fit을 승인한 얼굴형 양방향 편집. 구버전 응답은 미지원이다. */
  weightShapeSupported?: boolean
  /** 상세 응답에서 모델에 결속된 공통 편집 범위. 키가 없으면 해당 조절을 잠근다. */
  editRanges?: {
    weights: Record<string, { min: number; max: number }>
    eyes: Record<string, { min: number; max: number }>
  } | null
  /** 승인된 모델별 코 범위. 미승인 모델은 null, 구버전 API는 필드가 없다. */
  capabilities?: {
    modelVersion: string
    rigVersion: string
    engineVersion: string
    supported: Record<string, { min: number; max: number }>
  } | null
  /** 새 모델의 눈별 기존 쌍꺼풀 판정. 없으면 눈 편집을 열지 않는다. */
  eyeReview?: EyeReview | null
  /** GLB 판정의 출처 파일 해시. GLB 메타데이터와 비교해 불일치하면 잠근다. */
  eyePartsSha256?: string | null
  /** 모델·리그에 결속된 승인 한계. 없으면 눈 조절은 잠긴다. */
  eyeCapabilities?: {
    meshSha256: string
    rigSha256: string
    limits: EyeLimits
  } | null
  createdAt?: string
  updatedAt?: string
}

/** API-HIS-02 3D 상세. meshUrl은 presigned GET(10분) — 로그·화면에 남기지 않는다 */
export interface FaceModelDetail {
  faceModelId: string
  meshUrl: string
  rigUrl?: string | null
  /** 표정 트래킹 리그(presigned GET). 표정 리그를 만들지 않은 모델은 없다 */
  expressionUrl?: string | null
  textureUrl: string | null
  meshFormat: string
  morphSchemaVersion: string
  urlExpiresAt: string
  createdAt: string
}

/** API-HIS-05 */
export interface SimulationTitle {
  simulationId: string
  title: string
  updatedAt: string
}

/** 명세서 "공용 구조 — ChangeRequest"(v3.0, 계약 consult-apply-v1). 편집 **후보**다 */
export interface ChangeRequest {
  requestId: string
  status: 'COMPLETE' | 'APPLIED' | 'INCOMPLETE'
  /** 변경 요청 형식 버전. 항상 "v2" */
  schemaVersion: string
  actions: EditAction[]
  skipped: SkippedClause[]
}

export interface EditAction {
  target?: number
  /** 좌우 없는 효과 코드 */
  code: string
  side: 'left' | 'right' | 'both'
  direction: 1 | -1
  strength: 'small' | 'medium' | 'large'
  /** 눈 후보의 입력 문장 속 연속 구절. 예전 코 후보에는 없을 수 있다. */
  source?: string | null
}

export interface SkippedClause {
  /** 적용하지 않은 원문 구절(마스킹본) */
  source: string
  reason: string
}

/** EDIT-05 `applied[]` — 실제로 저장된 값. code는 저장 코드 */
export interface AppliedChange {
  code: string
  from: number
  to: number
  /** DB 범위 때문에 요청보다 줄었다 */
  limited: boolean
}

/** CON-02 `applyResult`. EDIT-05 응답의 스냅숏 */
export interface ApplyResult {
  summary: string
  applied: AppliedChange[]
  /** 눈 편집이 포함된 상담의 저장 전·후 스냅숏. 없으면 코 전용 이전 응답이다. */
  eyeBefore?: EyeState | null
  eyeAfter?: EyeState | null
  eyeLimits?: EyeLimits | null
  skipped: SkippedClause[]
  seq: number
  limited: boolean
}

/** API-EDIT-05 응답 */
export interface ApplyChangeRequestResult extends ApplyResult {
  morphState: MorphState
  stateVersion: number
  currentSeq: number
  canUndo: boolean
  canRedo: boolean
}

/** 상담 의도. FastAPI `EDIT·CLARIFY·REPLY` + Spring `UNDO·REDO·RESET` */
export type ConsultIntent = 'EDIT' | 'CLARIFY' | 'REPLY' | 'UNDO' | 'REDO' | 'RESET'

export interface ConsultOption {
  /** Spring이 만든 선택지 ID. 다시 보낼 때 `selectedOptionId` */
  id: string
  label: string
}

/** API-CON-01 요청 */
export interface SendMessageBody {
  conversationAfterSeq?: number
  profileSection?: string
  recommendationMeasurements?: Record<string, number>
  /** 1~300자. 선택지면 그 label */
  content: string
  /** 같은 전송을 재시도할 때 유지하는 UUID. GMS 중복 과금을 막는다 */
  requestId?: string
  exampleId?: string
  selectedOptionId?: string
  modeSwitch?: { target: 'toFace' | 'toWeight'; stateVersion: number }
  directControl?: { code: string; stateVersion: number }
  comparisonTarget?: { code: string; value: number }
}

/** API-CON-01 응답 */
export interface SendMessageResult {
  userMessage: { id: string; content: string; masked: boolean }
  assistantMessage: {
    id: string
    sender: string
    /** EDIT이면 빈 문자열 — 성공 문구는 EDIT-05 응답으로 만든다 */
    content: string
    intent: ConsultIntent
    filtered: boolean
  }
  changeRequest: ChangeRequest | null
  needsClarification: boolean
  options: ConsultOption[]
  recommendedSliderCode: string | null
  morphResult: EditResult | null
  profileSection?: string | null
}

/** API-CON-02 항목 */
export interface ConsultMessage {
  messageId: string
  role: 'USER' | 'ASSISTANT'
  sender: string | null
  content: string
  intent: ConsultIntent | null
  needsClarification: boolean
  options: ConsultOption[]
  comparisonCode?: string | null
  profileSection?: string | null
  changeRequest: ChangeRequest | null
  applyResult: ApplyResult | null
  createdAt: string
}

/** 슬라이더 가중치를 화면 표시용 퍼센트 문자열로 바꾼다 (REQ-N-18). 규칙은 shared/ui/format 한 곳에 둔다 */
export { formatPercent as toPercentLabel } from '@/shared/ui/format'
