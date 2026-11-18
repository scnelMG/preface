'use client'

import { useEffect, useRef, useState } from 'react'
import type { UploadPolicy } from '@/features/upload/types'
import { useUploadPolicy } from '@/features/upload/useUploadPolicy'
import { LiveCapture } from '@/features/live-capture/LiveCapture'
import { Button } from '@/shared/ui'
import { END_COPY } from '../endReason'
import { replacePage, takeLinkFromUrl } from '../linkToken'
import { useCaptureSessionStore, type CaptureStep } from '../store'
import { readUploaded } from '../uploadedMarker'
import { CaptureGuide } from './CaptureGuide'
import { CaptureShell } from './CaptureShell'
import { CaptureStatus } from './CaptureStatus'
import { ConnectConfirm } from './ConnectConfirm'
import { IphoneModelSheet } from './IphoneModelSheet'
import { VideoReview } from './VideoReview'

const DEFAULT_SESSION_SEC = 1800

/** "PC와 연결됨" 칩을 보이는 단계 */
const CONNECTED_STEPS: readonly CaptureStep[] = [
  'confirm',
  'guide',
  'recording',
  'review',
  'uploaded',
]
/** 세션 토큰을 쥐고 있는 단계. 연결 확인·촬영 가이드는 정책을 쓰지 않지만 확인 화면(SCR-07)을 위해 미리 받아 둔다 */
const POLICY_STEPS: readonly CaptureStep[] = ['confirm', 'guide', 'recording', 'review']

/**
 * 휴대폰 업로드 전용 세션 화면(`/m/capture#t=…`). 단계별 화면을 고른다.
 *
 * 토큰은 URL fragment에 있어 서버가 볼 수 없다. 그래서 이 컴포넌트가 브라우저에서 읽어 교환한다.
 */
export function CaptureSession() {
  const step = useCaptureSessionStore((s) => s.step)
  const sameDevice = useCaptureSessionStore((s) => s.sameDevice)
  const startedRef = useRef(false)

  useEffect(() => {
    // React StrictMode는 effect를 두 번 돌린다. 토큰은 1회용이라 두 번 교환하면 QR_002가 난다.
    if (startedRef.current) return
    startedRef.current = true

    const store = useCaptureSessionStore.getState()
    const { token, sameDevice } = takeLinkFromUrl()
    if (token) void store.connect(token, { sameDevice })
    // 토큰 없이 처음 열었다(새로고침·주소 직접 입력). 이미 연결된 상태로 다시 그려진 경우는 그대로 둔다.
    // 업로드를 마친 뒤 새로고침했다면 완료 화면을 다시 보여 준다(토큰은 이미 버렸다)
    else if (store.step === 'connecting') {
      const uploaded = readUploaded()
      if (uploaded) store.restoreUploaded(uploaded)
      else store.end('missing-token')
    }
  }, [])

  return (
    <CaptureShell
      // 같은 기기면 연결된 PC가 없다
      connected={!sameDevice && CONNECTED_STEPS.includes(step)}
      className={step === 'confirm' ? 'pt-(--space-32)' : 'pt-(--space-24)'}
    >
      <StepView />
    </CaptureShell>
  )
}

function StepView() {
  const state = useCaptureSessionStore()
  // 정책은 세션 토큰이 있는 동안에만 받는다(업로드 전용 세션으로 부를 수 있다).
  // 업로드 완료 뒤에는 토큰을 버리므로 묻지 않는다
  const policy = useUploadPolicy(POLICY_STEPS.includes(state.step))

  return <StepContent state={state} policy={policy} />
}

