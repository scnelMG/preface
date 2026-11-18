import { secToMs } from './format'
import type { AdminJobDetail, JobFailure, JobSegment, QualityReport } from './types'

/**
 * 작업 상세의 6단계 계산(S15P31B204-709, 설계안 "관리자 페이지 생성 단계 조회" MR A).
 *
 * 단계 경계는 실행 위치(웹 → EC2 → GPU 워커 작업 4개)다. 지금 관리자 API(API-ADM-04)에 오는 값만으로 계산한다.
 *
 * | 단계 | BE 구간 | qualityReport |
 * | --- | --- | --- |
 * | ① capture | 없음(작업 생성 전) | input |
 * | ② extract | EXTRACT(·FRAME_SELECT) | input.frameCount, failure.detail(QUALITY_ANGLE) |
 * | ③ sfm | QUALITY_CHECK + RECONSTRUCT 일부 | stageSec.prepare·sfm |
 * | ④ lens | RECONSTRUCT 일부 | stageSec.lens, registered, focalPx·focalSource, diag.lensTrials |
 * | ⑤ model | RECONSTRUCT 일부 | stageSec.model(·dense), modelSec, chosen, holdoutPctIod, poseCheck, face, head, diag |
 * | ⑥ finalize | FINALIZE | stageSec.viewer, bakeSec, finalizeSec, captureViews, noseCheck |
 *
 * 대기 구간(EXTRACT_WAIT·GPU_WAIT)은 단계가 아니라 단계 사이 띠다.
 *
 * 상태 규칙: 실패는 한 건에 최대 한 단계이고 그 뒤 단계는 모두 skipped. 기록 판정(poseCheck·noseCheck 등)이 있는
 * 통과 단계는 passed_with_notes. RECONSTRUCT 실패의 세부 단계는 `timeoutStage` → `failure.detail` 앞머리
 * (`sfm:`·`lens:`·`model:`, worker.py build_failure) → 시간 초과 문장(`during model`) 순으로 판단하고, 셋 다 없으면
 * stageSec에 마지막으로 남은 단계로 추정한다(`failedGuessed`).
 */

export const STAGE_KEYS = ['capture', 'extract', 'sfm', 'lens', 'model', 'finalize'] as const
export type StageKey = (typeof STAGE_KEYS)[number]

export const STAGE_INFO: Record<StageKey, { no: string; label: string; place: string }> = {
  capture: { no: '①', label: '촬영 가이드', place: '웹(휴대폰)' },
  extract: { no: '②', label: '프레임 추출', place: 'EC2' },
  sfm: { no: '③', label: '카메라 복원(SfM)', place: 'GPU 워커' },
  lens: { no: '④', label: '렌즈·자세 검사', place: 'GPU 워커' },
  model: { no: '⑤', label: '형상 모델', place: 'GPU 워커' },
  finalize: { no: '⑥', label: '뷰어·마무리', place: 'GPU 워커' },
}

export type StageStatus =
  'pending' | 'running' | 'passed' | 'passed_with_notes' | 'failed' | 'skipped'

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  pending: '시작 전',
  running: '진행 중',
  passed: '통과',
  passed_with_notes: '통과 · 기록 있음',
  failed: '실패',
  skipped: '건너뜀',
}

/** 판정 하나. fail은 생성을 멈춘 판정, record는 통과했지만 남긴 판정 */
export interface StageVerdict {
  kind: 'fail' | 'record'
  /** failCode(FIT_FAILED 등) 또는 기록 판정 이름(POSE_CHECK 등) */
  code: string
  /** 어느 검사에서 멈췄는지(예: "측면 등록 부족"). 모르면 없음 */
  check?: string
  message: string
  measured?: string
  threshold?: string
}

