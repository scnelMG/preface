import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_KEYS, VoiceScheduler } from './voicePlayer'

function setup() {
  let clock = 0
  const played: string[] = []
  const gaps: number[] = []
  let pauses = 0
  const scheduler = new VoiceScheduler({
    now: () => clock,
    play: (key, afterMs) => {
      played.push(key)
      gaps.push(afterMs)
    },
    pause: () => {
      pauses++
    },
  })
  return {
    scheduler,
    played,
    gaps,
    pauses: () => pauses,
    at: (ms: number) => {
      clock = ms
    },
  }
}

describe('VoiceScheduler (재생기 하나, 안내를 끊지 않는다)', () => {
  it('안내는 말하는 중이면 끝난 뒤 이어서 낸다. 대기는 마지막 하나만', () => {
    const { scheduler, played } = setup()
    expect(scheduler.say('v3start', { force: true })).toBe(true)
    expect(scheduler.say('sweepright', { force: true })).toBe(false)
    scheduler.say('holdside', { force: true })
    expect(played).toEqual(['v3start'])
    scheduler.handleEnded()
    expect(played).toEqual(['v3start', 'holdside'])
  })

  it('interrupt 안내는 말하는 중이어도 앞 소리와 대기를 끊고 바로 낸다', () => {
    const { scheduler, played, pauses } = setup()
    scheduler.say('checkdone', { force: true })
    scheduler.say('holdside', { force: true })
    expect(scheduler.say('recleft', { force: true, interrupt: true })).toBe(true)
    expect(pauses()).toBe(1)
    expect(played).toEqual(['checkdone', 'recleft'])
    expect(scheduler.busy()).toBe(true)
    scheduler.handleEnded()
    expect(played).toEqual(['checkdone', 'recleft'])
    expect(scheduler.busy()).toBe(false)
  })

  it('끊긴 앞 재생이 늦게 거절돼도 지금 재생을 끝난 것으로 보지 않는다', async () => {
    let rejectOld!: (e: Error) => void
    const played: string[] = []
    const scheduler = new VoiceScheduler({
      now: () => 0,
      play: (key) => {
        played.push(key)
        if (key === 'checkdone')
          return new Promise<void>((_, reject) => {
            rejectOld = reject
          })
      },
      pause: () => {},
    })
    scheduler.say('checkdone', { force: true })
    scheduler.say('recleft', { force: true, interrupt: true })
    rejectOld(new Error('AbortError'))
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduler.busy()).toBe(true)
  })

  it('대기한 안내와 끊고 내는 안내는 0.5초 쉬고 낸다. 바로 내는 말은 쉬지 않는다(-781)', () => {
    const { scheduler, played, gaps } = setup()
    scheduler.say('checkdone', { force: true })
    scheduler.say('goright', { force: true })
    scheduler.handleEnded()
    scheduler.say('recleft', { force: true, interrupt: true })
    scheduler.handleEnded()
    scheduler.say('switchhand', { force: true })
    expect(played).toEqual(['checkdone', 'goright', 'recleft', 'switchhand'])
    expect(gaps).toEqual([0, 500, 500, 0])
  })

  it('force가 아닌 안내는 말하는 중이면 버린다', () => {
    const { scheduler, played } = setup()
    scheduler.say('v3start', { force: true })
    scheduler.say('noface')
    scheduler.handleEnded()
    expect(played).toEqual(['v3start'])
  })

  it('경고는 말하는 중이거나 대기 안내가 있으면 내지 않는다', () => {
    const { scheduler, played, at } = setup()
    at(10_000)
    scheduler.say('more')
    expect(scheduler.warn('wfar')).toBe(false)
    scheduler.handleError()
    expect(scheduler.busy()).toBe(false)
    expect(played).toEqual(['more'])
  })

  it('안내가 끝난 뒤 2초 동안은 경고를 내지 않는다', () => {
    const { scheduler, played, at } = setup()
    scheduler.say('v3start', { force: true })
    at(3000)
    scheduler.handleEnded()
    at(4900)
    expect(scheduler.warn('wfar')).toBe(false)
    at(5100)
    expect(scheduler.warn('wfar')).toBe(true)
    expect(played).toEqual(['v3start', 'wfar'])
  })

  it('재생이 거절되면 다음 대기 안내로 넘어간다', async () => {
    const played: string[] = []
    const scheduler = new VoiceScheduler({
      now: () => 0,
      play: (key) => {
        played.push(key)
        return key === 'v3start' ? Promise.reject(new Error('NotAllowed')) : Promise.resolve()
      },
    })
    scheduler.say('v3start', { force: true })
    scheduler.say('sweepright', { force: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(played).toEqual(['v3start', 'sweepright'])
  })

  it('cancel은 대기를 비우고 소리를 멈춘다', () => {
    const { scheduler, played, pauses } = setup()
    scheduler.say('countdown', { force: true })
    scheduler.say('v3start', { force: true })
    scheduler.cancel()
    expect(pauses()).toBe(1)
    expect(scheduler.busy()).toBe(false)
    scheduler.handleEnded()
    expect(played).toEqual(['countdown'])
  })
})

describe('음성 파일', () => {
  it('화면이 쓰는 음성이 모두 public/voice/capture에 있다', () => {
    const files = readdirSync(join(process.cwd(), 'public/voice/capture'))
    for (const key of VOICE_KEYS) expect(files).toContain(`${key}.m4a`)
  })
})

describe('음성 안내 끄기 (-765)', () => {
  it('끄면 안내·경고를 재생하지 않고 말하는 중도 아니다(멈춤이 음성을 기다리지 않는다)', () => {
    const { scheduler, played } = setup()
    scheduler.setMuted(true)
    scheduler.say('checkdone', { force: true })
    scheduler.say('recleft', { force: true, interrupt: true })
    expect(scheduler.warn('wslow')).toBe(false)
    expect(played).toEqual([])
    expect(scheduler.busy()).toBe(false)
  })

  it('말하는 중에 끄면 지금 소리와 대기를 바로 멈춘다', () => {
    const { scheduler, played, pauses } = setup()
    scheduler.say('checkdone', { force: true })
    scheduler.say('recleft', { force: true })
    scheduler.setMuted(true)
    expect(pauses()).toBe(1)
    expect(scheduler.busy()).toBe(false)
    scheduler.handleEnded()
    expect(played).toEqual(['checkdone'])
  })

  it('다시 켜면 그다음 안내부터 낸다', () => {
    const { scheduler, played } = setup()
    scheduler.setMuted(true)
    scheduler.say('checkdone', { force: true })
    scheduler.setMuted(false)
    scheduler.say('recleft', { force: true })
    expect(played).toEqual(['recleft'])
  })
})
