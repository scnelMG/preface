import { GUIDE, type VoicePort } from './guideEngine'

/**
 * 촬영 안내 음성(S15P31B204-619). 파일은 `public/voice/capture/<key>.m4a`(이름으로 바꿔 끼운다).
 *
 * 규칙(시험 v4):
 * - 재생기는 하나만 둔다(소리 파일만 바꿈) → 두 음성이 동시에 나올 수 없다.
 * - 안내(`say(key, { force: true })`)는 말하는 중이면 끝난 뒤 이어서 낸다. 대기는 1개(새 안내가 앞 대기를 바꾼다).
 * - 대기한 안내를 이어 낼 때와 앞 소리를 끊고(interrupt) 낼 때는 `GUIDE.voiceGapMs`만큼 쉬고 낸다(-781). 그 사이도 말하는 중이다.
 * - 경고(`warn`)는 아무 말도 안 나올 때만 낸다. 안내를 끊지 않는다. 안내 뒤 2초 동안은 내지 않는다.
 */

/** 화면에서 실제로 쓰는 음성. 파일 이름과 같다 */
export const VOICE_KEYS = [
  'soundcheck',
  'v4ready',
  'checkdone',
  'toright',
  'goright',
  'recleft',
  'switchhand',
  'sweepleft',
  'backfront',
  'headup',
  'headdown',
  'holdside',
  'more',
  'finishwait',
  'done',
  'noface',
  'v4farther',
  'closer',
  'raise',
  'lower',
  'lookfront',
  'bangs',
  'glasses',
  'wfar',
  'wnear',
  'wheight',
  'wupright',
  'wsteady',
  'wslow',
  'weyes',
  'wheadfix',
] as const

export const VOICE_BASE_URL = '/voice/capture'

/**
 * 재생 순서 규칙만 담은 부분. 재생(`play`)과 시계(`now`)를 받아서 테스트에서 가짜로 바꾼다.
 * 재생이 끝나면 `handleEnded`, 실패하면 `handleError`를 불러 준다.
 */
export class VoiceScheduler implements VoicePort {
  private speakingKey: string | null = null
  private speakingWarn = false
  private queued: string | null = null
  private lastInstructionAt = Number.NEGATIVE_INFINITY
  /** 재생 차례. 끊긴 앞 재생의 늦은 거절이 지금 재생을 끝내지 않게 한다 */
  private playId = 0
  /** 음성 안내를 껐다(-765). 아무것도 재생하지 않고 늘 조용한 것으로 답해, 멈춤이 음성을 기다리지 않는다 */
  private muted = false

  constructor(
    private readonly deps: {
      now: () => number
      /** 재생을 시작한다(afterMs만큼 쉬고). 거절되면(자동 재생 막힘 등) reject */
      play: (key: string, afterMs: number) => Promise<void> | void
      /** 지금 소리를 멈춘다 */
      pause?: () => void
    },
    private readonly graceMs: number = GUIDE.warnGraceMs,
    private readonly gapMs: number = GUIDE.voiceGapMs,
  ) {}

  busy() {
    return this.speakingKey !== null
  }

  /** 끄면 지금 소리와 대기를 바로 멈춘다. 켜면 그다음 안내부터 낸다 */
  setMuted(muted: boolean) {
    this.muted = muted
    if (muted) this.cancel()
  }

  say(
    key: string,
    { force = false, interrupt = false }: { force?: boolean; interrupt?: boolean } = {},
  ) {
    if (this.muted) return false
    if (force) this.lastInstructionAt = this.deps.now()
    if (interrupt && this.busy()) {
      this.queued = null
      this.deps.pause?.()
      // 앞 말이 뚝 끊기고 곧바로 다음 말이 붙지 않게 쉬고 낸다(-781)
      this.playNow(key, false, this.gapMs)
      return true
    } else if (this.busy()) {
      if (force) this.queued = key
      return false
    }
    this.playNow(key, false)
    return true
  }

  warn(key: string) {
    if (this.muted || this.busy() || this.queued) return false
    if (this.deps.now() - this.lastInstructionAt < this.graceMs) return false
    this.playNow(key, true)
    return true
  }

  cancel() {
    this.queued = null
    this.deps.pause?.()
    this.speakingKey = null
    this.speakingWarn = false
  }

