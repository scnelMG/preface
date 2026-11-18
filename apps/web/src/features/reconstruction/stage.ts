import {
  STAGE_COUNT,
  STAGE_ORDER,
  isTerminal,
  type JobStage,
  type ReconstructionJob,
} from './types'

/** 화면 4단계 이름. 원본: API 명세서 "4. 상세 — 3D 복원" 단계, FN-REC-03 */
export const STAGE_LABEL: Record<JobStage, string> = {
  FRAME_SELECT: '프레임 고르기',
  QUALITY_CHECK: '입력 품질 확인',
  RECONSTRUCT: '3D 얼굴 만들기',
  FINALIZE: '마무리',
}

/**
 * 진행 바 채움 비율(0~1). **%로 표시하지 않는다** — 바의 길이로만 쓴다(명세서 결정).
 *
 * Figma 진행 바(SCR-08 진행 바, v3/ProgressDock)는 2/4 단계에서 40%를 채운다.
 * 즉 `stageIndex / (단계 수 + 1)`: 마지막 칸은 완료(SUCCEEDED) 몫으로 남긴다.
 * 대기 중(stageIndex null)이면 0.
 */
export function stageFraction(job: Pick<ReconstructionJob, 'status' | 'stageIndex'>): number {
  if (job.status === 'SUCCEEDED') return 1
  if (job.stageIndex === null) return 0
  const index = Math.min(Math.max(job.stageIndex, 0), STAGE_COUNT)
  return index / (STAGE_COUNT + 1)
}

/** 대기 판단에 쓰는 필드. `waiting`이 없으면 이전 BE로 보고 상태로 추정한다 */
type WaitFields = Pick<ReconstructionJob, 'status' | 'stage'> &
  Partial<Pick<ReconstructionJob, 'stageIndex' | 'waiting'>>

/**
 * 차례를 기다리는 단계(1~4), 기다리지 않으면 null(S15P31B204-729).
 * BE가 `waiting`을 주면 그대로 따른다: 기다리는 단계는 `stageIndex`, 없으면 1단계(프레임 고르기).
 * 추출 lease가 끝나 다시 기다리는 작업은 FRAME_SELECT로 와도 1단계 대기다.
 * `waiting`이 없는 이전 BE는 QUEUED + 단계 없음 → 1단계, QUEUED + QUALITY_CHECK → 2단계 대기로 본다.
 */
export function waitingStageIndex(job: WaitFields): number | null {
  if (job.waiting !== undefined) return job.waiting ? (job.stageIndex ?? 1) : null
  if (job.status !== 'QUEUED') return null
  if (job.stage === null) return 1
  if (job.stage === 'QUALITY_CHECK') return STAGE_ORDER.indexOf('QUALITY_CHECK') + 1
  return null
}

/** 단계마다 대기열이 따로 있어 기다리는 단계 옆에 쓰는 말 */
export const WAITING_TEXT = '순서를 기다리는 중'

/**
 * 대기열 맨 앞(순번 1)일 때 쓰는 말(-794). "앞에 0명"은 기다리는 사람이 없는데도 기다리는 것처럼 읽혔다.
 * "곧 시작해요"처럼 시간을 약속하지 않는다(앞 작업이 몇 분 걸릴 수 있다)
 */
export const NEXT_TURN_TEXT = '다음 차례'

/**
 * "앞에 2명". 앞에 기다리는 작업 수 = 자기 대기열 순번 − 1. 맨 앞이면 "다음 차례"(2026-11-12, -794.
 * 2026-11-10에는 0명도 그대로 썼다). 순번이 없으면 null
 */
export function aheadText(queuePosition: number | null | undefined): string | null {
  if (!queuePosition) return null
  const ahead = Math.max(0, queuePosition - 1)
  return ahead === 0 ? NEXT_TURN_TEXT : `앞에 ${ahead}명`
}

/**
 * 순서를 기다리는 단계 옆 글. "순서를 기다리는 중 · 앞에 2명", 맨 앞이면 "다음 차례"만(말이 겹치지 않게),
 * 순번이 없으면 "순서를 기다리는 중"
 */
export function waitingStepText(queuePosition: number | null | undefined): string {
  const ahead = aheadText(queuePosition)
  if (!ahead) return WAITING_TEXT
  return ahead === NEXT_TURN_TEXT ? NEXT_TURN_TEXT : `${WAITING_TEXT} · ${ahead}`
}