/** 단계 시간을 이루는 조각 */
export interface StageTimePart {
  label: string
  durationMs: number | null
  /** segment: BE 구간 기록, stageSec: 워커 run_all 단계 초, video: 영상 길이 */
  source: 'segment' | 'stageSec' | 'video'
  segment?: JobSegment
  /** ③–⑤가 함께 쓰는 RECONSTRUCT 구간. 단계 시간 합에는 넣지 않는다 */
  shared?: boolean
}

export interface StageView {
  key: StageKey
  no: string
  label: string
  place: string
  status: StageStatus
  /** 단계 시간. 공유 구간을 뺀 조각의 합, 하나도 모르면 null */
  durationMs: number | null
  parts: StageTimePart[]
  verdicts: StageVerdict[]
}

export interface WaitBand {
  key: 'EXTRACT_WAIT' | 'GPU_WAIT'
  label: string
  /** 이 띠 앞의 단계 */
  after: StageKey
  durationMs: number | null
  /** 기록이 있다(구간이 응답에 있다) */
  recorded: boolean
}

export interface JobStages {
  stages: StageView[]
  waits: WaitBand[]
  failed: StageKey | null
  /** 실패 단계를 기록으로 정하지 못하고 추정했다 */
  failedGuessed: boolean
  quality: QualityReport | null
}

/** input.quality가 객체일 때만 qualityReport로 읽는다 */
export function qualityOf(input: AdminJobDetail['input']): QualityReport | null {
  const quality: unknown = input?.quality
  return quality && typeof quality === 'object' && !Array.isArray(quality)
    ? (quality as QualityReport)
    : null
}

/** run_all 단계 이름 → 화면 단계 */
const RUN_ALL_STAGE: Record<string, StageKey> = {
  prepare: 'sfm',
  sfm: 'sfm',
  lens: 'lens',
  model: 'model',
  dense: 'model',
  viewer: 'finalize',
  'after viewer': 'finalize',
}
const RUN_ALL_ORDER = ['prepare', 'sfm', 'lens', 'model', 'dense', 'viewer'] as const

const DETAIL_PREFIX = /^(prepare|sfm|lens|model|viewer):/
const TIMEOUT_DURING = /during (after viewer|prepare|sfm|lens|model|viewer)\b/

/** BE 구간(PipelineStage) → 화면 단계. RECONSTRUCT는 세부 단계를 따로 정한다 */
const SEGMENT_STAGE: Record<string, StageKey> = {
  EXTRACT: 'extract',
  FRAME_SELECT: 'extract',
  QUALITY_CHECK: 'sfm',
  FINALIZE: 'finalize',
}

/** RECONSTRUCT 실패가 ③④⑤⑥ 중 어디인지 */
export function reconstructSubStage(
  failure: Pick<JobFailure, 'detail'> | null,
  quality: QualityReport | null,
): { stage: StageKey; guessed: boolean } {
  const timeout = quality?.timeoutStage
  if (typeof timeout === 'string' && RUN_ALL_STAGE[timeout]) {
    return { stage: RUN_ALL_STAGE[timeout], guessed: false }
  }
  const detail = failure?.detail ?? ''
  const prefix = DETAIL_PREFIX.exec(detail)
  if (prefix) return { stage: RUN_ALL_STAGE[prefix[1]], guessed: false }
  const during = TIMEOUT_DURING.exec(detail)
  if (during) return { stage: RUN_ALL_STAGE[during[1]], guessed: false }
  // run_all은 단계가 끝날 때마다(실패해도) 초를 남긴다. 마지막으로 남은 단계에서 멈췄다고 본다
  const sec = quality?.stageSec ?? {}
  const last = [...RUN_ALL_ORDER].reverse().find((name) => typeof sec[name] === 'number')
  return { stage: last ? RUN_ALL_STAGE[last] : 'sfm', guessed: true }
}

