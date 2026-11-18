'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PRIVATE_MEDIA } from '@/shared/analytics'
import { Button, cx } from '@/shared/ui'
import { CaptureBangsConfirm, CaptureCheckDone, CaptureChecks } from './CaptureChecks'
import { CaptureStartSheet } from './CaptureStartSheet'
import {
  CaptureTraceRecorder,
  trackSettings,
  isAppleMotion,
  verticalRate,
  type CaptureTrace,
} from './captureTrace'
import { createFaceTracker, type FaceTracker } from './faceTracker'
import {
  GUIDE,
  GUIDE_STEPS,
  GuideEngine,
  type GuideFrame,
  type PhoneTilt,
  type StopReason,
} from './guideEngine'
import {
  isLiveCaptureSupported,
  openFrontCamera,
  pickMimeType,
  startRecording,
  stopStream,
  type Recording,
} from './recorder'
import { createMotionProbe } from './motionProbe'
import { createVoicePlayer, type VoicePlayer } from './voicePlayer'
import { readVoiceOn, writeVoiceOn } from './voicePref'
import './live-capture.css'

/** 안내 머리 그림(블렌더 평균 머리 렌더, public/guide/capture) */
const HEAD_GUIDE_BASE = '/guide/capture'
/** 안내 머리 아래 한 줄. 좌우로 옮기는 동안(fixed)은 그림 없이 이 글자만 보인다 */
const HEAD_GUIDE_CAPTION = {
  front: '정면을 봐요',
  fixed: '얼굴은 정면 고정',
  up: '고개를 들어요',
  down: '고개를 숙여요',
} as const

export const LIVE_CAPTURE_COPY = {
  unsupported: '이 브라우저에서는 촬영할 수 없어요. 최신 Safari나 Chrome으로 열어 주세요',
  cameraDenied:
    '카메라를 열지 못했어요. 브라우저 설정에서 카메라 권한을 허용한 뒤 다시 시도해 주세요.',
  preparing: '카메라와 얼굴 추적을 준비하는 중이에요…',
  finishing: '촬영이 끝났어요. 영상을 마무리하는 중이에요…',
} as const

export interface LiveCaptureMeta {
  /** 녹화 시작부터 멈출 때까지(ms) */
  durationMs: number
  stopReason: StopReason | 'manual'
  /** 마친 단계 수 / 전체 */
  stepsDone: number
  stepsTotal: number
  mimeType: string
  /** 양쪽 끝을 다 담았다(GuideEngine.bothSides). 아니면 확인 화면이 다시 찍게 한다(S0-2) */
  bothSides: boolean
}

type ViewState = 'intro' | 'preparing' | 'running' | 'finishing' | 'unsupported' | 'camera-denied'

/**
 * 웹 실시간 촬영 화면(S15P31B204-619, docs/design/live-capture-guide.md).
 * 전면 카메라를 띄워 얼굴 추적으로 정렬 → 3-2-1 → 팔 돌리기 7단계를 화면·음성으로 안내하며 녹화한다.
 * 판단은 `guideEngine`, 이 컴포넌트는 카메라·센서·추적 반복·그리기만 한다.
 *
 * - 미리보기만 거울(CSS). 녹화는 카메라 스트림 그대로라 반전되지 않는다.
 * - 얼굴이 나오는 요소는 `PRIVATE_MEDIA`로 가린다(`/m/` 경로는 원래 Clarity를 불러오지 않는다).
 * - 화면을 떠나면 카메라·추적·녹화·소리를 모두 끈다.
 * - `?debug=1`이면 추적 횟수·자세 값을 작게 보여 준다(시험용).
 */