  handleEnded() {
    const wasInstruction = this.speakingKey !== null && !this.speakingWarn
    this.speakingKey = null
    this.speakingWarn = false
    if (wasInstruction) this.lastInstructionAt = this.deps.now()
    this.next()
  }

  handleError() {
    this.speakingKey = null
    this.speakingWarn = false
    this.next()
  }

  /** iOS 잠금 해제용 무음 재생 뒤 말하는 중 표시를 지운다 */
  reset() {
    this.speakingKey = null
    this.speakingWarn = false
  }

  private next() {
    if (!this.queued) return
    const key = this.queued
    this.queued = null
    this.playNow(key, false, this.gapMs)
  }

  private playNow(key: string, isWarn: boolean, afterMs = 0) {
    this.speakingKey = key
    this.speakingWarn = isWarn
    const id = ++this.playId
    try {
      const played = this.deps.play(key, afterMs)
      if (played)
        played.catch(() => {
          if (id === this.playId) this.handleError()
        })
    } catch {
      this.handleError()
    }
  }
}

export interface VoicePlayer extends VoicePort {
  /** iOS: 버튼을 누른 동작 안에서 한 번 재생해 둬야 이후 재생이 된다. 클릭 처리 안에서 부른다 */
  unlock(): Promise<void>
  /** 음성 안내 끄기·켜기(-765) */
  setMuted(muted: boolean): void
  dispose(): void
}

/**
 * 브라우저 재생기. 파일은 미리 받아 blob URL로 둔다(재생 때 네트워크를 기다리지 않게).
 * 받지 못한 파일은 주소로 바로 재생한다.
 */
export function createVoicePlayer(baseUrl: string = VOICE_BASE_URL): VoicePlayer {
  const audio = new Audio()
  audio.preload = 'auto'
  const clips: Record<string, string> = {}
  let disposed = false
  const src = (key: string) => clips[key] ?? `${baseUrl}/${key}.m4a`

  void Promise.all(
    VOICE_KEYS.map(async (key) => {
      try {
        const res = await fetch(`${baseUrl}/${key}.m4a`)
        if (!res.ok) return
        const url = URL.createObjectURL(await res.blob())
        if (disposed) URL.revokeObjectURL(url)
        else clips[key] = url
      } catch {
        // 주소로 재생한다
      }
    }),
  )

  /** 쉬고 내려고 기다리는 재생. 끊기(pause)·정리 때 지운다 */
  let pending: ReturnType<typeof setTimeout> | null = null
  const clearPending = () => {
    if (pending !== null) clearTimeout(pending)
    pending = null
  }
  const scheduler = new VoiceScheduler({
    now: () => performance.now(),
    play: (key, afterMs) => {
      clearPending()
      audio.src = src(key)
      if (afterMs <= 0) return audio.play()
      return new Promise<void>((resolve, reject) => {
        pending = setTimeout(() => {
          pending = null
          audio.play().then(resolve, reject)
        }, afterMs)
      })
    },
    pause: () => {
      clearPending()
      audio.pause()
    },
  })
  audio.onended = () => scheduler.handleEnded()
  audio.onerror = () => scheduler.handleError()

  return {
    busy: () => scheduler.busy(),
    say: (key, options) => scheduler.say(key, options),
    warn: (key) => scheduler.warn(key),
    cancel: () => scheduler.cancel(),
    setMuted: (muted) => scheduler.setMuted(muted),
    async unlock() {
      if (scheduler.busy()) return
      audio.muted = true
      audio.src = src('soundcheck')
      try {
        await audio.play()
      } catch {
        // 막혀도 진행한다. 다음 클릭에서 다시 시도한다
      }
      audio.pause()
      audio.muted = false
      scheduler.reset()
    },
    dispose() {
      disposed = true
      const cleanup = () => {
        clearPending()
        audio.onended = null
        audio.onerror = null
        audio.pause()
        audio.removeAttribute('src')
        for (const url of Object.values(clips)) URL.revokeObjectURL(url)
      }
      // 마지막 말("끝났어요")은 화면이 넘어가도 끝까지 들려준다. 대기 중인 안내는 버린다
      if (scheduler.busy() && !audio.paused) {
        scheduler.reset()
        audio.onended = cleanup
        audio.onerror = cleanup
      } else cleanup()
    },
  }
}
