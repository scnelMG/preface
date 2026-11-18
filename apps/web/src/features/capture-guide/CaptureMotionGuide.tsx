'use client'

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { CAPTURE_MOTION_STEPS } from './guideContent'

/**
 * 촬영 순서 시연(2026-10-31, 일러스트 모션). 미리 만든 영상(public/guide/capture-motion.*) 하나가 화면의 주인공이고,
 * 영상의 재생 시간이 영상 바로 아래 문구를 한 장씩 넘긴다(슬라이드). 번호 목록 대신 지금 단계 하나만 크게.
 *
 * 한 화면에 다 보이게(스크롤 없이): 왼쪽 열은 소개(intro) → 행동(actions) → 찍기 전 준비(after),
 * 오른쪽 열은 상자 없이 가장자리가 바탕으로 번지는 영상 → 지금 단계 문구 → 한 줄 진행선(단계 수만큼 칸).
 * 좁은 화면은 소개 → 영상·문구 → 행동 → 준비 순서로 한 줄.
 *
 * - 영상: 선 그림 사람이 팔을 쭉 뻗어 갤럭시 휴대폰으로 찍고(왼쪽), 오른쪽에 그 순간 휴대폰 화면이 같이 움직인다. 무음·반복.
 *   순서는 실시간 촬영 가이드와 같고 좌우는 찍는 사람 기준이다(2026-11-12, `CAPTURE_MOTION_STEPS`).
 *   만든 곳: live-mirror-poc/.run/capture-motion(HyperFrames). 단계 경계는 capture-motion.json과 같다.
 * - 지금 단계 문구: 단계가 바뀌면 아래에서 살짝 떠오르며 선명해진다(움직임 줄이기면 바로 바뀐다).
 * - 진행선: 같은 길이의 칸(단계마다 하나). 지난 칸은 차 있고 지금 칸은 재생 시간만큼 찬다. 칸을 누르면 그 단계로.
 * - 영상 끝(마지막 단계 뒤)은 정면에서 휴대폰을 다시 오른손으로 잡는 구간이라 따라 할 동작이 아니다. '처음부터 다시'만 흐리게 보인다.
 * - 움직임 줄이기면 영상을 틀지 않고, 고른 단계의 정지 그림을 크게 보인다. 영상을 못 불러와도 같은 정지 그림으로 대신한다.
 * - 화면 밖이거나 탭이 숨겨지면 영상을 멈춘다.
 */

const STEPS = CAPTURE_MOTION_STEPS.map((step, index) => ({
  ...step,
  index,
  still: `/guide/capture-step-${index + 1}.webp`,
}))

const STEPS_END = STEPS[STEPS.length - 1].end
/** 끝 부분(돌아가는 구간)의 문구 */
const RETURN_CAPTION = '처음부터 다시'
/** 시연 영상 재생 속도. 1.3배 느리게 해 단계 문구를 끝까지 읽을 수 있게 한다. 문구·진행선은 재생 시간을 따라가 같이 느려진다 */
export const GUIDE_PLAYBACK_RATE = 1 / 1.3

