'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MEDIAPIPE_ASSETS } from '@/features/live-capture/faceTracker'
import { toolButton } from '@/features/viewer/toolButton'
import { cx, Tooltip } from '@/shared/ui'
import { expressionBus } from './bus'
import { loadExpressionRig, type ExpressionRig } from './rig'
import { createExpressionSolver, type Score, type TrackedPoint } from './tracker'

interface Landmarker {
  detectForVideo(
    video: HTMLVideoElement,
    time: number,
  ): { faceLandmarks?: TrackedPoint[][]; faceBlendshapes?: { categories: Score[] }[] }
  close(): void
}

async function createLandmarker(): Promise<Landmarker> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_ASSETS.wasmBase)
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.faceModel, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
  })
  try {
    return await FaceLandmarker.createFromOptions(fileset, options('GPU'))
  } catch {
    return FaceLandmarker.createFromOptions(fileset, options('CPU'))
  }
}

export interface ExpressionTrackingState {
  /** 이 모델에 표정 리그 주소가 있나(없으면 버튼·미리보기를 그리지 않는다) */
  available: boolean
  /** 받아 둔 표정 리그(처음 켤 때 받는다). 3D 뷰어가 이 리그로 표정을 얹는다 */
  rig: ExpressionRig | null
  running: boolean
  status: string
  /** 미리보기 영상 요소를 받는다(요소의 ref 콜백) */
  video: (element: HTMLVideoElement | null) => void
  toggle: () => void
  /** 지금 얼굴을 무표정 기준으로 다시 잡는다 */
  recalibrate: () => void
}

/**
 * 표정 트래킹 한 세션: 웹캠 → 얼굴 점·표정 점수(MediaPipe) → 표정 프레임 → `expressionBus`로 3D 장면에 넘긴다.
 *
 * 영상은 이 브라우저 안에서만 처리하고 저장·전송하지 않는다. 표정 리그(약 13 MB)는 편집실을 열 때가 아니라 처음 켤 때 받는다:
 * 쓰지 않는 사람은 받지 않는다.
 */
export function useExpressionTracking(rigUrl: string | null): ExpressionTrackingState {
  const [rig, setRig] = useState<ExpressionRig | null>(null)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const videoElement = useRef<HTMLVideoElement | null>(null)
  const video = useCallback((element: HTMLVideoElement | null) => {
    videoElement.current = element
  }, [])
  const session = useRef<{ stop: () => void; recalibrate: () => void } | null>(null)
  // 리그를 받는 중. 그사이 끄거나 모델이 바뀌면 받기를 멈춘다(13 MB를 끝까지 받지 않는다)
  const download = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    download.current?.abort()
    download.current = null
    session.current?.stop()
    session.current = null
    setRunning(false)
    setStatus('')
  }, [])
  // 다른 모델로 바뀌면 받아 둔 리그를 버리고 세션을 끝낸다(옛 리그로 풀고 있으므로). 화면을 떠날 때도 끝낸다
  useEffect(
    () => () => {
      stop()
      setRig(null)
    },
    [rigUrl, stop],
  )

  async function turnOn() {
    if (!rigUrl) return
    setRunning(true)
    let current = rig
    if (!current) {
      const controller = new AbortController()
      download.current = controller
      setStatus('표정 데이터를 받는 중…')
      try {
        // null = 받았지만 형식이 맞지 않는 리그
        current = await loadExpressionRig(rigUrl, controller.signal)
      } catch {
        current = null
      }
      if (controller.signal.aborted) return
      download.current = null
      if (!current) {
        setRunning(false)
        setStatus('표정 데이터를 받지 못했어요. 잠시 뒤 다시 눌러 주세요')
        return
      }
      setRig(current)
    }
    void start(current)
  }

  async function start(rig: ExpressionRig) {
    const element = videoElement.current
    if (!element || session.current) return
    setStatus('얼굴 인식 모델을 불러오는 중…')
    let stream: MediaStream | null = null
    let landmarker: Landmarker | null = null
    let frameId = 0
    let stopped = false
    const solver = createExpressionSolver(rig)
    const end = () => {
      stopped = true
      cancelAnimationFrame(frameId)
      stream?.getTracks().forEach((track) => track.stop())
      element.srcObject = null
      landmarker?.close()
      expressionBus.emit(null)
    }
    session.current = { stop: end, recalibrate: () => solver.reset() }
    try {
      landmarker = await createLandmarker()
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      if (stopped) return end()
      element.srcObject = stream
      await element.play()
      let last = -1
      let shown = 0
      const loop = () => {
        if (stopped || !landmarker) return
        if (element.readyState >= 2 && element.currentTime !== last) {
          last = element.currentTime
          const now = performance.now()
          const result = landmarker.detectForVideo(element, now)
          const points = result.faceLandmarks?.[0]
          if (points) {
            const frame = solver.step(
              points,
              element.videoWidth,
              element.videoHeight,
              result.faceBlendshapes?.[0]?.categories ?? null,
              now / 1000,
            )
            if (frame) expressionBus.emit(frame)
            if (++shown % 15 === 0)
              setStatus(
                frame
                  ? `트래킹 중 · 고개 ${frame.poseDeg.toFixed(0)}° (표정 ${Math.round(frame.poseGain * 100)}%)`
                  : '무표정 기준을 잡는 중… 정면을 보고 가만히 있어 주세요',
              )
          }
        }
        frameId = requestAnimationFrame(loop)
      }
      loop()
    } catch (error) {
      // 이미 끈 뒤에 난 오류(재생이 중단됨 등)는 알리지 않는다
      if (stopped) return
      end()
      session.current = null
      setRunning(false)
      setStatus(
        error instanceof Error ? `시작하지 못했어요: ${error.message}` : '시작하지 못했어요',
      )
    }
  }

  return {
    available: !!rigUrl,
    rig,
    running,
    status,
    video,
    toggle: () => (running ? stop() : void turnOn()),
    recalibrate: () => session.current?.recalibrate(),
  }
}