/** 실패 단계. 실패 작업이 아니면 null */
export function failedStageOf(
  detail: Pick<AdminJobDetail, 'status' | 'stage' | 'failure' | 'input'>,
): { stage: StageKey | null; guessed: boolean } {
  if (detail.status !== 'FAILED') return { stage: null, guessed: false }
  const failure = detail.failure
  const where = failure?.stage ?? detail.stage
  if (where === 'RECONSTRUCT') return reconstructSubStage(failure, qualityOf(detail.input))
  if (where && SEGMENT_STAGE[where]) return { stage: SEGMENT_STAGE[where], guessed: false }
  // 단계 기록이 없는 실패: 품질 코드면 추출 단계, 아니면 3D 쪽으로 추정
  const codes = failure?.codes ?? []
  if (codes.some((code) => code.startsWith('QUALITY_'))) return { stage: 'extract', guessed: true }
  return reconstructSubStage(failure, qualityOf(detail.input))
}

function sumMs(parts: readonly StageTimePart[]): number | null {
  const own = parts.filter((part) => !part.shared && part.durationMs != null)
  return own.length ? own.reduce((total, part) => total + (part.durationMs ?? 0), 0) : null
}

function segmentPart(segment: JobSegment, label: string, shared = false): StageTimePart {
  const attempt =
    segment.attempt != null && segment.attempt > 1 ? ` (${segment.attempt}번째 시도)` : ''
  return {
    label: `${label}${attempt}`,
    durationMs: segment.durationMs ?? null,
    source: 'segment',
    segment,
    shared,
  }
}

function secPart(quality: QualityReport | null, name: string, label: string): StageTimePart[] {
  const value = quality?.stageSec?.[name]
  if (value === undefined) return []
  return [{ label, durationMs: secToMs(value), source: 'stageSec' }]
}

/** 구간들의 상태. 마지막 시도가 RUNNING이면 running, SUCCEEDED면 passed, 그 밖엔 모름 */
function segmentsStatus(segments: readonly JobSegment[]): 'running' | 'passed' | null {
  const last = segments.at(-1)
  if (!last) return null
  if (last.status === 'RUNNING' || (last.startedAt && !last.finishedAt && !last.status)) {
    return 'running'
  }
  if (last.status === 'SUCCEEDED') return 'passed'
  return null
}

