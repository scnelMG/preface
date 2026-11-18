'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useMattermostNotifyAvailable } from '@/features/account/mattermostAvailability'
import { MattermostNotify } from '@/features/account/MattermostNotify'
import { useAuthStore } from '@/features/auth/store'
import { FaceReadingAction, FaceReadingPanel } from '@/features/face-reading/FaceReadingCard'
import { isFaceReadingEnabled } from '@/features/face-reading/flag'
import { useFaceReading, type FaceReadingState } from '@/features/face-reading/useFaceReading'
import { studioHref } from '@/features/studio/heads'
import { SurveyPopup } from '@/features/survey/SurveyPopup'
import { ApiError } from '@/shared/api/ApiError'
import { Button, cx, Icon, Tooltip } from '@/shared/ui'
import { Modal } from '@/shared/ui/Modal'
import { announceFinished } from '../ProgressDock'
import {
  STAGE_LABEL,
  WAITING_NOTE,
  elapsedSince,
  elapsedText,
  stepState,
  waitingCaption,
  waitingStageIndex,
  waitingStepText,
  type StepState,
} from '../stage'
import { useReconstructionStore } from '../store'
import { STAGE_COUNT, STAGE_ORDER, isTerminal, type ReconstructionJob } from '../types'
import { useNow } from '../useNow'
import { useReconstructionProgress } from '../useReconstructionProgress'
import { BuildStage } from './BuildStageLoader'
import { ReconstructionFailed } from './ReconstructionFailed'

/**
 * SCR-08 3D 생성 대기(Figma Wireframe v3.2 268:2496 Desktop · 268:2615 Mobile). FN-REC-03.
 *
 * - 상태는 API-REC-02를 3초 간격으로 묻는다(`useReconstructionProgress`, REQ-F-08 "대기 화면 3초").
 * - 받은 상태를 하단 진행 팝업의 전역 스토어에도 넣는다. 팝업은 이 화면에서 숨고 폴링도 쉰다(중복 폴링 없음).
 *   화면을 떠나면 팝업이 이어받는다.
 * - 진행은 4단계와 `stageIndex`로만 보여 준다. %는 쓰지 않는다.
 *   차례를 기다리는 단계(`waiting`, 단계는 `stageIndex ?? 1`)는 '순서를 기다리는 중 · 앞에 N명'으로 강조하고,
 *   아직 오지 않은 단계는 글 없이 흐리게 둔다(S15P31B204-729, 2026-11-10 결정). 프레임 추출 중(QUEUED·FRAME_SELECT, 기다리지 않음)은 1단계 진행 중이다.
 * - 대기열(QUEUED)에서는 걸리는 시간("3분에서 5분 정도 걸려요")을 말하지 않는다. 워커가 언제 받을지 모른다.
 * - 2026-10-31: 기본 모델 체험은 이 화면에서 뺐다(만두 결정, 메인 체험은 그대로). REQ-F-09·FN-REC-04의
 *   "복원 대기 중 체험"과 다르므로 개발 서버 반영 때 기획에 알린다. 무대는 단계에 맞춰 바뀌는 예시 머리 하나다.
 * - 끝나면: 성공은 작업실로 안내, 실패(FAILED·CANCELED)는 SCR-09 모양(`ReconstructionFailed`)으로 바뀐다.
 * - AI 관상(-523): 버튼은 "내 작업실로" 옆, 진행·결과는 팝업. 버튼과 팝업이 같은 상태를 쓰도록 여기서 한 번 만든다.
 */
