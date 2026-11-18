'use client'

import type { CaptureTrace } from '@/features/live-capture/captureTrace'
import { useEffect, useRef, useState } from 'react'
import { formatClock, resolveContentType } from '@/features/upload/policy'
import type { UploadPolicy } from '@/features/upload/types'
import { FAILURE_COPY, type UploadFailure } from '@/features/upload/uploadVideo'
import { isUploading, useVideoUpload, type UploadState } from '@/features/upload/useVideoUpload'
import { issueMessage, validateVideo } from '@/features/upload/validateVideo'
import { PRIVATE_MEDIA } from '@/shared/analytics'
import { Button, cx, Icon } from '@/shared/ui'
import { CheckList } from './CheckList'
import { InfoNote } from './InfoNote'

/** 새 촬영 순서(왼쪽 → 정면 → 오른쪽 → 위 → 아래, 2026-10-31)와 준비(이마·귀)에 맞춘 확인 세 줄 */
const CHECKS = [
  '이마와 귀까지 얼굴이 잘 보이나요',
  '오른쪽부터 왼쪽, 위·아래까지 다 담았나요',
  '끊기거나 흔들리지 않았나요',
]

/**
 * SCR-07 영상 확인·업로드 · 업로드 전용 세션 ③ / Mobile (Figma 286:2480).
 *
 * 웹 녹화 결과를 미리 보고, 정책(길이·크기·형식)을 먼저 검사한 뒤 그대로 올린다.
 * 압축·변환하지 않는다(FN-CAP-02). 기종·촬영 기록은 업로드 요청에 함께 보낸다(S15P31B204-619).
 *
 * 영상이 바뀌면 부모가 key를 바꿔 새로 그린다. 그래서 길이·업로드 상태를 따로 초기화하지 않는다.
 */
export function VideoReview({
  file,
  policy,
  onRetake,
  onUploaded,
  onSessionEnded,
  deviceModel,
  captureTrace,
}: {
  file: File
  policy: UploadPolicy
  /** 다시 녹화한다 */
  onRetake: () => void
  onUploaded: (jobId: string) => void
  onSessionEnded: () => void
  /** 기종. 모르면 null */
  deviceModel?: string | null
  /** 웹 녹화 촬영 기록(-641) */
  captureTrace?: CaptureTrace | null
}) {
  /** undefined = 아직 읽는 중, null = 읽지 못함 */
  const [durationMs, setDurationMs] = useState<number | null | undefined>(undefined)
  const upload = useVideoUpload(policy)
  const { state } = upload

  const contentType = resolveContentType(file)
  const issues =
    durationMs === undefined
      ? []
      : validateVideo({ contentType, sizeBytes: file.size, durationMs }, policy)
  // 웹 녹화가 반대쪽 끝에 닿기 전에 멈췄다(수동·70초). 옆모습이 빠져 3D가 틀리므로 올리지 않고 다시 찍게 한다(S0-2).
  // 서버도 회전 부족을 QUALITY_ANGLE로 막지만 업로드·추출을 기다린 뒤라, 촬영 자리에서 먼저 알린다. 예전 기록(값 없음)은 막지 않는다
  const oneSide = captureTrace?.meta.bothSides === false
  const canUpload =
    durationMs !== undefined && issues.length === 0 && contentType !== null && !oneSide
  const busy = isUploading(state)
  // 마무리(REC-01)는 요청이 나가면 서버에 3D 작업이 생겨 멈출 수 없다. 취소하면 화면만 돌아가고 다시 올릴 때 REC_002가 난다
  const cancellable = busy && state.status !== 'finalizing'

  useEffect(() => {
    if (state.status === 'done') onUploaded(state.result.job.jobId)
    if (state.status === 'failed' && state.failure.kind === 'session-ended') onSessionEnded()
  }, [state, onUploaded, onSessionEnded])

  // 올리는 중에 창을 닫으려 하면 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const startUpload = () => {
    if (!canUpload || !contentType || typeof durationMs !== 'number') return
    void upload.start({ file, contentType, durationMs, deviceModel, captureTrace })
  }

  return (
    <>
      <h1 className="text-[24px] leading-[1.3] font-[650] tracking-[-0.03em] break-keep text-text-ink">
        영상을 확인해 주세요
      </h1>

      <VideoPreview
        file={file}
        durationMs={durationMs ?? null}
        onDuration={setDurationMs}
        className="mt-(--space-14)"
      />

      <CheckList className="mt-(--space-20)" items={CHECKS} label="올리기 전에 확인해요" />
      <InfoNote className="mt-(--space-16)">
        촬영한 원본 파일 그대로 올라가요. 3D를 만든 뒤 바로 삭제돼요.
      </InfoNote>

      {oneSide ? (
        <Problem
          title="반대쪽 끝까지 돌리지 못했어요"
          lines={[
            '옆모습이 빠지면 3D가 정확하지 않아요. 안내에 맞춰 양쪽 끝까지 천천히 다시 찍어 주세요.',
          ]}
        />
      ) : null}
      {issues.length > 0 ? (
        <Problem title="이 영상은 올릴 수 없어요" lines={issues.map(issueMessage)} />
      ) : null}
      {state.status === 'failed' && state.failure.kind !== 'session-ended' ? (
        <FailureMessage failure={state.failure} />
      ) : null}

      <div className="min-h-(--space-24) flex-1" />

      <div className="flex w-full flex-col gap-(--space-8)">
        {busy ? (
          <>
            <UploadProgress state={state} />
            {cancellable ? (
              <Button
                variant="secondary"
                trailingIcon={null}
                className="w-full"
                onClick={upload.cancel}
              >
                취소
              </Button>
            ) : null}
          </>
        ) : (
          <>
            {state.status === 'failed' ? (
              state.failure.retryable ? (
                <Button variant="ink" className="w-full" onClick={() => void upload.retry()}>
                  다시 올리기
                </Button>
              ) : null
            ) : (
              <Button
                variant="ink"
                className="w-full"
                onClick={startUpload}
                disabled={!canUpload || state.status === 'done'}
              >
                이 영상 올리기
              </Button>
            )}
            <Button
              variant="secondary"
              trailingIcon={null}
              className="w-full"
              onClick={onRetake}
              disabled={state.status === 'done'}
            >
              다시 찍기
            </Button>
          </>
        )}
      </div>
    </>
  )
}