/** 단계 6칸과 대기 띠 */
export function jobStages(detail: AdminJobDetail): JobStages {
  const quality = qualityOf(detail.input)
  const segments = detail.segments ?? []
  const of = (...keys: string[]) => segments.filter((segment) => keys.includes(segment.key))
  const reconstruct = of('RECONSTRUCT')
  const shared = reconstruct.map((segment) =>
    segmentPart(segment, '3D 만들기 구간(③–⑤ 공통)', true),
  )

  const parts: Record<StageKey, StageTimePart[]> = {
    capture:
      detail.input?.videoDurationMs != null
        ? [{ label: '영상 길이', durationMs: detail.input.videoDurationMs, source: 'video' }]
        : [],
    extract: [
      ...of('EXTRACT').map((segment) => segmentPart(segment, '프레임 추출')),
      ...of('FRAME_SELECT').map((segment) => segmentPart(segment, '프레임 고르기')),
    ],
    sfm: [
      ...of('QUALITY_CHECK').map((segment) => segmentPart(segment, '묶음 받기·확인')),
      ...secPart(quality, 'prepare', '준비(prepare)'),
      ...secPart(quality, 'sfm', 'SfM'),
      ...shared,
    ],
    lens: [...secPart(quality, 'lens', '렌즈 검사(lens)'), ...shared],
    model: [
      ...secPart(quality, 'model', '형상 모델(model)'),
      ...secPart(quality, 'dense', '조밀 복원(dense)'),
      ...shared,
    ],
    finalize: [
      ...secPart(quality, 'viewer', '뷰어 만들기(viewer)'),
      ...of('FINALIZE').map((segment) => segmentPart(segment, '마무리 구간')),
    ],
  }

  const { stage: failed, guessed } = failedStageOf(detail)
  const failedIndex = failed ? STAGE_KEYS.indexOf(failed) : -1

  // 진행 중·대기·취소 작업의 단계별 상태(구간 기록으로)
  const progress: Record<StageKey, 'running' | 'passed' | null> = {
    capture: 'passed',
    extract: segmentsStatus(of('EXTRACT', 'FRAME_SELECT')),
    sfm: segmentsStatus(of('QUALITY_CHECK')),
    lens: null,
    model: null,
    finalize: segmentsStatus(of('FINALIZE')),
  }
  const reconstructStatus = segmentsStatus(reconstruct)
  if (reconstructStatus) {
    // RECONSTRUCT는 ③–⑤ 한 구간이라 진행 중이면 셋 다 진행 중으로 본다(QUALITY_CHECK 뒤에 온다)
    progress.sfm = reconstructStatus
    progress.lens = reconstructStatus
    progress.model = reconstructStatus
  }
  if (progress.finalize) {
    for (const key of ['extract', 'sfm', 'lens', 'model'] as const) progress[key] ??= 'passed'
  }

  const stages = STAGE_KEYS.map((key, index): StageView => {
    let status: StageStatus
    if (failedIndex >= 0) {
      status = index < failedIndex ? 'passed' : index === failedIndex ? 'failed' : 'skipped'
    } else if (detail.status === 'SUCCEEDED') {
      status = 'passed'
    } else {
      status = progress[key] ?? (detail.status === 'CANCELED' ? 'skipped' : 'pending')
      if (detail.status === 'CANCELED' && status === 'running') status = 'skipped'
    }
    const verdicts =
      status === 'skipped' || status === 'pending'
        ? []
        : verdictsOf(key, status === 'failed', detail, quality)
    if (status === 'passed' && verdicts.some((verdict) => verdict.kind === 'record')) {
      status = 'passed_with_notes'
    }
    const stageParts = status === 'skipped' ? [] : parts[key]
    return {
      key,
      ...STAGE_INFO[key],
      status,
      durationMs: sumMs(stageParts),
      parts: stageParts,
      verdicts,
    }
  })

  const waitOf = (key: WaitBand['key'], label: string, after: StageKey): WaitBand => {
    const segment = of(key).at(-1)
    return {
      key,
      label,
      after,
      durationMs: segment?.durationMs ?? null,
      recorded: Boolean(segment),
    }
  }

  return {
    stages,
    waits: [
      waitOf('EXTRACT_WAIT', '추출 대기', 'capture'),
      waitOf('GPU_WAIT', 'GPU 대기', 'extract'),
    ],
    failed,
    failedGuessed: guessed,
    quality,
  }
}

/** 처음 열 단계: 실패 → 진행 중 → 기록 있음 → ⑥ */
export function defaultStage(stages: readonly StageView[]): StageKey {
  return (
    stages.find((stage) => stage.status === 'failed')?.key ??
    stages.find((stage) => stage.status === 'running')?.key ??
    stages.find((stage) => stage.status === 'passed_with_notes')?.key ??
    'finalize'
  )
}

// ---------------------------------------------------------------------------------------------
// 판정

/** debugMessage("이유 | exit N: 출력 끝")에서 이유만. 출력 끝에는 경로가 섞일 수 있다 */
export function failureReason(detail: string | null | undefined): string {
  if (!detail) return ''
  return detail.split(' | ')[0].trim()
}

/** QUALITY_ANGLE 실패의 각도 판정 JSON(frames_bundle.py angle_check) */
export interface AngleCheck {
  status?: string
  short?: string[]
  yawMin?: number
  yawMax?: number
  frontYaw?: number
  sideMinDeg?: number
  trace?: {
    yawMin?: number
    yawMax?: number
    used?: boolean
    note?: string
    /** 쪽마다 turn(덜 돌림) · selection(돌렸지만 프레임에 없음) */
    cause?: Record<string, string>
  } | null
}