export function ReconstructionWaiting({ jobId }: { jobId: string }) {
  const { job, error, isLoading } = useReconstructionProgress(jobId)
  useSyncDockStore(job)
  const readingOn = job !== null && isFaceReadingEnabled()
  const reading = useFaceReading(jobId, readingOn)
  const [readingOpen, setReadingOpen] = useState(false)

  if (error && !job) return <JobMissing error={error} />

  if (job && (job.status === 'FAILED' || job.status === 'CANCELED')) {
    return <ReconstructionFailed job={job} />
  }

  const done = job?.status === 'SUCCEEDED'

  return (
    <div className="pf-recon">
      {/* ── 랜딩 톤: 왼쪽 진행(제목 · 지금 단계 · 단계 선 · 행동), 오른쪽 단계에 맞춰 바뀌는 예시 머리 ── */}
      <section className="pf-recon-hero" aria-labelledby="pf-recon-title">
        <div className="pf-recon-stage">
          <BuildStage job={job} />
          <p className="pf-recon-stage-note">
            진행 단계를 보여 주는 예시 인물이에요. 내 얼굴은 완성되면 작업실에서 볼 수 있어요.
          </p>
        </div>

        <div className="pf-recon-copy">
          <h1 id="pf-recon-title" className="pf-recon-title">
            {done ? '원본 3D가 생성됐어요' : '내 얼굴 3D를 만들고 있어요'}
          </h1>
          <ProgressCard job={job} isLoading={isLoading} />
          <StageList job={job} />
          <ExitGuide
            done={done}
            faceModelId={job?.faceModelId ?? null}
            reading={
              job && readingOn
                ? {
                    state: reading,
                    photoReady: isPhotoReady(job),
                    open: () => setReadingOpen(true),
                  }
                : null
            }
          />
          <p className="type-caption text-muted-soft">
            참고용 시뮬레이션 · 실제 결과와 다를 수 있어요. 의사 상담이 필요해요.
          </p>
        </div>
      </section>

      {/* 관상(선택 기능, 켜져 있을 때만). 진행·결과는 팝업으로 본다(-523) */}
      {job && readingOn ? (
        <Modal
          open={readingOpen}
          onClose={() => setReadingOpen(false)}
          title="AI 관상"
          className="pf-reading-modal"
        >
          <FaceReadingPanel
            state={reading}
            jobId={jobId}
            photoReady={isPhotoReady(job)}
            jobDone={done}
            faceModelId={job.faceModelId}
          />
        </Modal>
      ) : null}

      {/* 1차 배포 설문 안내(-417·-428). 2차 배포 때 이 줄, SimulationLab의 SurveyButton, features/survey를 지운다 */}
      <SurveyPopup done={done} />
    </div>
  )
}

/**
 * 이 화면이 받은 상태를 전역 스토어에 넣는다. 진행 중이면 추적, 끝나면 비운다.
 * 끝난 것은 이 화면이 직접 보여 주므로 토스트는 띄우지 않고, 탭을 떠나 있으면 브라우저 알림만 띄운다.
 */
function useSyncDockStore(job: ReconstructionJob | null) {
  const announced = useRef<string | null>(null)
  useEffect(() => {
    if (!job) return
    const store = useReconstructionStore.getState()
    if (!isTerminal(job.status)) {
      store.track(job)
      return
    }
    if (store.job?.jobId === job.jobId) store.clear()
    if (announced.current !== job.jobId) {
      announced.current = job.jobId
      announceFinished(job, { isOnResultPage: true, open: () => window.focus() })
    }
  }, [job])
}

/**
 * 관상에 쓸 정면 사진이 준비됐는지. 프레임 추출(1단계)이 끝나 QUALITY_CHECK 이후이거나 GPU 워커가 받았으면 있다.
 * 3D가 완성되면 BE가 사진을 지우지만, 그때는 카드가 이미 본 관상만 보여 준다.
 */
export function isPhotoReady(job: ReconstructionJob): boolean {
  if (job.status !== 'QUEUED') return true
  return (job.stageIndex ?? 0) >= STAGE_ORDER.indexOf('QUALITY_CHECK') + 1
}

/**
 * 지금 상태 한 덩어리(region "3D 생성 진행"): 지금 단계 이름 · n/4 단계 · 경과 시간과 걸리는 시간 안내.
 * 2026-10-31: 이름 없는 눈금 자를 없앴다. 진행 정도는 아래 단계 선(StageList) 하나로만 보인다(같은 정보를 두 번 그리지 않는다)
 */