export function LiveCapture({
  onRecorded,
  onCancel,
  soundChecked,
  onSoundCheckedChange,
}: {
  /** trace: 웹 녹화 촬영 기록(-641). 만들지 못하면 null */
  onRecorded: (file: File, meta: LiveCaptureMeta, trace: CaptureTrace | null) => void
  /** 녹화 전 돌아가기 */
  onCancel?: () => void
  /** 앞서 "잘 들려요"를 체크했다. 이 화면을 나갔다 들어와도 체크를 남긴다(-882) */
  soundChecked?: boolean
  onSoundCheckedChange?: (checked: boolean) => void
}) {
  const [view, setView] = useState<ViewState>(() =>
    isLiveCaptureSupported() ? 'intro' : 'unsupported',
  )
  const [frame, setFrame] = useState<GuideFrame | null>(null)
  const [ovals, setOvals] = useState<{ mid: number; min: number; max: number } | null>(null)
  // 음성 안내 켜짐(-765). 이 휴대폰에 기억한 값으로 시작한다
  const [voiceOn, setVoiceOn] = useState(readVoiceOn)
  const voiceOnRef = useRef(voiceOn)
  // 클라이언트에서만 그려지는 화면이라(촬영 단계) 처음 그릴 때 주소를 읽어도 된다
  const [debug, setDebug] = useState<string | null>(() =>
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === '1'
      ? ''
      : null,
  )

  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const voiceRef = useRef<VoicePlayer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackerRef = useRef<FaceTracker | null>(null)
  const engineRef = useRef<GuideEngine | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const recStartRef = useRef(0)
  // 촬영 기록(-641): 녹화 중 머리 각도 표본과 단계 구간
  const traceRef = useRef<CaptureTraceRecorder | null>(null)
  const traceStepRef = useRef(-1)
  const mimeRef = useRef('')
  const rafRef = useRef(0)
  const tiltRef = useRef<PhoneTilt>({ beta: null, fb: null, side: null })
  // 자이로 원인 확인용(-733): 세 축 원 값을 쌓아 디버그 화면에만 보인다
  const probeRef = useRef(createMotionProbe())
  // 고개 따라 돎 경고용(-765): 휴대폰 세로축 회전을 화면에 있는 동안 계속 쌓는다(도). 센서 값이 없으면 null
  const phoneYawRef = useRef<{ deg: number | null; last: number | null }>({ deg: null, last: null })
  const aliveRef = useRef(true)
  const onRecordedRef = useRef(onRecorded)
  useEffect(() => {
    onRecordedRef.current = onRecorded
  }, [onRecorded])

  // 소리 재생기와 기울기 센서. 화면에 있는 동안만
  useEffect(() => {
    aliveRef.current = true
    voiceRef.current = createVoicePlayer()
    voiceRef.current.setMuted(!voiceOnRef.current)
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta != null) tiltRef.current = { ...tiltRef.current, beta: event.beta }
    }
    // 휴대폰을 얼굴 주위로 돌리는 것(세상 세로축 회전)은 중력 방향을 바꾸지 않는다. 그래서 중력 벡터로 기울기를 잰다.
    // fb: 앞뒤로 눕힘/숙임, side: 옆으로 기울임(도). 기종마다 부호가 달라도 시작 때 값과의 차이만 쓴다
    // 아이폰은 중력값 부호가 안드로이드와 반대다(-733)
    const apple = isAppleMotion(navigator)
    const onMotion = (event: DeviceMotionEvent) => {
      const g = event.accelerationIncludingGravity
      // 녹화 중이면 세로축 회전(자이로)을 기록에 쌓는다(S15P31B204-677, 기록만)
      const motionNow = performance.now()
      const rate = verticalRate(event.rotationRate, g, apple)
      traceRef.current?.motion(motionNow, rate)
      if (rate != null) {
        const yaw = phoneYawRef.current
        const dt = yaw.last === null ? 0 : motionNow - yaw.last
        // 기록과 같은 규칙: 200ms 넘는 공백(탭 전환 등)은 쌓지 않는다
        yaw.deg = (yaw.deg ?? 0) + (dt > 0 && dt <= 200 ? (rate * dt) / 1000 : 0)
        yaw.last = motionNow
      }
      probeRef.current.add(performance.now(), event.rotationRate, g, event.interval, apple)
      if (!g || g.x == null || g.y == null || g.z == null) return
      const deg = (r: number) => (r * 180) / Math.PI
      const fb = deg(Math.atan2(g.z, Math.hypot(g.x, g.y)))
      const side = deg(Math.atan2(g.x, Math.abs(g.y) || 1e-6))
      const prev = tiltRef.current
      tiltRef.current = {
        beta: prev.beta,
        fb: prev.fb == null ? fb : prev.fb * 0.7 + fb * 0.3,
        side: prev.side == null ? side : prev.side * 0.7 + side * 0.3,
      }
    }
    window.addEventListener('deviceorientation', onOrientation)
    window.addEventListener('devicemotion', onMotion)
    return () => {
      aliveRef.current = false
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('devicemotion', onMotion)
      cancelAnimationFrame(rafRef.current)
      recordingRef.current?.discard()
      recordingRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
      trackerRef.current?.close()
      trackerRef.current = null
      engineRef.current = null
      voiceRef.current?.dispose()
      voiceRef.current = null
    }
  }, [])

  // 목표 얼굴 크기(영상 높이 대비)를 화면 픽셀로 바꿔 타원을 그린다.
  // 영상은 object-fit: cover로 잘려 보이므로 그 배율(가로·세로 중 큰 쪽)을 쓴다
  const placeOvals = useCallback(() => {
    const video = videoRef.current
    const stage = stageRef.current
    if (!video || !stage || !video.videoWidth || !video.videoHeight) return
    const scale = Math.max(
      stage.clientWidth / video.videoWidth,
      stage.clientHeight / video.videoHeight,
    )
    const px = (ratio: number) => ratio * video.videoHeight * scale
    setOvals({
      mid: px((GUIDE.faceMin + GUIDE.faceMax) / 2),
      min: px(GUIDE.faceMin),
      max: px(GUIDE.faceMax),
    })
  }, [])
  useEffect(() => {
    window.addEventListener('resize', placeOvals)
    return () => window.removeEventListener('resize', placeOvals)
  }, [placeOvals])

  const finish = useCallback(async (reason: StopReason | 'manual') => {
    const recording = recordingRef.current
    const engine = engineRef.current
    if (!recording || !engine) return
    recordingRef.current = null
    cancelAnimationFrame(rafRef.current)
    engine.stop()
    setView('finishing')
    const durationMs = Math.round(performance.now() - recStartRef.current)
    try {
      const file = await recording.stop()
      if (!aliveRef.current) return
      voiceRef.current?.say('done', { force: true })
      const meta: LiveCaptureMeta = {
        durationMs,
        stopReason: reason,
        stepsDone: Math.min(engine.stepIndex, GUIDE_STEPS.length),
        stepsTotal: GUIDE_STEPS.length,
        mimeType: file.type,
        bothSides: engine.bothSides,
      }
      const trace = traceRef.current?.build(meta, trackSettings(streamRef.current)) ?? null
      traceRef.current = null
      onRecordedRef.current(file, meta, trace)
    } catch {
      // 녹화를 마무리하지 못하면 안내 화면으로 바꾸기 전에 카메라·추적을 끈다(카메라 불이 켜진 채 남지 않게)
      stopStream(streamRef.current)
      streamRef.current = null
      trackerRef.current?.close()
      trackerRef.current = null
      traceRef.current = null
      if (aliveRef.current) setView('unsupported')
    }
  }, [])

  // 카메라 프레임마다 추적한다. 최대 초당 maxHz, 한 번 걸린 시간의 1.5배는 쉬고 다음 추적(화면 그릴 틈을 남긴다)
  const loop = useCallback(() => {
    let nextDetect = 0
    let lastCost = 0
    let perfCount = 0
    let perfStart = 0
    let perfText = ''
    const tickOnce = () => {
      if (!aliveRef.current) return
      rafRef.current = requestAnimationFrame(tickOnce)
      const video = videoRef.current
      const tracker = trackerRef.current
      const engine = engineRef.current
      if (!video || !tracker || !engine || video.readyState < 2) return
      const now = performance.now()
      if (now < nextDetect) return
      nextDetect = now + Math.max(1000 / GUIDE.maxHz, lastCost * GUIDE.costRest)

      const t0 = performance.now()
      const face = tracker.detect(video, now)
      lastCost = performance.now() - t0
      const bangs =
        face && engine.wantsBangs(now, face)
          ? tracker.measureBangs(video, now, face.landmarks)
          : undefined
      const next = engine.tick({
        now,
        pose: face,
        tilt: tiltRef.current,
        bangs,
        bangsUnavailable: tracker.segmenterFailed,
        phoneYaw: phoneYawRef.current.deg,
      })
      if (next.startRecording && streamRef.current) {
        recordingRef.current = startRecording(streamRef.current, mimeRef.current)
        recStartRef.current = now
        traceRef.current = new CaptureTraceRecorder(now)
        traceStepRef.current = -1
      }
      const trace = recordingRef.current ? traceRef.current : null
      if (trace) {
        if (next.stepIndex !== traceStepRef.current && next.stepIndex < GUIDE_STEPS.length) {
          trace.step(GUIDE_STEPS[next.stepIndex]!.key, now)
          traceStepRef.current = next.stepIndex
        }
        trace.sample(now, face ? face.traceAngles : null)
      }
      setFrame(next)
      if (next.stop) void finish(next.stop)

      perfCount++
      if (now - perfStart > 1000) {
        perfText = `추적 ${perfCount}/s · ${lastCost.toFixed(0)}ms`
        perfCount = 0
        perfStart = now
      }
      setDebug((current) =>
        current === null
          ? null
          : `${perfText}\n${
              face
                ? `yaw ${face.yaw.toFixed(0)}° pitch ${face.pitch.toFixed(0)}° 크기 ${(face.size * 100).toFixed(0)}% 중심 ${(face.cy * 100).toFixed(0)}% 눈감음 ${face.blink.toFixed(2)}`
                : '얼굴 없음'
            }\n기울기 beta ${tiltRef.current.beta?.toFixed(0) ?? '-'} fb ${tiltRef.current.fb?.toFixed(0) ?? '-'} side ${tiltRef.current.side?.toFixed(0) ?? '-'} · ${mimeRef.current || '기본 형식'}\n영상 ${video.videoWidth}x${video.videoHeight} · ${tracker.maskDebug || '마스크 없음'}
${probeRef.current.text()}
단계 ${next.phase} · 안내 머리 ${next.headGuide ?? '없음'} · 휴대폰 회전 ${phoneYawRef.current.deg?.toFixed(0) ?? '-'}° · 움직임 줄이기 ${window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? '켜짐' : '꺼짐'}${
              engine.endDebug
                ? `
${engine.endDebug}`
                : ''
            }`,
      )
    }
    rafRef.current = requestAnimationFrame(tickOnce)
  }, [finish])

  /** 음성 안내 끄기·켜기. 켤 때는 이 클릭 안에서 소리 잠금을 푼다(아이폰은 누른 순간에만 허락한다) */
  const changeVoice = (on: boolean) => {
    voiceOnRef.current = on
    setVoiceOn(on)
    writeVoiceOn(on)
    voiceRef.current?.setMuted(!on)
    if (on) void voiceRef.current?.unlock()
  }

  const soundCheck = async () => {
    const voice = voiceRef.current
    if (!voice) return
    await voice.unlock()
    voice.say('soundcheck', { force: true })
  }

  const start = async () => {
    setView('preparing')
    await askSensorPermission()
    await voiceRef.current?.unlock()
    let stream: MediaStream
    try {
      stream = await openFrontCamera()
    } catch {
      if (aliveRef.current) setView('camera-denied')
      return
    }
    if (!aliveRef.current) {
      stopStream(stream)
      return
    }
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // 자동 재생이 막혀도 muted·playsInline이라 보통 재생된다. 추적은 readyState로 기다린다
      }
    }
    try {
      trackerRef.current = await createFaceTracker()
    } catch {
      stopStream(stream)
      streamRef.current = null
      if (aliveRef.current) setView('unsupported')
      return
    }
    if (!aliveRef.current || !voiceRef.current) {
      trackerRef.current?.close()
      return
    }
    mimeRef.current = pickMimeType()
    const engine = new GuideEngine(voiceRef.current)
    engineRef.current = engine
    engine.begin(performance.now())
    setView('running')
    loop()
  }

  if (view === 'unsupported' || view === 'camera-denied') {
    return (
      <div className="pf-live pf-live-blocked" role="alert">
        <p>
          {view === 'unsupported' ? LIVE_CAPTURE_COPY.unsupported : LIVE_CAPTURE_COPY.cameraDenied}
        </p>
        {view === 'camera-denied' ? (
          <Button variant="ink" className="w-full" onClick={() => setView('intro')}>
            다시 시도
          </Button>
        ) : null}
        {onCancel ? (
          <button type="button" className="pf-live-back" onClick={onCancel}>
            촬영 안내로 돌아가기
          </button>
        ) : null}
      </div>
    )
  }

  const phase = frame?.phase ?? 'idle'
  // 녹화 단계뿐 아니라 오른쪽 끝에 닿아 시작한 멈춤 중에도 녹화가 돈다(-691)
  const recording = frame?.recording ?? false
  // 검사 모드(정면 검사)와 촬영 모드를 화면에서 나눈다. 카메라·추적은 그대로 두고 겹쳐 보이는 것만 바꾼다
  const checking = phase === 'align'
  const showCapture =
    (phase === 'toside' || recording || phase === 'stopping') && !frame?.checkPassed
  const tone = (t: string) => `pf-live-tone-${t}`

  return (
    <div className="pf-live">
      <div ref={stageRef} className="pf-live-stage" {...PRIVATE_MEDIA}>
        <video
          {...PRIVATE_MEDIA}
          ref={videoRef}
          className="pf-live-video"
          playsInline
          muted
          autoPlay
          onLoadedMetadata={placeOvals}
          onResize={placeOvals}
          aria-label="전면 카메라 미리보기"
        />
        {ovals ? (
          <>
            {/* 거리 허용 범위(점선)는 검사 모드에서만 */}
            {checking ? (
              <>
                <div
                  className="pf-live-oval-band"
                  style={{ height: ovals.min, width: ovals.min * GUIDE.faceAspect }}
                />
                <div
                  className="pf-live-oval-band"
                  style={{ height: ovals.max, width: ovals.max * GUIDE.faceAspect }}
                />
              </>
            ) : null}
            <div
              className="pf-live-oval"
              data-tone={frame?.oval ?? 'idle'}
              style={{ height: ovals.mid, width: ovals.mid * GUIDE.faceAspect }}
            />
          </>
        ) : null}

        {/* 가운데 반투명 안내 머리(-765): 고개 위·아래 단계는 그 동작, 나머지는 정면 고정. 녹화 영상에는 들어가지 않는다 */}
        {showCapture && frame?.headGuide ? (
          <div className="pf-live-headguide" data-pose={frame.headGuide}>
            {frame.headGuide !== 'fixed' ? (
              <picture key={frame.headGuide}>
                {frame.headGuide !== 'front' ? (
                  <source
                    media="(prefers-reduced-motion: reduce)"
                    srcSet={`${HEAD_GUIDE_BASE}/head-${frame.headGuide}-still.webp`}
                  />
                ) : null}
                <img
                  src={`${HEAD_GUIDE_BASE}/head-${frame.headGuide}.webp`}
                  alt=""
                  aria-hidden
                  style={ovals ? { height: ovals.mid * 1.2, width: ovals.mid * 1.2 } : undefined}
                />
              </picture>
            ) : null}
            <p>{HEAD_GUIDE_CAPTION[frame.headGuide]}</p>
          </div>
        ) : null}

        {/* 위 띠: 지금 할 일 한 줄, 촬영 중이면 녹화 시간·단계 */}
        <div className="pf-live-top">
          {view !== 'intro' ? (
            <button
              type="button"
              className="pf-live-voice"
              aria-pressed={voiceOn}
              aria-label={voiceOn ? '음성 안내 끄기' : '음성 안내 켜기'}
              onClick={() => changeVoice(!voiceOn)}
            >
              {voiceOn ? '🔊' : '🔇'}
            </button>
          ) : null}
          <p
            className={cx(
              'pf-live-msg',
              tone(checking && frame?.hint ? 'plain' : (frame?.message.tone ?? 'plain')),
            )}
            aria-live="polite"
          >
            {view === 'preparing'
              ? LIVE_CAPTURE_COPY.preparing
              : view === 'finishing'
                ? LIVE_CAPTURE_COPY.finishing
                : view === 'intro'
                  ? ''
                  : // 검사 중 고칠 것은 알약이 말하니 위 띠는 제목만(같은 글을 두 번 보이지 않게)
                    checking && frame?.hint
                    ? '촬영 전 확인'
                    : frame?.message.text}
          </p>
          {recording && frame?.recSec != null ? (
            <p className="pf-live-meta">
              <span className="pf-live-rec">● {frame.recSec.toFixed(1)}s</span>
              <span>
                {Math.min(frame.stepIndex + 1, GUIDE_STEPS.length)}/{GUIDE_STEPS.length} 단계
              </span>
            </p>
          ) : null}
        </div>
        {/* 기준값 조정용 숫자(얼굴 크기·이마·눈 주변)는 ?debug=1일 때만 */}
        {debug !== null && frame?.sizeTag ? (
          <p className={cx('pf-live-size', tone(frame.sizeTag.tone))}>{frame.sizeTag.text}</p>
        ) : null}

        {/* 고칠 것 하나: 얼굴을 가리지 않게 검사 중에는 타원 위, 촬영 중에는 아래 띠 위 */}
        {frame?.hint ? (
          <p
            className="pf-live-pill"
            data-at={checking ? 'top' : 'bottom'}
            style={
              checking && ovals
                ? { top: `max(84px, calc(50% - ${Math.round(ovals.max / 2)}px - 52px))` }
                : undefined
            }
          >
            {frame.hint}
          </p>
        ) : null}
        {frame?.checkPassed ? <CaptureCheckDone /> : null}

        {/* 아래 띠: 검사 목록, 또는 좌우 막대와 단계 막대 */}
        <div className="pf-live-bottom">
          {frame?.checks ? <CaptureChecks checks={frame.checks} /> : null}
          {showCapture ? (
            <>
              <div className="pf-live-gauge" aria-hidden>
                {frame?.gauge ? (
                  <>
                    <b
                      data-full={frame.gauge.full || undefined}
                      style={{ left: `${frame.gauge.from}%`, width: `${frame.gauge.width}%` }}
                    />
                    <i
                      data-fast={frame.gauge.fast || undefined}
                      style={{ left: `${frame.gauge.dot}%` }}
                    />
                  </>
                ) : (
                  <i style={{ left: '50%' }} />
                )}
              </div>
              {/* 단계 이름은 위 띠에 크게 보이니 여기서는 칸만. 읽어 주기용 이름은 남긴다 */}
              <ol className="pf-live-seg" aria-label="촬영 단계">
                {GUIDE_STEPS.map((step, index) => {
                  const done = index < (frame?.stepIndex ?? 0)
                  const now = recording && index === frame?.stepIndex
                  return (
                    <li
                      key={`${step.key}-${index}`}
                      data-state={done ? 'done' : now ? 'now' : undefined}
                      aria-current={now ? 'step' : undefined}
                    >
                      <span className="sr-only">{step.label}</span>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : null}
        </div>
        {debug ? (
          <>
            <pre className="pf-live-debug">{debug}</pre>
            {/* -733 자이로 시험: 폰을 세워 든 채 0으로 맞추고 제자리에서 90° 돌린 뒤 값을 읽는다 */}
            <button
              type="button"
              className="pf-live-debug-reset"
              onClick={() => probeRef.current.reset()}
            >
              자이로 0으로
            </button>
          </>
        ) : null}
      </div>

      {/* 소리 확인·시작은 시트로(-635). 카메라를 덮지 않게 아래 패널은 촬영 중 버튼만 둔다 */}
      <CaptureStartSheet
        open={view === 'intro'}
        voiceOn={voiceOn}
        onVoiceChange={changeVoice}
        onSoundCheck={() => void soundCheck()}
        soundChecked={soundChecked}
        onSoundCheckedChange={onSoundCheckedChange}
        onStart={() => void start()}
        onCancel={onCancel}
      />
      {view !== 'intro' ? (
        <div className="pf-live-panel">
          {frame?.askBangsConfirm ? (
            <CaptureBangsConfirm onConfirm={() => engineRef.current?.confirmBangs()} />
          ) : null}
          {recording ? (
            <Button
              variant="secondary"
              trailingIcon={null}
              className="w-full"
              onClick={() => void finish('manual')}
            >
              녹화 멈춤
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** iOS 13+: 기울기 센서는 클릭 안에서 권한을 받아야 한다. 거절해도 촬영은 한다(높이·기울기 확인만 빠짐) */
async function askSensorPermission() {
  type WithPermission = { requestPermission?: () => Promise<string> }
  const asks: Promise<unknown>[] = []
  const motion = (globalThis as { DeviceMotionEvent?: WithPermission }).DeviceMotionEvent
  const orientation = (globalThis as { DeviceOrientationEvent?: WithPermission })
    .DeviceOrientationEvent
  if (typeof motion?.requestPermission === 'function') asks.push(motion.requestPermission())
  if (typeof orientation?.requestPermission === 'function')
    asks.push(orientation.requestPermission())
  await Promise.all(asks.map((ask) => ask.catch(() => null)))
}