function StepContent({
  state,
  policy,
}: {
  state: ReturnType<typeof useCaptureSessionStore.getState>
  policy: UploadPolicy
}) {
  // 아이폰 기종 시트(촬영 가이드에서 "영상 촬영하기"를 누르면 연다, -635)
  const [modelOpen, setModelOpen] = useState(false)
  switch (state.step) {
    case 'connecting':
      return (
        <CaptureStatus
          icon="Clock"
          title={state.sameDevice ? '촬영 화면을 준비하는 중이에요' : 'PC와 연결하는 중이에요'}
          busy
        />
      )
    case 'connect-failed':
      return (
        <CaptureStatus
          icon="Info"
          title="연결하지 못했어요"
          body="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          action={
            <Button variant="ink" className="w-full" onClick={() => void state.retry()}>
              다시 시도
            </Button>
          }
        />
      )
    case 'confirm':
      return state.user ? (
        <ConnectConfirm
          user={state.user}
          sessionMinutes={Math.round((state.expiresIn ?? DEFAULT_SESSION_SEC) / 60)}
          device={state.device}
          onDeviceChange={state.setDevice}
          isDisconnecting={state.isDisconnecting}
          onContinue={state.continueToGuide}
          onNotMine={() => void state.disconnect()}
        />
      ) : null
    case 'guide':
      return (
        <>
          <CaptureGuide
            // 아이폰은 촬영 전에 기종을 시트로 고른다(두 흐름 모두, -635). 안드로이드는 브라우저가 알려 준다
            onCapture={state.device === 'iphone' ? () => setModelOpen(true) : state.startRecording}
          />
          <IphoneModelSheet
            open={modelOpen}
            value={state.deviceModel}
            onClose={() => setModelOpen(false)}
            onConfirm={(model) => {
              setModelOpen(false)
              state.setDeviceModel(model)
              state.startRecording()
            }}
          />
        </>
      )
    case 'recording':
      return (
        <LiveCapture
          onRecorded={(recorded, _meta, trace) => state.selectVideo(recorded, trace)}
          onCancel={state.cancelRecording}
          soundChecked={state.soundChecked}
          onSoundCheckedChange={state.setSoundChecked}
        />
      )
    case 'review':
      return state.video ? (
        <VideoReview
          key={state.videoKey}
          file={state.video}
          policy={policy}
          onRetake={state.startRecording}
          deviceModel={state.deviceModel}
          captureTrace={state.captureTrace}
          onUploaded={state.markUploaded}
          onSessionEnded={endSession}
        />
      ) : null
    case 'uploaded':
      if (state.sameDevice && state.jobId) {
        const jobId = state.jobId
        // 업로드 전용 세션은 끝났다. 새로 불러오면 로그인 쿠키로 내 세션이 다시 열린다(AuthBootstrap).
        // 방문 기록에서 이 화면을 뺀다. 뒤로 가기가 끝난 촬영 화면 대신 촬영을 시작한 화면으로 간다(-524)
        return (
          <CaptureStatus
            icon="CheckCircle"
            title="업로드했어요"
            body="3D가 만들어지는 과정을 확인해 보세요."
            action={
              <Button
                variant="ink"
                className="w-full"
                onClick={() => replacePage(`/reconstructions/${encodeURIComponent(jobId)}`)}
              >
                3D 만드는 화면 보기
              </Button>
            }
          />
        )
      }
      // SCR-17④ 업로드 완료(Figma 286:2553). PC가 QR-03 폴링으로 UPLOADED를 보고 생성 대기 화면으로 넘어간다.
      // 복원 작업이 이미 생겨서 여기서 다시 찍을 수는 없다(REC_002). 다시 찍으려면 PC에서 새로 시작한다.
      // Figma의 "데모: PC 화면으로 돌아가기"는 프로토타입 이동용이라 두지 않는다.
      return (
        <CaptureStatus
          icon="CheckCircle"
          title="업로드했어요"
          body={
            <>
              PC 화면에서 3D가 만들어지는 과정을 확인하세요.
              <br />이 창은 닫아도 돼요.
            </>
          }
        />
      )
    case 'ended': {
      const copy = END_COPY[state.endReason ?? 'unknown']
      return <CaptureStatus icon="Info" title={copy.title} body={copy.body} />
    }
  }
}

function endSession() {
  useCaptureSessionStore.getState().end('session-ended')
}
