/**
 * 관리자 사용자별 생성 모델·S3 조회 타입(S15P31B204-655). 원본은 관리자 API 계약 6·7·8절이다.
 * 시각은 ISO-8601 UTC 문자열, 시간 길이는 밀리초 정수, 없는 값은 `null`.
 */

/** 관리자 목록 공통 페이지 형식. 앱 공통 `Page`와 달리 `totalPages`가 있다 */
export interface AdminPage<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

/** 계약 6. GET /admin/users/{userId}/face-models */
export interface AdminFaceModel {
  faceModelId: string
  jobId: string
  createdAt: string
  videoDurationMs: number | null
  /** reconstruction_job.status 값을 그대로 쓴다(QUEUED·RUNNING·SUCCEEDED·FAILED 등) */
  jobStatus: string
  simulationCount: number
  deletedAt: string | null
  deleteScheduledAt: string | null
}

/** 5방향 촬영 사진. 운영에서는 내려오지 않는다 */
export interface AdminCaptureImage {
  /** CaptureAngle: FRONT · LEFT · RIGHT · LEFT_45 · RIGHT_45 */
  angle: string
  /** 서명 URL. 로그·주소창·저장소에 남기지 않는다 */
  url: string
}

/** 계약 7. GET /admin/face-models/{faceModelId}/assets. 서명 URL 만료 5분 */
export interface AdminFaceModelAssets {
  faceModelId: string
  expiresAt: string
  texturedMeshUrl: string | null
  /** 텍스처 전 메시. 아직 저장하지 않아 항상 null(필드만 있다) */
  baseMeshUrl: string | null
  thumbnailUrl: string | null
  captureImages: AdminCaptureImage[]
}

export type StorageObjectState = 'OK' | 'DB_ONLY' | 'S3_ONLY' | 'DELETE_FAILED'

export interface AdminStorageObject {
  key: string
  size: number | null
  lastModified: string | null
  /** FACE_UPLOAD · FACE_UPLOAD_FRAMES · FACE_MODEL · FACE_CAPTURE_IMAGE · JOB_STAGE_LOG · DELETION_LOG. DB 기록이 없으면 null */
  source: string | null
  deleteScheduledAt: string | null
  state: StorageObjectState
}

export interface AdminDeletionFailure {
  objectKey: string
  reason: string | null
  retryCount: number
}

/** 계약 8. GET /admin/users/{userId}/storage */
export interface AdminUserStorage {
  userId: string
  prefix: string
  checkedAt: string
  /** 객체가 많아 앞부분만 나열했다(BE -653). 그 뒤 객체는 DB_ONLY 판정을 하지 못했다 */
  truncated?: boolean
  objects: AdminStorageObject[]
  deletionFailures: AdminDeletionFailure[]
}