function VideoPreview({
  file,
  durationMs,
  onDuration,
  className,
}: {
  file: File
  durationMs: number | null
  onDuration: (ms: number | null) => void
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const probingRef = useRef(false)
  const [playing, setPlaying] = useState(false)

  // 미리보기 주소는 effect에서 만들고 지운다(렌더 중에 만들면 StrictMode에서 새고, 지운 주소를 쓴다)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const url = URL.createObjectURL(file)
    video.src = url
    return () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }

  return (
    <div
      className={cx(
        'relative h-65 w-full overflow-hidden rounded-[16px] bg-neutral-charcoal',
        className,
      )}
    >
      <video
        {...PRIVATE_MEDIA}
        ref={videoRef}
        className="size-full object-contain"
        playsInline
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          const ms = toDurationMs(video.duration)
          if (ms !== null) {
            onDuration(ms)
          } else if (video.duration === Number.POSITIVE_INFINITY) {
            // 길이가 헤더에 없는 webm 등. 끝으로 이동시키면 브라우저가 길이를 계산한다
            probingRef.current = true
            video.currentTime = Number.MAX_SAFE_INTEGER
          } else {
            onDuration(null)
          }
        }}
        onDurationChange={(event) => {
          if (!probingRef.current) return
          const video = event.currentTarget
          const ms = toDurationMs(video.duration)
          if (ms === null) return
          probingRef.current = false
          video.currentTime = 0
          onDuration(ms)
        }}
        onError={() => onDuration(null)}
        aria-label="촬영한 영상 미리보기"
      />
      {playing ? null : (
        <button
          type="button"
          onClick={toggle}
          aria-label="영상 재생"
          className="absolute top-1/2 left-1/2 flex size-13 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-bg-surface text-text-ink"
        >
          <Icon name="Play" size={20} />
        </button>
      )}
      {durationMs !== null ? (
        <span className="absolute right-(--space-20) bottom-(--space-10) rounded-4 bg-neutral-charcoal px-(--space-8) py-(--space-4) type-kr-caption-11-medium-lh14p3 text-text-on-dark">
          {formatClock(durationMs)}
        </span>
      ) : null}
    </div>
  )
}

function toDurationMs(seconds: number): number | null {
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null
}

const PHASE_LABEL = {
  hashing: '영상을 확인하는 중이에요',
  requesting: '올릴 준비를 하는 중이에요',
  uploading: '영상을 올리는 중이에요',
  finalizing: '거의 다 됐어요',
} as const

function UploadProgress({ state }: { state: UploadState }) {
  if (!isUploading(state) || !('progress' in state)) return null
  const status = state.status as keyof typeof PHASE_LABEL
  const percent = status === 'uploading' ? Math.round(state.progress * 100) : null

  return (
    <div className="flex w-full flex-col gap-(--space-8)" aria-live="polite">
      <p className="flex justify-between type-kr-body-13-medium-lh16p9 text-text-ink">
        <span>{PHASE_LABEL[status]}</span>
        {percent !== null ? <span>{percent}%</span> : null}
      </p>
      <div
        role="progressbar"
        aria-label="업로드 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 w-full overflow-hidden rounded-full bg-line-default"
      >
        <div
          className="h-full rounded-full bg-brand-violet transition-[width]"
          // 진행률은 계속 바뀌는 값이라 인라인으로 준다(apps/web/AGENTS.md "스타일")
          style={{ width: `${percent ?? (status === 'finalizing' ? 100 : 0)}%` }}
        />
      </div>
    </div>
  )
}

function FailureMessage({ failure }: { failure: UploadFailure }) {
  const copy = FAILURE_COPY[failure.kind]
  const lines =
    failure.kind === 'invalid' && failure.issues.length > 0
      ? failure.issues.map(issueMessage)
      : [copy.body]
  return <Problem title={copy.title} lines={lines} />
}

function Problem({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div
      role="alert"
      className="mt-(--space-12) w-full rounded-[16px] border border-status-danger px-(--space-14) py-(--space-12)"
    >
      <p className="type-kr-body-13-medium-lh16p9 text-status-danger">{title}</p>
      {lines.map((line) => (
        <p key={line} className="mt-(--space-4) type-kr-body-12-regular-lh15p6 text-text-body">
          {line}
        </p>
      ))}
    </div>
  )
}
