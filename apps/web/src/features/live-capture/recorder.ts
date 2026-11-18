/**
 * 전면 카메라 열기와 녹화(S15P31B204-619).
 *
 * iPhone 16 Pro Safari 시험(v4): 1080×1920·30fps·H.264 약 15Mbps로 카메라 앱 원본(15.4Mbps)과 비슷하다.
 * 소리는 받지 않는다(마이크 권한을 묻지 않게, 3D에 쓰지 않는다). 녹화 파일은 좌우반전하지 않는다(미리보기만 거울).
 */
export const RECORDER = {
  width: 1920,
  height: 1080,
  fps: 30,
  /** 16Mbps. 카메라 앱 원본과 비슷한 화질 */
  bitrate: 16_000_000,
  /** 1초마다 조각을 받는다(멈췄을 때 마지막 조각까지 모은다) */
  timesliceMs: 1000,
} as const

/** 앞에서부터 지원하는 형식을 쓴다. 아이폰 Safari는 mp4(H.264), 안드로이드 Chrome은 최신이면 mp4, 아니면 webm */
export const MIME_PREFERENCE = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm',
] as const

/** 이 브라우저에서 웹 녹화를 할 수 있는지(카메라 + MediaRecorder) */
export function isLiveCaptureSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof window.MediaRecorder === 'function'
  )
}

export function pickMimeType(
  isTypeSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && !!MediaRecorder.isTypeSupported?.(type),
): string {
  return MIME_PREFERENCE.find((type) => isTypeSupported(type)) ?? ''
}

export function openFrontCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: RECORDER.width },
      height: { ideal: RECORDER.height },
      frameRate: { ideal: RECORDER.fps },
    },
  })
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

/** 녹화 결과 파일. 업로드 형식 검사가 `file.type`을 보므로 코덱 꼬리를 뗀 기본 형식을 넣는다 */
export function recordedFile(chunks: BlobPart[], mimeType: string): File {
  const base = (mimeType.split(';')[0] || 'video/webm').trim().toLowerCase()
  const ext = base.includes('mp4') ? 'mp4' : 'webm'
  return new File(chunks, `capture.${ext}`, { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' })
}

export interface Recording {
  /** 녹화를 마치고 파일을 받는다. 두 번 불러도 같은 결과 */
  stop(): Promise<File>
  /** 녹화를 버린다(화면을 떠날 때) */
  discard(): void
}

export function startRecording(stream: MediaStream, mimeType = pickMimeType()): Recording {
  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: RECORDER.bitrate,
  })
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  const done = new Promise<File>((resolve, reject) => {
    recorder.onstop = () => resolve(recordedFile(chunks, recorder.mimeType || mimeType))
    recorder.onerror = () => reject(new Error('recorder-error'))
  })
  recorder.start(RECORDER.timesliceMs)
  return {
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      return done
    },
    discard() {
      recorder.ondataavailable = null
      done.catch(() => {})
      if (recorder.state !== 'inactive') recorder.stop()
      chunks.length = 0
    },
  }
}