/** failure.detail이 각도 판정 JSON이면 읽는다(1000자에서 잘렸으면 null) */
export function angleCheckOf(detail: string | null | undefined): AngleCheck | null {
  if (!detail || !detail.trimStart().startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(detail)
    return parsed && typeof parsed === 'object' ? (parsed as AngleCheck) : null
  } catch {
    return null
  }
}

/** frames_bundle.py FRONT_MAX_DEG */
export const FRONT_MAX_DEG = 15
const SIDE_LABEL: Record<string, string> = { LEFT: '왼쪽', RIGHT: '오른쪽', FRONT: '정면' }
const CAUSE_LABEL: Record<string, string> = {
  turn: '덜 돌림',
  selection: '돌렸지만 고른 프레임에 없음',
}

const deg = (value: number | undefined) =>
  typeof value === 'number' ? `${Number(value.toFixed(1))}°` : '?'

function angleVerdict(code: string, angle: AngleCheck): StageVerdict {
  const short = angle.short ?? []
  const cause = angle.trace?.cause ?? {}
  const causes = Object.entries(cause).map(
    ([side, why]) => `${SIDE_LABEL[side] ?? side} ${CAUSE_LABEL[why] ?? why}`,
  )
  return {
    kind: 'fail',
    code,
    check: '회전 부족',
    message:
      `부족: ${short.map((side) => SIDE_LABEL[side] ?? side).join(', ') || '-'}` +
      (causes.length ? ` · 원인 ${causes.join(', ')}` : '') +
      (angle.trace?.note ? ` · ${angle.trace.note}` : ''),
    measured: `왼쪽 ${deg(angle.yawMin === undefined ? undefined : -angle.yawMin)} · 오른쪽 ${deg(angle.yawMax)} · 정면에 가장 가까운 ${deg(angle.frontYaw)}`,
    threshold: `옆 ${deg(angle.sideMinDeg)} 이상 · 정면 ${FRONT_MAX_DEG}° 이내`,
  }
}

/** ④ 렌즈·자세 검사 실패 문장(run_all.py lens 단계) → 어느 검사인지와 측정·기준값 */
function lensCheck(
  reason: string,
  quality: QualityReport | null,
): Pick<StageVerdict, 'check' | 'measured' | 'threshold'> {
  const ratio = (registered?: number, frames?: number) =>
    typeof registered === 'number' && typeof frames === 'number' && frames > 0
      ? `등록 ${registered}/${frames}장 (${Math.round((registered / frames) * 100)}%)`
      : undefined
  if (reason.includes('60% 미만')) {
    return {
      check: '등록 비율 부족',
      measured: ratio(quality?.registered, quality?.frames),
      threshold: '등록 60% 이상',
    }
  }
  if (reason.includes('반대')) {
    return { check: '회전 방향 반대', threshold: 'SfM 회전 방향 = 고개 방향' }
  }
  const direction = /회전 방향 일치 ([\d.]+).*?기준 ([\d.]+) 이상/.exec(reason)
  if (direction) {
    return {
      check: '회전 방향 비율 부족',
      measured: `방향 일치 ${direction[1]}`,
      threshold: `${direction[2]} 이상`,
    }
  }
  const slope = /고개 회전의 ([\d.]+)배.*?기준 ([\d.]+) 이상/.exec(reason)
  if (slope) {
    return {
      check: '회전 크기 부족',
      measured: `SfM 회전 = 고개 회전의 ${slope[1]}배`,
      threshold: `${slope[2]}배 이상`,
    }
  }
  if (reason.includes('측면')) {
    const sides = [...reason.matchAll(/(왼쪽|오른쪽) 측면 (\d+)\/(\d+)장/g)].map(
      (match) => `${match[1]} ${match[2]}/${match[3]}장`,
    )
    const min = /기준 (\d+)% 이상/.exec(reason)
    return {
      check: '측면 등록 부족',
      measured: sides.length ? sides.join(' · ') : undefined,
      threshold: `측면 프레임 ${min ? min[1] : '50'}% 이상 · 2장 이상`,
    }
  }
  if (reason.includes('lens_anchor exit')) {
    const trials = quality?.diag?.lensTrials?.length
    return {
      check: '초점 후보 모두 불일치',
      measured: trials ? `초점 후보 ${trials}개 시도` : undefined,
    }
  }
  if (reason.includes('예상 각도')) return { check: '측면 접힘' }
  if (reason.includes('프레임 크기')) return { check: '프레임 크기 여러 종류' }
  return {}
}

