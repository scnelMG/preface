/** 3D 복원 타입. 원본: API 명세서 v2.7 "4. 상세 — 3D 복원 (REC, 비동기 job)" */

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'

/** 화면 4단계와 1:1로 맞춘다. 진행 바는 stageIndex 기준이고 %는 쓰지 않는다 */
export type JobStage = 'FRAME_SELECT' | 'QUALITY_CHECK' | 'RECONSTRUCT' | 'FINALIZE'

export const STAGE_ORDER: readonly JobStage[] = [
  'FRAME_SELECT',
  'QUALITY_CHECK',
  'RECONSTRUCT',
  'FINALIZE',
]

export const STAGE_COUNT = STAGE_ORDER.length

/**
 * 복원 실패 사유. **서버는 문구를 내리지 않는다.**
 * 사용자 문구와 고치는 방법은 FE 문구 사전이 코드별로 만든다 (API-REC-02 비고, 화면 SCR-09).
 * 복수로 올 수 있다.
 */
export type FailCode =
  | 'QUALITY_NO_FACE'
  | 'QUALITY_ANGLE'
  | 'QUALITY_LIGHT'
  | 'QUALITY_COMPRESSED'
  | 'FIT_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL'

/** API-REC-02 GET /reconstructions/{jobId}, API-REC-03 GET /reconstructions/current */
export interface ReconstructionJob {
  jobId: string
  status: JobStatus
  /**
   * 현재 단계. 아직 단계가 없으면 null (v2.8).
   * QUEUED에도 단계가 온다: 프레임 추출 중이면 FRAME_SELECT(1), 추출이 끝나 GPU 워커 순서를
   * 기다리면 QUALITY_CHECK(2). 단계 없는 QUEUED(null)도 그대로 받는다.
   */
  stage: JobStage | null
  /** 1~4. `stage`와 함께 null일 수 있다 (v2.8) */
  stageIndex: number | null
  /**
   * 차례를 기다리는 동안(`waiting`) 그 작업이 기다리는 대기열(프레임 추출 대기 또는 GPU 대기) 안 순번(1부터).
   * 기다리지 않으면 null. 이전 BE는 QUEUED 전체를 섞어 센 순번을 준다(S15P31B204-729)
   */
  queuePosition: number | null
  /**
   * 차례를 기다리는 중(S15P31B204-729). 기다리는 단계는 `stageIndex`이고 null이면 1단계.
   * 추출 중·실행 중·끝난 작업은 false. 이 필드가 없는 이전 BE는 `waitingStageIndex`가 상태로 추정한다
   */
  waiting?: boolean
  /** `waiting`일 때 그 대기열에서 기다리기 시작한 시각, 그 외 null */
  waitingSince?: string | null
  /** FAILED일 때만 채워진다 */
  failCodes: FailCode[]
  /** SUCCEEDED일 때만 */
  faceModelId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** API-REC-01 POST /reconstructions */
export interface CreateReconstructionResult {
  jobId: string
  status: JobStatus
  queuePosition: number | null
  /** 서버가 알려주는 폴링 주기. 기본 3000 */
  pollIntervalMs: number
  /** API-REC-02와 같은 기준(S15P31B204-729). 이전 BE에는 없다 */
  waiting?: boolean
  waitingSince?: string | null
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED'
}