function subscribeMotion(listener: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
const readReduced = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function CaptureMotionGuide({
  guideRef,
  intro,
  actions,
  after,
}: {
  guideRef?: RefObject<HTMLDivElement | null>
  intro?: ReactNode
  actions?: ReactNode
  after?: ReactNode
}) {
  return (
    <div className="pf-cap-grid" ref={guideRef}>
      <div className="pf-cap-left">
        {intro}
        {actions ? <div className="pf-cap-action">{actions}</div> : null}
        {after}
      </div>
      <div className="pf-cap-right">
        <CaptureMotionPlayer />
      </div>
    </div>
  )
}

/**
 * 시연 영상 + 지금 단계 문구 + 한 줄 진행선. PC 새 모델 화면과 휴대폰 촬영 안내(SCR-05)가 같이 쓴다.
 * 모양은 capture-flow.css의 `.pf-motion-*`.
 */
export function CaptureMotionPlayer() {
  const reduced = useSyncExternalStore(subscribeMotion, readReduced, () => false)
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState(0)
  const stillOnly = reduced || failed

  // 재생 시간 → 지금 단계·막대. 매 프레임 읽고(부드러운 막대), 프레임이 멈춘 환경(가려진 창 등)에서는 timeupdate로 따라간다
  useEffect(() => {
    const element = video.current
    if (stillOnly || !element) return
    let frame = 0
    const read = () => setTime(element.currentTime)
    const tick = () => {
      read()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    element.addEventListener('timeupdate', read)
    element.addEventListener('seeked', read)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('timeupdate', read)
      element.removeEventListener('seeked', read)
    }
  }, [stillOnly])

  // 화면 밖·숨긴 탭에서는 멈추고, 돌아오면 사용자가 멈춘 게 아니면 다시 튼다
  useEffect(() => {
    const element = video.current
    if (!element || stillOnly) return
    let visible = true
    const sync = () => {
      if (visible && playing && document.visibilityState === 'visible')
        void Promise.resolve(element.play()).catch(() => {})
      else element.pause()
    }
    // 화면에 보이는지(지원하지 않는 환경이면 늘 보인다고 본다)
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting
            sync()
          })
        : null
    observer?.observe(element)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [playing, stillOnly])

  // 마지막 단계 뒤(영상 끝 부분)는 정면에서 휴대폰을 다시 오른손으로 잡는 구간. 진행선은 다 찬 채로 둔다
  const returning = !stillOnly && time >= STEPS_END
  const current = stillOnly
    ? STEPS[picked]
    : (STEPS.find((step) => time >= step.start && time < step.end) ?? STEPS[STEPS.length - 1])

  const jump = (index: number) => {
    setPicked(index)
    const element = video.current
    if (element && !stillOnly) {
      element.currentTime = STEPS[index].start + 0.01
      setTime(element.currentTime)
    }
  }

  return (
    <>
      <section className="pf-motion-stage" aria-label="촬영 순서 시연">
        {stillOnly ? (
          // eslint-disable-next-line @next/next/no-img-element -- 미리 만든 정지 그림을 그대로 쓴다(최적화로 바뀌지 않게)
          <img
            src={current.still}
            alt={`${current.label}: ${current.instruction}`}
            className="pf-motion-media"
          />
        ) : (
          <video
            ref={video}
            className="pf-motion-media"
            muted
            loop
            playsInline
            autoPlay
            preload="metadata"
            poster="/guide/capture-motion-poster.webp"
            aria-label="팔을 쭉 뻗어 휴대폰으로 얼굴을 찍는 순서 시연(촬영 전 검사, 오른쪽, 정면에서 왼손으로 바꿔 잡기, 왼쪽, 정면, 고개 위, 고개 아래)"
            onLoadedMetadata={(event) => {
              // 영상을 다시 불러오면 playbackRate가 defaultPlaybackRate로 돌아가므로 둘 다 맞춘다
              event.currentTarget.defaultPlaybackRate = GUIDE_PLAYBACK_RATE
              event.currentTarget.playbackRate = GUIDE_PLAYBACK_RATE
            }}
            // 받은 뒤 재생이 깨진 경우(video 자신의 오류)만. React는 source 오류도 여기로 올려 보내는데,
            // 첫 source(webm)만 실패하면 브라우저가 다음 source(mp4)로 넘어가니 정지 그림으로 바꾸지 않는다
            onError={(event) => {
              if (event.target === event.currentTarget) setFailed(true)
            }}
          >
            <source src="/guide/capture-motion.webm" type="video/webm" />
            {/* 마지막 source까지 실패하면 고를 영상이 없다. 정지 그림으로 */}
            <source
              src="/guide/capture-motion.mp4"
              type="video/mp4"
              onError={() => setFailed(true)}
            />
          </video>
        )}
      </section>

      {/* 지금 단계: 영상과 같이 한 장씩 넘어가는 문구(슬라이드). 아래 한 줄 진행선은 단계마다 한 칸, 지금 칸이 재생 시간만큼 찬다 */}
      <div className="pf-motion-caption">
        <div
          className="pf-motion-slide"
          data-returning={returning ? '' : undefined}
          key={returning ? 'return' : current.index}
          aria-live="polite"
        >
          <strong>{returning ? RETURN_CAPTION : current.label}</strong>
          {returning ? null : <p>{current.instruction}</p>}
        </div>
        {/* 진행선과 멈춤 버튼은 한 줄(버튼을 영상 위에 겹치지 않는다) */}
        <div className="pf-motion-controls">
          <div className="pf-motion-track" role="group" aria-label="촬영 순서">
            {STEPS.map((step) => {
              const state =
                step.index < current.index
                  ? 'done'
                  : step.index === current.index
                    ? 'current'
                    : 'next'
              const progress = stillOnly
                ? state === 'next'
                  ? 0
                  : 1
                : state === 'done'
                  ? 1
                  : state === 'current'
                    ? Math.min(1, (time - step.start) / (step.end - step.start))
                    : 0
              return (
                <button
                  key={step.index}
                  type="button"
                  data-state={state}
                  aria-pressed={state === 'current'}
                  aria-label={`${step.index + 1}. ${step.label}`}
                  onClick={() => jump(step.index)}
                >
                  <span aria-hidden="true">
                    <span style={{ transform: `scaleX(${progress})` }} />
                  </span>
                </button>
              )
            })}
          </div>
          {stillOnly ? null : (
            <button
              type="button"
              className="pf-motion-play"
              aria-label={playing ? '시연 멈추기' : '시연 다시 보기'}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? (
                <PauseIcon size={14} weight="fill" />
              ) : (
                <PlayIcon size={14} weight="fill" />
              )}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