/** 왜 단계마다 기다리는지 한 줄 설명(2026-11-10 결정) */
export const WAITING_NOTE = '단계마다 대기열이 따로 있어요. 앞 작업이 끝나면 차례대로 넘어가요.'

/**
 * "프레임 고르기 · 앞에 2명", "입력 품질 확인 · 다음 차례". 순번이 없으면 "프레임 고르기 · 순서를 기다리는 중".
 * 기다리지 않으면 null
 */
export function waitingCaption(
  job: WaitFields & Pick<ReconstructionJob, 'queuePosition'>,
): string | null {
  const index = waitingStageIndex(job)
  if (index === null) return null
  const stage = STAGE_ORDER[Math.min(Math.max(index, 1), STAGE_COUNT) - 1]
  return `${STAGE_LABEL[stage]} · ${aheadText(job.queuePosition) ?? WAITING_TEXT}`
}

/**
 * 하단 진행 팝업 한 줄. 진행 중이면 "입력 품질 확인 · 2/4 단계",
 * 차례를 기다리면 "프레임 고르기 · 앞에 2명"(S15P31B204-729). 단계를 모르면 "대기 중".
 */
export function stageCaption(
  job: WaitFields & Pick<ReconstructionJob, 'stageIndex' | 'queuePosition'>,
): string {
  const waiting = waitingCaption(job)
  if (waiting) return waiting
  if (job.stage === null || job.stageIndex === null) return '대기 중'
  return `${STAGE_LABEL[job.stage]} · ${job.stageIndex}/${STAGE_COUNT} 단계`
}

/**
 * 단계 목록 한 칸의 상태(S15P31B204-729).
 * - `queued`: 그 단계 차례를 기다리는 중(아직 시작 전). 점은 테두리만, 글은 강조
 * - `current`: 진행 중
 * - `upcoming`: 아직 오지 않은 단계(글 없이 흐리게)
 */
export type StepState = 'done' | 'current' | 'queued' | 'upcoming'

export function stepState(job: ReconstructionJob | null, index: number): StepState {
  if (!job) return 'upcoming'
  if (job.status === 'SUCCEEDED') return 'done'
  const waitIndex = waitingStageIndex(job)
  if (waitIndex !== null) {
    if (index < waitIndex) return 'done'
    return index === waitIndex ? 'queued' : 'upcoming'
  }
  if (job.stageIndex === null) return 'upcoming'
  if (index < job.stageIndex) return 'done'
  if (index === job.stageIndex && !isTerminal(job.status)) return 'current'
  return 'upcoming'
}

/**
 * 경과 시간 뒤에 붙는 안내. RUNNING이면 "3분에서 5분 정도 걸려요".
 * 실제 시간을 재지 않는 고정 안내다. 처음에는 "몇 분에서 십여 분"이라고 넓게 말했으나(dev에서 13분 걸린 사례, -420)
 * 지금 생성 시간에 맞춰 "3분에서 5분 정도"로 좁혔다(-884).
 * QUEUED는 워커가 언제 받을지 몰라(꺼져 있을 수도 있다) 걸리는 시간을 말하지 않는다.
 * 차례를 기다리는 중이면 "순서가 되면 바로 시작해요", 프레임을 고르는 중이면 붙이지 않는다(null).
 */
export function etaNote(job: WaitFields): string | null {
  if (job.status !== 'QUEUED') return '3분에서 5분 정도 걸려요'
  return waitingStageIndex(job) === null ? null : '순서가 되면 바로 시작해요'
}

/** "2분 10초 지났어요 · 3분에서 5분 정도 걸려요". 안내가 없으면 "2분 10초 지났어요" */
export function elapsedText(job: WaitFields, elapsedMs: number): string {
  const note = etaNote(job)
  const elapsed = `${formatElapsed(elapsedMs)} 지났어요`
  return note ? `${elapsed} · ${note}` : elapsed
}

/** 경과 시간 문구. 59초 → "59초", 130초 → "2분 10초", 3720초 → "1시간 2분" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`
  if (minutes > 0) return seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`
  return `${seconds}초`
}

/**
 * 경과 시간 기준 시각. 사용자가 기다린 시간이라 대기열에 있던 시간까지 넣어 createdAt부터 센다
 * (startedAt은 워커가 가져간 시각이다).
 */
export function elapsedSince(job: Pick<ReconstructionJob, 'createdAt'>): number {
  return Date.parse(job.createdAt)
}