function ProgressCard({ job, isLoading }: { job: ReconstructionJob | null; isLoading: boolean }) {
  const now = useNow(1000)
  const finished = job ? isTerminal(job.status) : false
  const waitIndex = job ? waitingStageIndex(job) : null

  let title = '3D 만들 준비 중'
  let side = ''
  if (isLoading) {
    title = '상태를 불러오는 중'
  } else if (job?.status === 'SUCCEEDED') {
    title = '원본 3D 생성 완료'
    side = `${STAGE_COUNT}/${STAGE_COUNT} 단계`
  } else if (job && finished) {
    title = '3D를 만들지 못했어요'
  } else if (job && waitIndex !== null) {
    // 차례를 기다리는 중: "프레임 고르기 · 앞에 2명" (S15P31B204-729)
    title = waitingCaption(job) ?? title
    side = `${waitIndex}/${STAGE_COUNT} 단계`
  } else if (job?.stage && job.stageIndex !== null) {
    // 진행 중: 제목 없이 '3/4 단계 · 걸리는 시간' 한 줄(2026-10-31). 화면 제목·아래 단계 목록과 겹치지 않게
    title = ''
    side = `${job.stageIndex}/${STAGE_COUNT} 단계`
  }

  const elapsed =
    job && now !== null && !finished ? elapsedText(job, now - elapsedSince(job)) : null

  return (
    <section aria-label="3D 생성 진행" className="flex flex-col gap-(--space-6)">
      {title ? (
        <div className="flex items-baseline justify-between gap-(--space-12) whitespace-nowrap">
          <p className="truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">{title}</p>
          <p className="type-caption shrink-0 text-muted-soft">{side}</p>
        </div>
      ) : null}
      {title ? elapsed ? <p className="type-caption text-muted-soft">{elapsed}</p> : null : null}
      {/* 왜 단계마다 기다리는지 한 줄(S15P31B204-729) */}
      {job && waitIndex !== null && !isLoading ? (
        <p className="type-caption text-muted-soft">{WAITING_NOTE}</p>
      ) : null}
      {title ? null : (
        <p className="text-[14px] text-ink-2">
          <span className="font-semibold text-ink tabular-nums">{side}</span>
          {elapsed ? <span className="text-muted-soft"> · {elapsed}</span> : null}
        </p>
      )}
    </section>
  )
}

/** 아직 오지 않은 단계는 글 없이 흐린 모양만 둔다(2026-11-10 결정) */
const STEP_TEXT: Record<Exclude<StepState, 'queued'>, string> = {
  done: '완료',
  current: '진행 중',
  upcoming: '',
}

/** 단계 한 칸 오른쪽 글. 차례를 기다리는 단계는 "순서를 기다리는 중 · 앞에 2명" */
function stepText(job: ReconstructionJob | null, state: StepState): string {
  if (state === 'queued') return waitingStepText(job?.queuePosition)
  return STEP_TEXT[state]
}

/**
 * Figma "⑤ 진행 단계". 2026-10-31: 단계 목록이 곧 진행 표시다.
 * 단계 표시를 잇는 세로선이 지나온 단계까지 채워지고(진행 바 역할, %는 쓰지 않는다), 지금 단계의 점이 숨 쉬듯 퍼진다.
 * 차례 대기는 테두리만 있는 점으로 '아직 시작 전'을 보이고, 글은 지금 단계처럼 강조한다.
 */
