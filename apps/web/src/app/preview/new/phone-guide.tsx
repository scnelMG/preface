'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, useSyncExternalStore, Component, type ReactNode } from 'react'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { CAPTURE_POSES } from './capture-poses'

export { HOLD_MS, HOLD_SWAP_MS } from './capture-poses'
const GuideScene = dynamic(() => import('./capture-guide-scene'), {
  ssr: false,
  loading: () => <p className="pc-guide-loading">안내 모델을 불러오고 있어요.</p>,
})
/** 촬영하는 사람을 옆에서 본 장면(팔을 뻗어 휴대폰을 든 마네킹). 휴대폰 화면과 같은 단계를 보여 준다 */
const ArmScene = dynamic(() => import('./capture-arm-scene'), { ssr: false })
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
const readMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
const readVisibility = () => document.visibilityState === 'visible'
const serverTrue = () => true

export function PhoneGuide() {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [inView, setInView] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, serverTrue)
  const pageVisible = useSyncExternalStore(subscribeVisibility, readVisibility, serverTrue)
  const running = playing && !reduced && inView && pageVisible
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.15,
    })
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(
      () => setStep((current) => (current + 1) % CAPTURE_POSES.length),
      CAPTURE_POSES[step].ms,
    )
    return () => window.clearTimeout(timer)
  }, [running, step])
  return (
    <div className="pc-guide" ref={root}>
      {/* 촬영 무대(2026-10-31): 왼쪽은 팔을 쭉 뻗어 휴대폰으로 찍는 사람(옆에서 본 모습, 휴대폰이 지나는 길은 점선),
          오른쪽 위에 겹친 휴대폰은 그 순간 화면에 담기는 모습. 두 장면이 같은 단계로 함께 움직인다 */}
      <div className="pc-capture-stage">
        <div
          className="pc-arm-view"
          role="img"
          aria-label={`${CAPTURE_POSES[step].label}: 팔을 쭉 뻗어 휴대폰으로 얼굴을 찍는 모습`}
        >
          <GuideBoundary>
            <ArmScene step={step} immediate={!running} />
          </GuideBoundary>
        </div>
        <div className="pc-phone" aria-label="휴대폰 화면">
          <div className="pc-phone-island" aria-hidden="true" />
          <div className="pc-phone-top" aria-hidden="true">
            <span className="pc-phone-rec">녹화 중</span>
            <span>
              {step + 1} / {CAPTURE_POSES.length}
            </span>
          </div>
          <div
            className="pc-phone-model"
            role="img"
            aria-label={`${CAPTURE_POSES[step].label} 방향에서 휴대폰에 담기는 얼굴`}
          >
            <GuideBoundary>
              <GuideScene step={step} immediate={!running} />
            </GuideBoundary>
          </div>
          <div className="pc-phone-home" aria-hidden="true" />
        </div>
      </div>
      <div className="pc-guide-caption" aria-live="polite">
        <strong>{CAPTURE_POSES[step].caption}</strong>
        <p>{CAPTURE_POSES[step].instruction}</p>
      </div>
      {/* 순서 막대(2026-10-31): 단계마다 머무는 시간만큼의 너비. 지나간 단계는 잉크, 지금 단계는 시간에 맞춰 차오른다.
          누르면 그 단계로 가고 자동 재생을 멈춘다 */}
      <div className="pc-guide-controls">
        <div className="pc-motion-timeline" role="group" aria-label="촬영 순서">
          {CAPTURE_POSES.map((pose, index) => (
            <button
              key={index}
              aria-label={`${index + 1}. ${pose.label}`}
              aria-pressed={step === index}
              data-state={index < step ? 'done' : index === step ? 'current' : 'next'}
              style={{ flexGrow: pose.ms }}
              onClick={() => {
                setStep(index)
                setPlaying(false)
              }}
            >
              <span className="pc-motion-bar" aria-hidden="true">
                <span
                  key={running && index === step ? `run-${step}` : 'still'}
                  className="pc-motion-fill"
                  data-running={running && index === step ? '' : undefined}
                  style={{ animationDuration: `${pose.ms}ms` }}
                />
              </span>
              <span className="pc-motion-label" aria-hidden="true">
                {pose.label}
              </span>
            </button>
          ))}
        </div>
        {!reduced && (
          <button
            className="pc-guide-play"
            aria-label={playing ? '각도 안내 일시정지' : '각도 안내 재생'}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          </button>
        )}
      </div>
      <p className="pc-guide-note">
        얼굴은 고정하고, 팔을 쭉 뻗은 채로 휴대폰을 천천히 움직여주세요.
      </p>
    </div>
  )
}
class GuideBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p className="pc-guide-loading">
        3D 안내를 불러오지 못했어요. 아래 방향 버튼으로 순서를 확인하세요.
      </p>
    ) : (
      this.props.children
    )
  }
}
