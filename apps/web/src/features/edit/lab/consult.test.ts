import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api/ApiError'
import type { ConsultMessage, SendMessageResult } from '../types'
import { validateTitle } from './simulationTitle'
import {
  APPLY_FAILED_CHAT_UNSUPPORTED,
  APPLY_FAILED_NOT_APPLICABLE,
  APPLY_FAILED_RETRY,
  applyFailureMessage,
  shouldApply,
  toChatItems,
} from './useConsult'

function result(overrides: Partial<SendMessageResult> = {}): SendMessageResult {
  return {
    userMessage: { id: 'u', content: '콧대 올려줘', masked: false },
    assistantMessage: {
      id: 'a',
      sender: 'AI 실장님',
      content: '',
      intent: 'EDIT',
      filtered: false,
    },
    changeRequest: {
      requestId: 'cr',
      status: 'COMPLETE',
      schemaVersion: 'v2',
      actions: [],
      skipped: [],
    },
    needsClarification: false,
    options: [],
    recommendedSliderCode: null,
    morphResult: null,
    ...overrides,
  }
}

describe('shouldApply', () => {
  it('EDIT + COMPLETE면 EDIT-05를 이어서 부른다', () => {
    expect(shouldApply(result())).toBe(true)
  })

  it('되묻기·이미 반영·후보 없음이면 부르지 않는다 (FN-CON-02 수용 1)', () => {
    expect(shouldApply(result({ needsClarification: true }))).toBe(false)
    expect(
      shouldApply(
        result({
          changeRequest: { ...result().changeRequest!, status: 'APPLIED' },
        }),
      ),
    ).toBe(false)
    expect(shouldApply(result({ changeRequest: null }))).toBe(false)
  })
})

describe('toChatItems', () => {
  it('반영 카드에 바로 앞 사용자 문장을 인용하고, 되묻기일 때만 선택지를 둔다', () => {
    const base: Omit<ConsultMessage, 'messageId' | 'role' | 'content'> = {
      sender: null,
      intent: null,
      needsClarification: false,
      options: [],
      changeRequest: null,
      applyResult: null,
      createdAt: '2026-10-25T00:00:00Z',
    }
    const items = toChatItems([
      { ...base, messageId: '1', role: 'USER', content: '콧대 올려줘' },
      {
        ...base,
        messageId: '2',
        role: 'ASSISTANT',
        content: '',
        intent: 'EDIT',
        options: [{ id: 'x', label: '무시' }],
        comparisonCode: 'nose.alar_width',
        applyResult: {
          summary: '콧대 높이 변경',
          applied: [],
          skipped: [],
          seq: 1,
          limited: false,
        },
      },
    ])
    expect(items[1]).toMatchObject({
      role: 'assistant',
      requestText: '콧대 올려줘',
      options: [],
      comparisonCode: 'nose.alar_width',
    })
    expect(items[1].applyResult?.summary).toBe('콧대 높이 변경')
  })

  it('이력에서 원인을 알 수 없는 미적용 요청은 미지원으로 단정하지 않는다', () => {
    const unapplied = (codes: string[]): ConsultMessage => ({
      messageId: codes.join(),
      role: 'ASSISTANT',
      sender: 'AI 실장님',
      content: '바꿔 볼게요.',
      intent: 'EDIT',
      needsClarification: false,
      options: [],
      changeRequest: {
        requestId: 'cr',
        status: 'COMPLETE',
        schemaVersion: 'v2',
        actions: codes.map((code) => ({ code, side: 'both', direction: 1, strength: 'small' })),
        skipped: codes.includes('nose.bridge_height')
          ? [{ source: '눈도 크게 해줘', reason: '눈 편집은 지원하지 않습니다.' }]
          : [],
      },
      applyResult: null,
      createdAt: '2026-10-25T00:00:00Z',
    })
    const [eyeOnly, mixed] = toChatItems([
      unapplied(['eye.tail_angle']),
      unapplied(['eye.tail_angle', 'nose.bridge_height']),
    ])
    expect(eyeOnly.content).toBe('이 요청은 3D에 반영되지 않았어요.')
    expect(mixed.content).toBe(
      `이 요청은 3D에 반영되지 않았어요. 미적용: 눈도 크게 해줘: 눈 편집은 지원하지 않습니다.`,
    )
  })
})

describe('validateTitle', () => {
  it('앞뒤 공백을 빼고 1~20자(서버는 100자까지 받지만 화면은 20자, S15P31B204-838)', () => {
    expect(validateTitle('  ')).not.toBeNull()
    expect(validateTitle('가'.repeat(21))).toBe('시안 이름은 20자까지예요.')
    expect(validateTitle(` ${'가'.repeat(20)} `)).toBeNull()
  })

  it('자동으로 붙는 이름은 20자 안에 든다(S15P31B204-838)', () => {
    expect(validateTitle('2026.11.14 시안 7')).toBeNull()
    expect(validateTitle('2026.11.14 시안 999')).toBeNull()
  })
})

describe('applyFailureMessage — EDIT-05 실패 문구', () => {
  const apiError = (code: string, status = 409) =>
    new ApiError(status, { code, message: '서버 문구', details: [] })

  it('CON_010과 EDIT_030을 서로 다른 문구로 나눈다', () => {
    expect(applyFailureMessage(apiError('CON_010'))).toBe(APPLY_FAILED_NOT_APPLICABLE)
    expect(applyFailureMessage(apiError('EDIT_030'))).toBe(APPLY_FAILED_CHAT_UNSUPPORTED)
    expect(APPLY_FAILED_CHAT_UNSUPPORTED).not.toBe(APPLY_FAILED_NOT_APPLICABLE)
  })

  it('EDIT_030 문구는 재시도를 권하지 않고 슬라이더는 쓸 수 있다고 알린다', () => {
    expect(APPLY_FAILED_CHAT_UNSUPPORTED).toBe(
      '이 3D는 아직 대화로 바로 바꿀 수 없어요. 얼굴은 바꾸지 않았어요.',
    )
    expect(APPLY_FAILED_CHAT_UNSUPPORTED).not.toMatch(/다시 (요청|시도)/)
  })

  it('그 밖의 오류는 잠시 후 다시 요청하라고 안내한다', () => {
    expect(applyFailureMessage(apiError('EDIT_002'))).toBe(APPLY_FAILED_RETRY)
    expect(applyFailureMessage(new Error('네트워크'))).toBe(APPLY_FAILED_RETRY)
  })
})