/**
 * 3D 무대 왼쪽 위의 표정 트래킹. 꺼져 있으면 아이콘 버튼, 켜면 그 자리를 거울처럼 뒤집은 웹캠 미리보기가 대신한다
 * (모델도 거울처럼 움직인다). 미리보기 위에 `무표정 다시`와 끄기(X), 아래에 상태 문구.
 * - X는 마우스를 올렸을 때만 보인다. 마우스를 올릴 수 없는 터치 화면에서는 늘 보이고, 키보드로 가면 보인다.
 * - 영상 요소는 꺼져 있어도 남겨 둔다(켤 때 바로 쓴다). 시작하지 못했다는 문구는 꺼진 뒤에도 보인다.
 * - 켜고 끌 때 키보드 포커스가 사라진 버튼에 남지 않게 X ↔ 아이콘으로 옮긴다.
 */
export function ExpressionTracking({
  tracking: { available, running, status, video, toggle, recalibrate },
}: {
  tracking: ExpressionTrackingState
}) {
  const icon = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef(false)
  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    ;(running ? close : icon).current?.focus()
  }, [running])
  const switchTracking = (event: { currentTarget: HTMLElement }) => {
    moveFocus.current = document.activeElement === event.currentTarget
    toggle()
  }

  if (!available) return null
  return (
    <div className="flex flex-col items-start gap-(--space-8)">
      {running ? null : (
        <Tooltip label="표정 트래킹">
          {(describedBy) => (
            <button
              ref={icon}
              type="button"
              aria-label="표정 트래킹"
              aria-describedby={describedBy}
              onClick={switchTracking}
              className={toolButton({ onStage: true })}
            >
              <FaceTrackIcon />
            </button>
          )}
        </Tooltip>
      )}
      <div
        hidden={!running}
        className="group relative w-[120px] overflow-hidden rounded-(--radius-12) bg-ink motion-safe:animate-[pf-rise_220ms_var(--pf-ease-out)_both] motion-reduce:animate-[pf-fade_var(--pf-dur-ui)_var(--pf-ease-out)_both] md:w-[160px]"
      >
        <video
          ref={video}
          playsInline
          muted
          className="block aspect-[4/3] w-full -scale-x-100 object-cover"
        />
        <div className="pointer-events-none absolute inset-0 rounded-(--radius-12) outline-1 -outline-offset-1 outline-black/10" />
        <button
          ref={close}
          type="button"
          aria-label="표정 트래킹 끄기"
          onClick={switchTracking}
          className={cx(
            OVERLAY_BUTTON,
            'absolute top-(--space-6) right-(--space-6) size-7 justify-center transition-[background-color,opacity] focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
          )}
        >
          <CloseIcon />
        </button>
        <button
          type="button"
          onClick={recalibrate}
          className={cx(
            OVERLAY_BUTTON,
            'absolute bottom-(--space-6) left-(--space-6) h-7 px-(--space-10) text-[12px] font-medium',
          )}
        >
          무표정 다시
        </button>
      </div>
      {status ? (
        <p
          aria-live="polite"
          className="type-caption max-w-[120px] text-muted-soft md:max-w-[160px]"
        >
          {status}
        </p>
      ) : null}
    </div>
  )
}

/** 미리보기 위에 얹는 작은 반투명 버튼 */
const OVERLAY_BUTTON =
  'inline-flex items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-[background-color] duration-(--pf-dur-ui) ease-(--pf-ease-out) hover:bg-black/55'

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l7 7M10.5 3.5l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 얼굴을 읽는 모양: 네 모서리 틀 안의 얼굴(두 눈, 웃는 입) */
function FaceTrackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 7V5a2 2 0 0 1 2-2h2M13 3h2a2 2 0 0 1 2 2v2M17 13v2a2 2 0 0 1-2 2h-2M7 17H5a2 2 0 0 1-2-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="7.75" cy="8.5" r="1" fill="currentColor" />
      <circle cx="12.25" cy="8.5" r="1" fill="currentColor" />
      <path
        d="M7.25 12a3.25 3.25 0 0 0 5.5 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
