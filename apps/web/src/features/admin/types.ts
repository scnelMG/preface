/**
 * 관리자 API 타입(S15P31B204-651·652·654). 계약은 BE와 같이 정한 관리자 API 계약(2026-11-07) 1~5절이다.
 *
 * - 시각은 ISO-8601 UTC 문자열, 시간 길이는 밀리초 정수(`…Ms`), 없는 값은 `null`
 * - 사용자는 `userId`(UUID)만 온다. 이메일·닉네임은 내려주지 않는다(REQ-N-24)
 */

/** BE 설정값. 운영·개발 탭 표시용 */
export type AdminEnvironment = 'prod' | 'dev' | 'local'

/** GET /admin/me */
export interface AdminMe {
  userId: string
  role: 'ADMIN'
  environment: AdminEnvironment
}

/** 관리자 목록 공통 페이지 형식. `page`는 0부터, `size` 기본 20·최대 100 */
export interface AdminPage<T> {
  items: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export type SummaryPeriod = 'today' | '7d' | '30d'

/** GET /admin/reconstructions/summary */
export interface ReconstructionSummary {
  period: SummaryPeriod
  from: string
  to: string
  /** 키는 BE `reconstruction_job.status` 값 그대로다. FE는 받은 키를 그대로 보인다 */
  counts: Record<string, number>
  total: number
  /** FAILED / (SUCCEEDED + FAILED). 끝난 작업이 없으면 null */
  failureRate: number | null
  failCodes: { code: string; count: number }[]
  durationMs: { avg: number | null; p95: number | null; targetMs: number }
  stuckCount: number
  stuckThresholdMinutes: number
}

/** GET /admin/reconstructions 의 한 줄. 최신순 */
export interface AdminJobRow {
  jobId: string
  userId: string
  status: string
  stage: string | null
  failCodes: string[]
  durationMs: number | null
  createdAt: string
  finishedAt: string | null
  captureMethod: string | null
  deviceModel: string | null
}

/** 작업 목록 거르기. 모두 쿼리 문자열로 주소에 남는다 */
export interface AdminJobFilters {
  status?: string
  failCode?: string
  stage?: string
  userId?: string
  /** `YYYY-MM-DD`(화면 날짜 입력값). API에는 그대로 보낸다 */
  from?: string
  to?: string
  page?: number
  size?: number
}

/** 작업 상세의 구간 키. 계약의 순서가 처리 순서다 */
export type SegmentKey =
  | 'EXTRACT_WAIT'
  | 'EXTRACT'
  | 'GPU_WAIT'
  | 'FRAME_SELECT'
  | 'QUALITY_CHECK'
  | 'RECONSTRUCT'
  | 'FINALIZE'

export interface JobSegment {
  key: SegmentKey | string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  attempt?: number | null
  status?: string | null
}

export interface JobFailure {
  stage: string | null
  codes: string[]
  /** BE가 모르면 null. 그때는 FE 문구 사전(failMessages.ts)으로 만든다 */
  userMessage: string | null
  /** 관리자에게만 보이는 내부 상세 */
  detail: string | null
}

/** GET /admin/reconstructions/{jobId} */
export interface AdminJobDetail {
  jobId: string
  userId: string
  status: string
  stage: string | null
  createdAt: string
  extractClaimedAt: string | null
  framesReadyAt: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  extractAttempts: number | null
  /** 기록이 없는 구간은 빠지거나 시각이 null이다 */
  segments: JobSegment[]
  slowestSegment: string | null
  /** 실패가 아니면 null */
  failure: JobFailure | null
  previousFailures: { jobId: string; createdAt: string; codes: string[] }[]
  input: {
    videoDurationMs: number | null
    captureMethod: string | null
    deviceModel: string | null
    frameCount: number | null
    /**
     * quality_report JSON 그대로. 키는 GPU 워커가 정하고 작업마다 다르다(배포 전 작업은 null).
     * 객체가 아닐 수도 있으니 `qualityOf()`(stageView.ts)로 읽는다
     */
    quality: QualityReport | null
  } | null
  faceModelId: string | null
}

export interface QueueEntry {
  /**
   * 그 목록(대기열) 안 순번, 1부터. 사용자 화면 queuePosition과 같은 기준(S15P31B204-729).
   * 추출 목록에서 지금 추출 중인 작업은 null
   */
  position: number | null
  jobId: string
  userId: string
  queuedAt: string
  waitedMs: number
}

/** GET /admin/reconstructions/queue */
export interface ReconstructionQueue {
  extract: QueueEntry[]
  gpu: QueueEntry[]
}

/**
 * GPU 워커가 보내는 qualityReport(S15P31B204-709). 원본은 services/gpu-worker/app/reconstruction/worker.py의
 * `quality_report()`·`failure_diag()`·`nose_check_note()`와 성공 보고 본문이다.
 *
 * - 워커 버전마다 키가 달라서 **모든 필드가 선택값**이다. 값이 없으면 화면은 "미측정"으로 보인다
 * - 시간은 초(`…Sec`), 각도는 도(°)
 * - 여기 없는 키(예: `captureCameras`)도 올 수 있다. 원본 JSON 영역에는 그대로 보인다
 */
export interface QualityReport {
  /** 3D 준비(prepare) 프레임 수 */
  frames?: number
  /** SfM 등록 프레임 수(④ 렌즈 검사 결과) */
  registered?: number
  focalPx?: number
  /** 초점 출처(묶음 렌즈 기록) */
  focalSource?: string
  /** 형상 모델 후보 중 선택된 것(lm·gnm·gnme 등) */
  chosen?: string
  /** 홀드아웃 띠별 오차(눈 사이 거리 대비 %) */
  holdoutPctIod?: Record<string, number | null>
  /** run_all 단계별 초: prepare·sfm·lens·model·viewer(·dense) */
  stageSec?: Record<string, number | null>
  /** run_all 전체 판정 PASS·WARN·FAIL */
  overall?: string
  /** 카메라 위치 검사. "FAIL"이면 기록 판정(결과는 사용자에게 돌려줌) */
  poseCheck?: string
  poseNote?: string
  face?: {
    holdoutLm?: number
    holdoutLine?: number
    holdoutSide?: number
    creaseP95?: number
  }
  head?: {
    ratios?: Record<string, number>
    /** 통계 0.5~99.5% 밖인 두상 비율 이름 */
    outOfRange?: string[]
  }
  /** 형상 모델 하위 프로그램별 초. 병렬이라 합이 단계 시간보다 클 수 있다 */
  modelSec?: Record<string, number>
  /** gnm_fit 안의 구간 초(load·sil_frames·ears 등 12개, S15P31B204-772) */
  gnmFitSec?: Record<string, number>
  /** 눈 부위 맞춤 안의 구간 초(measure_sec·basis_sec·solve_sec·total_sec) */
  eyePartsSec?: Record<string, number>
  /** 텍스처 베이크 하위 단계 초 */
  bakeSec?: Record<string, number>
  /** 마무리 하위 단계 초(contour·noseCheck·eyeLimits·upload). 성공 보고에만, 11/08부터 */
  finalizeSec?: Record<string, number>
  /** 5방향 사진마다 SfM 각도와 고른 방식. 성공 보고에만 */
  captureViews?: Record<string, CaptureView | null>
  /** 코 편집 검사. 코 승인이 없거나 검사 실패일 때만 */
  noseCheck?: NoseCheck
  /** 시간 초과 때 돌던 run_all 단계(prepare·sfm·lens·model·viewer·after viewer) */
  timeoutStage?: string
  /** 3D 생성 실패(FIT_FAILED·TIMEOUT·INTERNAL) 진단 수치 */
  diag?: QualityDiag
  [key: string]: unknown
}

export interface CaptureView {
  yaw?: number | null
  pitch?: number | null
  /** sfm | mediapipe */
  by?: string
}

export interface NoseTrial {
  limit?: number | string
  at?: string
  error?: string
  valid?: boolean
  canonicalValid?: boolean
  canonicalReason?: string
  skinValid?: boolean
  protectedRegionsPresent?: boolean
  affectedVertices?: number
  protectedAffectedVertices?: number
  selfIntersections?: number
}

export interface NoseCheck {
  eligible?: boolean
  /** 최대 5개 */
  tried?: NoseTrial[]
  reason?: string
}

export interface QualityDiag {
  /** frames 열 이름. 기본 [tMs, mpYaw, mpPitch, face, sfmYaw, sfmPitch] */
  cols?: string[]
  /** 고른 프레임마다 cols 순서의 값. SfM 미등록이면 sfmYaw·sfmPitch가 null */
  frames?: (number | null)[][]
  rejected?: Record<string, number>
  noFaceKept?: number | boolean
  lensTrials?: { f?: number; slope?: number; sec?: number }[]
  viewCoverage?: Record<string, unknown>
  holdoutPctIod?: Record<string, number>
  poseCheck?: string
  /** 최대 5개, 200자 이하 */
  notes?: string[]
}
