/**
 * 작업실 타입. 원본: API 명세서 v3.1 "6. 상세 — 시안·이력 (HIS)", "API-EDIT-02 시안 생성".
 * 용어: 화면의 **내 모델** = `face_model`, 화면의 **시안·기록** = `simulation`.
 */
import type { MorphState } from '@/features/edit/types'

/** API-HIS-01 GET /face-models 항목. 정렬 createdAt desc — 첫 항목이 방금 완성한 내 모델 */
export interface FaceModelSummary {
  faceModelId: string
  /** 기본 `내 모델`(같으면 번호) */
  title: string
  /** Before 정면 썸네일 presigned GET(10분). 없을 수 있다 */
  thumbnailUrl: string | null
  createdAt: string
  /** 빈 시안 제외 */
  simulationCount: number
}

/** API-HIS-02 GET /face-models/{faceModelId} */
export interface FaceModelDetail {
  faceModelId: string
  /** presigned GET(10분) */
  meshUrl: string
  textureUrl: string | null
  /** 코 리그(presigned GET). 승인 전 모델·구버전 API는 없다. 시안 가중치를 3D에 반영할 때 쓴다 */
  rigUrl?: string | null
  meshFormat: 'GLB'
  morphSchemaVersion: string
  urlExpiresAt: string
  createdAt: string
}

/** 내 모델 썸네일 업로드 URL(S15P31B204-436, 가안). headers를 그대로 붙여 PUT한다 */
export interface ThumbnailUpload {
  objectKey: string
  uploadUrl: string
  headers: Record<string, string>
  expiresAt: string
}

/** 썸네일 저장 확인 응답(가안). 이미 다른 썸네일이 먼저 저장됐으면 그 주소다 */
export interface SavedThumbnail {
  faceModelId: string
  thumbnailUrl: string
}

/** API-HIS-08(가안) PATCH /face-models/{faceModelId} 응답. `title`은 서버가 앞뒤 공백을 뺀 저장값 */
export interface FaceModelTitle {
  faceModelId: string
  title: string
  updatedAt: string
}

/** API-HIS-03 DELETE /face-models/{faceModelId} 응답(202). 물리 삭제는 30일 뒤 배치라 항상 PENDING */
export interface FaceModelDeletion {
  deletionStatus: 'PENDING'
}

/** 시안이 바꾼 부위. 1차는 EYE·NOSE, 그 밖의 값이 와도 그대로 보여 준다 */
export type ChangedPart = 'EYE' | 'NOSE' | (string & {})

/** API-HIS-06 GET /simulations 항목(최근 기록). 빈 시안 제외, 정렬 updatedAt desc. 썸네일 없음 */
export interface SimulationSummary {
  simulationId: string
  faceModelId: string
  title: string
  changedParts: ChangedPart[]
  createdAt: string
  updatedAt: string
}

/** API-EDIT-03 GET /simulations/{simulationId} 중 작업실이 쓰는 값(마지막 시안 미리보기) */
export interface SimulationState {
  simulationId: string
  morphState: MorphState
}

/** API-EDIT-02 POST /face-models/{faceModelId}/simulations 응답(201) */
export interface CreatedSimulation {
  simulationId: string
  faceModelId: string
  title: string
  morphState: MorphState
  stateVersion: number
  currentSeq: number
  canUndo: boolean
  canRedo: boolean
  hasChanges: boolean
}
