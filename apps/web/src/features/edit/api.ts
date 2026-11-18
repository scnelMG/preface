import { api } from '@/shared/api/client'
import type { EyeState } from './eyes/state'
import type { SampleKey } from '@/features/studio/samples'
import type { Page } from '@/shared/api/types'
import type {
  ApplyChangeRequestResult,
  EditAction,
  ConsultMessage,
  EditResult,
  FaceModelDetail,
  MorphParameterCatalog,
  SendMessageBody,
  SendMessageResult,
  Simulation,
  SimulationTitle,
} from './types'

export function getBaselineMeasurements(faceModelId: string, signal: AbortSignal) {
  return api.get<{
    status: 'AVAILABLE' | 'DEFERRED'
    observations: {
      code: string
      definition: string
      unit: string
      quality: string
      lower: number
      upper: number
    }[]
  }>(`/face-models/${encodeURIComponent(faceModelId)}/baseline-measurements`, { signal })
}

export interface SampleConsultReply {
  maskedUserContent: string
  assistantMessage: string
  intent: 'EDIT' | 'CLARIFY' | 'REPLY' | 'UNDO' | 'REDO' | 'RESET'
  changeRequest: { actions: EditAction[]; skipped: { source: string; reason: string }[] } | null
  needsClarification: boolean
  options: { label: string; actions: EditAction[] }[]
  filtered: boolean
  recommendedSliderCode: string | null
}

/** 로그인 회원의 기본 모델 체험 상담. 서버 시안이나 대화 행을 만들지 않는다. */
export function sendSampleConsult(
  sampleKey: SampleKey,
  body: {
    content: string
    requestId: string
    meshSha256: string
    weights: Record<string, number>
    supportedCodes: string[]
    eyeAvailable: boolean
    eyeFoldEnabled: boolean
    eyeEdited: boolean
  },
  signal?: AbortSignal,
) {
  return api.post<SampleConsultReply>(`/sample-models/${sampleKey}/consult`, body, { signal })
}

/** API 명세서 v3.1 5절(EDIT·CON)과 HIS-02·05. 화면은 이 함수들만 부른다 */

/** API-EDIT-01. 인증 선택 — 비로그인 체험도 부른다 */
export function getMorphParameters(
  schemaVersion = 'v1',
  options: { anonymous?: boolean; signal?: AbortSignal } = {},
) {
  return api.get<MorphParameterCatalog>('/morph-parameters', {
    query: { schemaVersion },
    anonymous: options.anonymous,
    signal: options.signal,
  })
}

/** API-EDIT-02 새 시안. 작업실 `실험실에서 수정하기`가 부르고 `/simulations/{id}`로 보낸다 */
export function createSimulation(faceModelId: string) {
  return api.post<Simulation>(`/face-models/${faceModelId}/simulations`, {})
}

/** API-EDIT-03 시안 상세(현재 가중치·이력 가능 여부) */
export function getSimulation(simulationId: string, signal?: AbortSignal) {
  return api.get<Simulation>(`/simulations/${simulationId}`, { signal })
}

/** API-EDIT-04 슬라이더 직접 조절. 놓을 때 1회 = undo 1단계 */
export function updateMorphState(
  simulationId: string,
  stateVersion: number,
  changes: { code: string; value: number }[],
) {
  return api.patch<EditResult>(`/simulations/${simulationId}/morph-state`, {
    stateVersion,
    changes,
  })
}

/** 승인된 눈 상태 전체를 한 번에 저장한다(코와 같은 시안 이력). */
export function updateEyeState(simulationId: string, stateVersion: number, eyeEdit: EyeState) {
  return api.patch<EditResult>(`/simulations/${simulationId}/eye-state`, {
    stateVersion,
    eyeEdit,
  })
}

/** API-EDIT-06 되돌리기 */
export function undoEdit(simulationId: string, stateVersion: number) {
  return api.post<EditResult>(`/simulations/${simulationId}/undo`, { stateVersion })
}

/** API-EDIT-08 앞으로 가기 */
export function redoEdit(simulationId: string, stateVersion: number) {
  return api.post<EditResult>(`/simulations/${simulationId}/redo`, { stateVersion })
}

/** API-EDIT-07 초기화. 확인 모달 없이 실행하고 되돌리기 토스트를 띄운다 */
export function resetEdit(simulationId: string, stateVersion: number) {
  return api.post<EditResult>(`/simulations/${simulationId}/reset`, { stateVersion })
}

/** API-EDIT-05 변경 요청 → 3D 반영. CON-01이 COMPLETE를 주면 확인 없이 이어서 부른다 */
export function applyChangeRequest(simulationId: string, requestId: string, stateVersion: number) {
  return api.post<ApplyChangeRequestResult>(
    `/simulations/${simulationId}/change-requests/${requestId}/apply`,
    { stateVersion },
  )
}

export function previewChangeRequest(
  simulationId: string,
  requestId: string,
  stateVersion: number,
) {
  return api.post<ApplyChangeRequestResult>(
    `/simulations/${simulationId}/change-requests/${requestId}/preview`,
    { stateVersion },
  )
}

/** API-CON-01 상담 메시지 전송 */
export function sendConsultMessage(simulationId: string, body: SendMessageBody) {
  return api.post<SendMessageResult>(`/simulations/${simulationId}/messages`, body)
}

/** API-CON-02 상담 내역. seq 오름차순 */
export function getConsultMessages(
  simulationId: string,
  {
    page = 0,
    size = 50,
    archived = false,
  }: { page?: number; size?: number; archived?: boolean } = {},
  signal?: AbortSignal,
) {
  return api.get<Page<ConsultMessage> & { conversationAfterSeq?: number }>(
    `/simulations/${simulationId}/messages`,
    {
      query: { page, size: Math.min(size, 50), ...(archived ? { archived: 'true' } : {}) },
      signal,
    },
  )
}

export function startConsultConversation(simulationId: string) {
  return api.post<{ conversationAfterSeq: number }>(
    `/simulations/${simulationId}/messages/new-conversation`,
    {},
  )
}

/** API-HIS-05 시안 이름 지정(편집실 도구 줄 제목·작업실 이름 바꾸기). 가중치·대화는 이미 자동 저장돼 있다 */
export function renameSimulation(simulationId: string, title: string) {
  return api.patch<SimulationTitle>(`/simulations/${simulationId}`, { title })
}

/**
 * 내 3D의 정면 사진 presigned GET(10분, BE S15P31B204-604, docs/design/face-model-front-photo.md).
 * 남의 것·삭제된 것·사진 보관 전에 만든 예전 3D는 404 `COMMON_002`
 */
export function getFrontPhoto(faceModelId: string, signal?: AbortSignal) {
  return api.get<FrontPhoto>(`/face-models/${encodeURIComponent(faceModelId)}/front-photo`, {
    signal,
  })
}

export interface FrontPhoto {
  url: string
  /** ISO-8601 */
  expiresAt: string
}

/** API-HIS-02 3D 상세(메시 presigned URL, 10분). 만료되면 다시 부른다 */
export function getFaceModel(faceModelId: string, signal?: AbortSignal) {
  return api.get<FaceModelDetail>(`/face-models/${faceModelId}`, { signal })
}
