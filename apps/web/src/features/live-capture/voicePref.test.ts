import { afterEach, describe, expect, it, vi } from 'vitest'
import { readVoiceOn, writeVoiceOn } from './voicePref'

describe('음성 안내 켜짐 저장 (-765)', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('처음에는 켜져 있고, 끈 값을 기억한다', () => {
    expect(readVoiceOn()).toBe(true)
    writeVoiceOn(false)
    expect(readVoiceOn()).toBe(false)
    writeVoiceOn(true)
    expect(readVoiceOn()).toBe(true)
  })

  it('저장소를 못 쓰면(사생활 보호 모드 등) 켜짐으로 보고 오류를 내지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeVoiceOn(false)).not.toThrow()
    expect(readVoiceOn()).toBe(true)
  })
})
