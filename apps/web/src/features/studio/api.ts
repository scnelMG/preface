import { api, pageQuery } from '@/shared/api/client'
import type { Page, PageParams } from '@/shared/api/types'
import type {
  CreatedSimulation,
  FaceModelDeletion,
  FaceModelDetail,
  FaceModelSummary,
  FaceModelTitle,
  SavedThumbnail,
  SimulationState,
  SimulationSummary,
  ThumbnailUpload,
} from './types'

/** API-HIS-01 내 모델(3D) 목록 */
export function listFaceModels(params?: PageParams, signal?: AbortSignal) {
  return api.get<Page<FaceModelSummary>>('/face-models', { query: pageQuery(params), signal })
}

/** API-HIS-02 3D 상세(메시 presigned URL, 10분) */
export function getFaceModel(faceModelId: string, signal?: AbortSignal) {
  return api.get<FaceModelDetail>(`/face-models/${encodeURIComponent(faceModelId)}`, { signal })
}

/**
 * API-HIS-08(가안) 내 모델 이름 바꾸기. 서버가 앞뒤 공백을 빼고 1~20자를 받는다.
 * 400 `COMMON_001`(비었거나 20자 초과), 404 `COMMON_002`(없음·남의 것·삭제됨). 같은 이름도 된다.
 */
export function renameFaceModel(faceModelId: string, title: string) {
  return api.patch<FaceModelTitle>(`/face-models/${encodeURIComponent(faceModelId)}`, { title })
}

/**
 * API-HIS-03 3D 삭제(202). 연결 시안도 함께 소프트 삭제되고 목록에서 바로 빠진다.
 * 메시·텍스처·썸네일은 30일 뒤 배치가 영구 삭제한다(FN-HIS-03).
 */
export function deleteFaceModel(faceModelId: string) {
  return api.delete<FaceModelDeletion>(`/face-models/${encodeURIComponent(faceModelId)}`)
}

/** 내 모델 썸네일 업로드 URL(S15P31B204-436, 가안). 이미 있으면 409 `HIS_010` */
export function requestThumbnailUpload(
  faceModelId: string,
  body: { sizeBytes: number; checksumSha256: string },
) {
  return api.post<ThumbnailUpload>(
    `/face-models/${encodeURIComponent(faceModelId)}/thumbnail-upload-url`,
    body,
  )
}

/** 올린 썸네일 저장(가안). 올라오지 않았으면 409 `HIS_011` */
export function saveThumbnail(
  faceModelId: string,
  body: { objectKey: string; sizeBytes: number; checksumSha256: string },
) {
  return api.put<SavedThumbnail>(`/face-models/${encodeURIComponent(faceModelId)}/thumbnail`, body)
}

/** API-HIS-06 내 시안 목록(최근 기록) */
export function listSimulations(
  params: PageParams & { faceModelId?: string } = {},
  signal?: AbortSignal,
) {
  const { faceModelId, ...page } = params
  return api.get<Page<SimulationSummary>>('/simulations', {
    query: { ...pageQuery(page), faceModelId },
    signal,
  })
}

/** API-EDIT-03 시안 상세. 작업실은 고른 모델의 마지막 시안 모습(가중치·점 조작)을 그릴 때만 쓴다 */
export function getSimulationState(simulationId: string, signal?: AbortSignal) {
  return api.get<SimulationState>(`/simulations/${encodeURIComponent(simulationId)}`, { signal })
}

/** API-HIS-07 시안 삭제. 변경 있는 시안은 소프트 삭제(30일 뒤 물리 삭제) */
export function deleteSimulation(simulationId: string) {
  return api.delete<Record<string, never>>(`/simulations/${encodeURIComponent(simulationId)}`)
}

/**
 * API-EDIT-02 시안 생성. 작업실 `실험실에서 수정하기`(내 모델)에서 부른다.
 * 편집 화면(-156)의 API 모듈이 생기면 그쪽으로 옮길 후보다.
 */
export function createSimulation(faceModelId: string) {
  return api.post<CreatedSimulation>(
    `/face-models/${encodeURIComponent(faceModelId)}/simulations`,
    {},
  )
}
