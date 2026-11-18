import { describe, expect, it } from 'vitest'
import { FAIL_MESSAGES, failMessagesOf, UNKNOWN_FAIL_MESSAGE } from './failMessages'
import type { FailCode } from './types'

const ALL_CODES: FailCode[] = [
  'QUALITY_NO_FACE',
  'QUALITY_ANGLE',
  'QUALITY_LIGHT',
  'QUALITY_COMPRESSED',
  'FIT_FAILED',
  'TIMEOUT',
  'INTERNAL',
]

describe('FAIL_MESSAGES', () => {
  it('명세서 REC-02의 실패 코드마다 이유와 고치는 방법이 있다', () => {
    expect(Object.keys(FAIL_MESSAGES).sort()).toEqual([...ALL_CODES].sort())
    for (const code of ALL_CODES) {
      expect(FAIL_MESSAGES[code].reason).not.toBe('')
      expect(FAIL_MESSAGES[code].fix).not.toBe('')
    }
  })

  it('Figma SCR-09 예시 문구와 같다', () => {
    expect(FAIL_MESSAGES.QUALITY_LIGHT).toEqual({
      reason: '너무 밝거나 어두워요',
      fix: '창문을 등지지 말고 얼굴 앞쪽이 밝은 곳에서 찍어 주세요.',
    })
  })
})

describe('failMessagesOf', () => {
  it('여러 코드를 받은 순서대로 모두 돌려준다', () => {
    expect(failMessagesOf(['QUALITY_ANGLE', 'QUALITY_LIGHT'])).toEqual([
      FAIL_MESSAGES.QUALITY_ANGLE,
      FAIL_MESSAGES.QUALITY_LIGHT,
    ])
  })

  it('겹친 코드는 한 번만, 모르는 코드는 일반 문구 하나로 모은다', () => {
    expect(failMessagesOf(['QUALITY_LIGHT', 'NEW_CODE', 'QUALITY_LIGHT', 'OTHER'])).toEqual([
      FAIL_MESSAGES.QUALITY_LIGHT,
      UNKNOWN_FAIL_MESSAGE,
    ])
  })

  it('코드가 없으면 일반 문구를 보여 준다', () => {
    expect(failMessagesOf([])).toEqual([UNKNOWN_FAIL_MESSAGE])
  })
})
