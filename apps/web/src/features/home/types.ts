/** 개발용 가짜 API(features/dev/mockApi)가 쓰는 시안·이력 타입. 원본: API 명세서 v3.1 "6. 상세 — 시안·이력 (HIS)" */

/** API-HIS-01 GET /face-models 항목 */
export interface FaceModelSummary {
  faceModelId: string
  /** 기본 `내 모델`(같으면 번호) */
  title: string
  /** Before 정면 썸네일 presigned GET(10분). 로그에 남기지 않는다 */
  thumbnailUrl: string | null
  createdAt: string
  simulationCount: number
}

/** API-HIS-06 GET /simulations 항목(빈 시안 제외, updatedAt desc) */
export interface SimulationSummary {
  simulationId: string
  faceModelId: string
  title: string
  /** 예: ["NOSE"] */
  changedParts: string[]
  createdAt: string
  updatedAt: string
}