function failVerdicts(
  key: StageKey,
  detail: AdminJobDetail,
  quality: QualityReport | null,
): StageVerdict[] {
  const failure = detail.failure
  const codes = failure?.codes.length ? failure.codes : ['-']
  const code = codes.join(', ')
  const angle = codes.includes('QUALITY_ANGLE') ? angleCheckOf(failure?.detail) : null
  if (angle) return [angleVerdict(code, angle)]

  const reason = failureReason(failure?.detail)
  const verdict: StageVerdict = { kind: 'fail', code, message: reason || '내부 상세 없음' }
  if (codes.includes('TIMEOUT')) {
    verdict.check = '시간 초과'
    if (quality?.timeoutStage) verdict.measured = `초과 당시 단계: ${quality.timeoutStage}`
  }
  if (key === 'lens') Object.assign(verdict, lensCheck(reason.replace(/^lens:\s*/, ''), quality))
  if (key === 'finalize' && quality?.noseCheck && /nose/i.test(reason)) {
    verdict.check = '코 편집 검사 실패'
    verdict.measured = quality.noseCheck.reason ?? verdict.measured
  }
  return [verdict]
}

function retryRecords(segments: readonly JobSegment[]): StageVerdict[] {
  const failed = segments.filter((segment) => segment.status === 'FAILED')
  if (!failed.length || segments.length < 2) return []
  return [
    {
      kind: 'record',
      code: 'RETRY',
      message: `${segments.length}번 시도 중 ${failed.length}번 실패 후 다시 시도`,
    },
  ]
}

function verdictsOf(
  key: StageKey,
  isFailed: boolean,
  detail: AdminJobDetail,
  quality: QualityReport | null,
): StageVerdict[] {
  const verdicts: StageVerdict[] = isFailed ? failVerdicts(key, detail, quality) : []
  const segments = detail.segments ?? []
  const keysOf: Partial<Record<StageKey, string[]>> = {
    extract: ['EXTRACT', 'FRAME_SELECT'],
    sfm: ['QUALITY_CHECK'],
    finalize: ['FINALIZE'],
  }
  const own = keysOf[key]
  if (own && !isFailed) {
    verdicts.push(...retryRecords(segments.filter((segment) => own.includes(segment.key))))
  }

  if (key === 'model' && quality) {
    if (quality.poseCheck === 'FAIL') {
      verdicts.push({
        kind: 'record',
        code: 'POSE_CHECK',
        check: '카메라 위치 검사',
        message: quality.poseNote ?? '고개를 돌린 쪽에서 SfM 회전이 MediaPipe보다 작음',
        threshold: '돌린 쪽 SfM 회전 ≥ MediaPipe 회전',
      })
    }
    const outside = quality.head?.outOfRange ?? []
    if (outside.length) {
      verdicts.push({
        kind: 'record',
        code: 'HEAD_RATIO',
        check: '두상 비율',
        message: `정상 범위 밖: ${outside.join(', ')}`,
        threshold: '통계 0.5–99.5% 안',
      })
    }
  }
  if (key === 'finalize' && !isFailed && quality?.noseCheck) {
    const nose = quality.noseCheck
    verdicts.push({
      kind: 'record',
      code: 'NOSE_CHECK',
      check: '코 편집 검사',
      message: nose.eligible ? '코 승인 없이 등록' : `코 편집 잠김: ${nose.reason ?? '이유 없음'}`,
    })
  }
  return verdicts
}
