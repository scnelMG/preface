import type { ComponentProps } from 'react'
import type { CaptureTrace } from './captureTrace'
import type { LiveCapture } from './LiveCapture'

/**
 * 테스트용 가짜 촬영 화면. jsdom에는 카메라·MediaRecorder·MediaPipe가 없어 실제 화면을 돌릴 수 없다.
 * `vi.mock('@/features/live-capture/LiveCapture', ...)`로 바꿔 끼우고 [가짜 녹화 끝]으로 녹화가 끝난 것처럼 만든다.
 * 영상은 합성 바이트만 쓴다.
 */
let nextRecording = new File(['synthetic-recording'], 'capture.mp4', { type: 'video/mp4' })

/** 가짜 촬영 화면이 넘기는 촬영 기록(합성 값, -641) */
export const FAKE_CAPTURE_TRACE: CaptureTrace = {
  version: 1,
  guideVersion: 'test',
  trackerVersion: 'test',
  meta: {
    durationMs: 30_000,
    stopReason: 'complete',
    stepsDone: 6,
    stepsTotal: 6,
    mimeType: 'video/mp4',
    bothSides: true,
  },
  steps: [{ name: 'recleft', startMs: 0, endMs: 50 }],
  trace: [
    [0, 55, -1, 1],
    [50, null, null, 0],
  ],
  trackSettings: { width: 1080, height: 1920 },
}

export function setNextRecording(file: File) {
  nextRecording = file
}

/** 다음 [가짜 녹화 끝]이 넘길 촬영 기록(기본 FAKE_CAPTURE_TRACE). 한 번 쓰면 기본으로 돌아간다 */
let nextTrace: CaptureTrace = FAKE_CAPTURE_TRACE
export function setNextTrace(trace: CaptureTrace) {
  nextTrace = trace
}

export function FakeLiveCapture({
  onRecorded,
  onCancel,
  soundChecked,
  onSoundCheckedChange,
}: ComponentProps<typeof LiveCapture>) {
  return (
    <div>
      <p>실시간 촬영 화면(테스트)</p>
      {/* 촬영 준비 시트의 "잘 들려요" 대신. 부모가 체크를 기억하는지 본다(-882) */}
      <label>
        <input
          type="checkbox"
          checked={soundChecked ?? false}
          onChange={(event) => onSoundCheckedChange?.(event.target.checked)}
        />
        잘 들려요(테스트)
      </label>
      <button
        type="button"
        onClick={() => {
          const trace = nextTrace
          nextTrace = FAKE_CAPTURE_TRACE
          onRecorded(nextRecording, { ...trace.meta, mimeType: nextRecording.type }, trace)
        }}
      >
        가짜 녹화 끝
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel}>
          촬영 안내로 돌아가기
        </button>
      ) : null}
    </div>
  )
}

/** 웹 녹화를 지원하는 브라우저처럼 만든다. 돌려준 함수로 되돌린다 */
export function stubLiveCaptureSupport(): () => void {
  const hadRecorder = 'MediaRecorder' in window
  const previousRecorder = (window as { MediaRecorder?: unknown }).MediaRecorder
  ;(window as { MediaRecorder?: unknown }).MediaRecorder = function MediaRecorder() {}
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: () => Promise.reject(new Error('테스트에는 카메라가 없다')) },
  })
  return () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    if (hadRecorder) (window as { MediaRecorder?: unknown }).MediaRecorder = previousRecorder
    else Reflect.deleteProperty(window, 'MediaRecorder')
  }
}