function StageList({ job }: { job: ReconstructionJob | null }) {
  const reached = job?.status === 'SUCCEEDED' ? STAGE_COUNT : (job?.stageIndex ?? 0)
  // 선은 첫 단계 점에서 마지막 단계 점까지. 지금 단계 점까지 채운다
  const fill =
    job?.status === 'SUCCEEDED' ? 1 : reached <= 1 ? 0 : (reached - 1) / (STAGE_COUNT - 1)
  const waitIndex = job ? waitingStageIndex(job) : null
  const valueText =
    job?.status === 'SUCCEEDED'
      ? `${STAGE_COUNT}/${STAGE_COUNT} 단계 완료`
      : job && waitIndex !== null
        ? `${waitIndex}/${STAGE_COUNT} 단계 · ${waitingCaption(job)}`
        : job?.stage && job.stageIndex
          ? `${job.stageIndex}/${STAGE_COUNT} 단계 · ${STAGE_LABEL[job.stage]}`
          : '대기 중'
  return (
    <div className="pf-timeline">
      <div
        role="progressbar"
        aria-label="3D 생성 단계"
        aria-valuemin={0}
        aria-valuemax={STAGE_COUNT}
        aria-valuenow={reached}
        aria-valuetext={valueText}
        className="pf-timeline-line"
      >
        <span className="pf-timeline-fill" style={{ transform: `scaleY(${fill})` }} />
      </div>
      <ol aria-label="진행 단계" className="flex flex-col">
        {STAGE_ORDER.map((stage, i) => {
          const index = i + 1
          const state = stepState(job, index)
          // 차례 대기도 지금 머문 단계라 강조는 하되, 점은 채우지 않아 아직 시작 전임을 보인다
          const highlighted = state === 'current' || state === 'queued'
          const text = stepText(job, state)
          return (
            <li
              key={stage}
              aria-current={highlighted ? 'step' : undefined}
              data-state={state}
              className="pf-timeline-step"
            >
              <span className="pf-timeline-mark" aria-hidden="true">
                {state === 'done' ? <Icon name="Check" size={11} /> : null}
              </span>
              <span
                className={cx(
                  'flex-1 text-[15px] tracking-[-0.015em]',
                  highlighted
                    ? 'font-semibold text-ink'
                    : state === 'done'
                      ? 'text-ink-2'
                      : 'text-muted-soft',
                )}
              >
                {STAGE_LABEL[stage]}
              </span>
              {text ? (
                <span
                  className={cx(
                    'type-caption',
                    highlighted ? 'font-medium text-ink' : 'text-muted-soft',
                  )}
                >
                  {text}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * 관상 버튼(-523): 요청 전·실패면 요청하고 팝업을 연다. 진행 중·결과가 있으면 팝업을 다시 연다.
 * 3D가 끝났는데 본 적이 없으면 만들 수 없어(사진 지워짐) 아무것도 없다.
 */
function ReadingButton({
  state,
  photoReady,
  done,
  open,
}: {
  state: FaceReadingState
  photoReady: boolean
  done: boolean
  open: () => void
}) {
  const kind = state.view.kind
  if (kind === 'pending' || kind === 'done') {
    return (
      <button type="button" className="btn-ghost" onClick={open}>
        {kind === 'done' ? 'AI 관상 결과 보기' : 'AI 관상 보는 중'}
      </button>
    )
  }
  if (readingWaitsForPhoto(state, photoReady, done)) {
    // 프레임 추출 전: 버튼 글과 아래 안내 한 줄(ExitGuide)로 왜 못 누르는지 알린다(휴대폰은 말풍선이 안 보인다).
    // PC는 버튼에 마우스를 올리면 같은 문구를 말풍선으로도 보인다(-793)
    return (
      <Tooltip label={READING_WAIT_HINT}>
        {() => (
          <button
            type="button"
            className="btn-ghost"
            disabled
            aria-describedby={READING_WAIT_HINT_ID}
          >
            AI 관상 준비 중
          </button>
        )}
      </Tooltip>
    )
  }
  return (
    <FaceReadingAction
      state={state}
      photoReady={photoReady}
      jobDone={done}
      onRequested={open}
      className="btn-ghost"
    />
  )
}

/** 관상은 고른 얼굴 사진으로 보므로, 사진이 준비되는 2단계(입력 품질 확인)부터 누를 수 있다 */
function readingWaitsForPhoto(state: FaceReadingState, photoReady: boolean, done: boolean) {
  const kind = state.view.kind
  return !done && (kind === 'idle' || kind === 'notReady') && (!photoReady || kind === 'notReady')
}

export const READING_WAIT_HINT = '프레임 고르기가 끝나면 AI 관상을 볼 수 있어요'
const READING_WAIT_HINT_ID = 'pf-recon-reading-wait'

type ReadingProps = { state: FaceReadingState; photoReady: boolean; open: () => void } | null

/**
 * Figma "⑦ 나가기 안내". 끝나면 다음 할 일로 바꾼다.
 * 끝난 뒤 `작업실에서 보기`는 완성된 모델을 고른 채 모델 탭을 연다(-806, 알림 목록의 완성 알림과 같은 주소).
 * 모델 id가 없으면 작업실 첫 화면
 */
function ExitGuide({
  done,
  faceModelId,
  reading,
}: {
  done: boolean
  faceModelId: string | null
  reading: ReadingProps
}) {
  const readingButton = reading ? (
    <ReadingButton
      state={reading.state}
      photoReady={reading.photoReady}
      done={done}
      open={reading.open}
    />
  ) : null
  if (done) {
    return (
      <div className="pf-recon-actions">
        <Link href={studioHref({ faceModelId: faceModelId ?? undefined })} className="btn-primary">
          작업실에서 보기
        </Link>
        {readingButton}
      </div>
    )
  }
  return (
    // 2026-10-31: 버튼 하나(메인 버튼과 같은 크기). 다른 화면은 위 메뉴로 가면 되니 "다른 화면 둘러보기"는 뺐다
    <div className="flex flex-col gap-(--space-16)">
      <p className="text-[14.5px] leading-[1.6] break-keep text-ink-2">
        기다리지 않아도 돼요. 3D는 계속 만들어지고, 완성되면 알림으로 알려 드릴게요.
      </p>
      <div className="pf-recon-actions">
        <Link href="/studio" className="btn-primary">
          내 작업실로
        </Link>
        {readingButton}
      </div>
      {/* 프레임 고르기 중: 관상 버튼을 왜 못 누르는지 알리는 한 줄(-793). 터치 기기에만 보인다(마우스 올리기가 없다).
          PC(마우스)는 버튼 말풍선으로 같은 문구를 본다. 숨겨도 aria-describedby로 버튼 설명이 된다 */}
      {reading && readingWaitsForPhoto(reading.state, reading.photoReady, done) ? (
        <p
          id={READING_WAIT_HINT_ID}
          className="type-caption -mt-(--space-8) hidden text-muted-soft pointer-coarse:block"
        >
          {READING_WAIT_HINT}
        </p>
      ) : null}
      <MattermostHint />
    </div>
  )
}

export const MM_SIGNUP = 'MM 알림 받기'

/**
 * Mattermost 완료 알림(S15P31B204-476)을 아직 등록하지 않았으면 이 자리에서 바로 등록한다(S15P31B204-524).
 * 기다리는 지금이 알림이 필요한 순간이다. 내 정보로 보내지 않고, 내 정보와 같은 등록 칸(`MattermostNotify`)을 펼친다.
 *
 * - 보여 줄지는 내 정보와 같은 기준(`useMattermostNotifyAvailable`)이다. 운영에서도 별도 동의로 연다(-543).
 * - 내 정보를 아직 못 받았으면(null) 띄우지 않는다. 비회원·업로드 전용 세션(QR로 연결한 휴대폰)은 `me`가 없어
 *   등록할 수 없다. 그 휴대폰은 이 화면 대신 업로드 완료 화면에 머물고, 이 칸은 PC 대기 화면에 보인다.
 * - 등록하면 `me`를 고쳐 이 줄이 사라진다(완료 토스트는 등록 칸이 띄운다).
 */
function MattermostHint() {
  const me = useAuthStore((s) => s.me)
  const available = useMattermostNotifyAvailable()
  const [open, setOpen] = useState(false)
  if (!available || !me || me.mattermostUsername) return null
  return (
    <div className="pf-recon-mm-box">
      {/* 머리카락 선 위 한 줄: 무엇을 받는지 + 여기서 바로 켜기 */}
      <p className="pf-recon-mm">
        <span>완성되면 SSAFY Mattermost로도 알려 드려요.</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="pf-recon-mm-form"
          onClick={() => setOpen((v) => !v)}
        >
          {MM_SIGNUP}
          <Icon name="CaretRight" size={13} aria-hidden />
        </button>
      </p>
      {open ? (
        <div id="pf-recon-mm-form">
          <MattermostNotify
            username={null}
            heading={false}
            onChange={(mattermostUsername) =>
              useAuthStore.getState().setMe({ ...me, mattermostUsername })
            }
          />
        </div>
      ) : null}
    </div>
  )
}

function JobMissing({ error }: { error: Error }) {
  // 타인 작업도 404로 온다(존재 여부를 숨긴다). 화면도 "없음"으로 다룬다
  const notFound = error instanceof ApiError && error.isNotFound
  return (
    <div className="mx-auto flex w-full max-w-page flex-col items-start gap-(--space-12) px-(--space-20) py-(--space-40) md:px-30">
      <h1 className="type-headline text-ink">
        {notFound ? '작업을 찾을 수 없어요' : '상태를 불러오지 못했어요'}
      </h1>
      <p className="type-lead text-ink-2">
        {notFound ? '주소를 다시 확인해 주세요.' : '잠시 후 자동으로 다시 시도해요.'}
      </p>
      <Button variant="secondary" href="/studio" trailingIcon={null}>
        내 작업실로
      </Button>
    </div>
  )
}
