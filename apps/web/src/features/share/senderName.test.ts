import { describe, expect, it } from 'vitest'
import { checkSenderName, nameMaxLength, senderNameLength } from './senderName'

describe('checkSenderName', () => {
  it('비었거나 공백뿐이면 이름 없음이다', () => {
    expect(checkSenderName('')).toEqual({ ok: true, name: null })
    expect(checkSenderName('   ')).toEqual({ ok: true, name: null })
  })

  it('앞뒤 공백을 지운다', () => {
    expect(checkSenderName('  지은 ')).toEqual({ ok: true, name: '지은' })
  })

  it('글자 수는 코드 포인트로 센다', () => {
    expect(checkSenderName('😀'.repeat(20))).toEqual({ ok: true, name: '😀'.repeat(20) })
    expect(checkSenderName('가'.repeat(21))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('제어·서식 문자는 받지 않는다', () => {
    for (const raw of ['지\n은', '지은\u0000', '‮지은', '지​은'])
      expect(checkSenderName(raw)).toEqual({ ok: false, reason: 'invalid-char' })
  })
})

describe('nameMaxLength', () => {
  it('비어 있으면 20이고, 코드 포인트로 남은 글자만큼만 더 받는다', () => {
    expect(nameMaxLength('')).toBe(20)
    expect(nameMaxLength('가'.repeat(5))).toBe(20)
    // 이모지는 UTF-16 두 칸이지만 1자다: 이모지 5개(10칸) + 남은 15자
    expect(nameMaxLength('😀'.repeat(5))).toBe(25)
    expect(senderNameLength('😀'.repeat(5))).toBe(5)
  })

  it('20자를 넘게 붙였으면 지금 길이에서 더 늘지 않는다', () => {
    expect(nameMaxLength('가'.repeat(25))).toBe(25)
  })
})
