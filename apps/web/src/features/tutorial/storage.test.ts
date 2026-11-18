import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearTutorialRecord,
  readTutorialRecord,
  TUTORIAL_STORAGE_KEY,
  writeTutorialRecord,
} from './storage'

afterEach(() => {
  vi.restoreAllMocks()
  clearTutorialRecord()
  localStorage.clear()
})

describe('튜토리얼 기록', () => {
  it('키 이름에 버전이 들어 있다', () => {
    expect(TUTORIAL_STORAGE_KEY).toBe('preface.tutorial.v1')
  })

  it('처음 기기에는 기록이 없다', () => {
    expect(readTutorialRecord()).toBeNull()
  })

  it('완료·건너뛰기를 localStorage에 남긴다', () => {
    writeTutorialRecord('skipped')
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe('skipped')
    expect(readTutorialRecord()).toBe('skipped')

    writeTutorialRecord('completed')
    expect(readTutorialRecord()).toBe('completed')
  })

  it('알 수 없는 값은 기록 없음으로 본다', () => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, 'yes')
    expect(readTutorialRecord()).toBeNull()
  })

  it('저장소가 예외를 던져도 멈추지 않고 이 탭에서는 기억한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(readTutorialRecord()).toBeNull()
    expect(() => writeTutorialRecord('completed')).not.toThrow()
    expect(readTutorialRecord()).toBe('completed')
    expect(() => clearTutorialRecord()).not.toThrow()
    expect(readTutorialRecord()).toBeNull()
  })
})
