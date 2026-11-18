import { describe, expect, it } from 'vitest'
import { matchesFilter, SERVICES, servicesOf } from './catalog'

describe('서비스 목록', () => {
  it('탭별 개수: 얼굴 · 스타일 5, AI 도우미 3(2026-10-31 정리 — 모델 · 기록 탭 없음)', () => {
    expect(servicesOf('face')).toHaveLength(5)
    expect(servicesOf('ai')).toHaveLength(3)
    expect(SERVICES.map((item) => item.id)).not.toEqual(
      expect.arrayContaining(['ai-request', 'ai-measure', 'ai-procedure', 'ai-style', 'ai-share']),
    )
    expect(SERVICES.find((item) => item.id === 'ai-face-reading')?.title).toBe('AI 관상')
  })

  it('id가 겹치지 않는다', () => {
    const ids = SERVICES.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('예정 기능에는 이동 버튼이 없고, 쓸 수 있는 기능에는 있다', () => {
    for (const item of SERVICES) {
      if (item.status === 'planned') expect(item.action).toBeUndefined()
      else expect(item.action).toBeDefined()
    }
  })

  it('3D 얼굴 커스텀은 이용 가능이고, 로그인 없이 실험실로 간다', () => {
    const face = SERVICES.find((item) => item.id === 'face-custom')
    expect(face?.status).toBe('available')
    expect(face?.options).toEqual([
      '코 · 이용 가능',
      '눈 · 이용 가능',
      '윤곽 · 이용 가능',
      '체중 · 이용 가능',
    ])
    expect(face?.action).toEqual({ label: '3D 얼굴 체험하기', href: '/lab' })
  })

  it('헤어 스타일은 이용 가능이고, 회원만 내 작업실로 간다(S15P31B204-747, -878)', () => {
    const hair = SERVICES.find((item) => item.id === 'hair')
    expect(hair?.status).toBe('available')
    expect(hair?.description).toContain('로그인하면 내 작업실 편집실에서')
    expect(hair?.action).toMatchObject({ href: '/studio', memberOnly: true })
  })

  it('표정 트래킹은 헤어 바로 다음의 이용 가능 항목이고, 회원만 내 작업실로 간다(S15P31B204-878)', () => {
    const face = servicesOf('face').map((item) => item.id)
    expect(face.indexOf('expression')).toBe(face.indexOf('hair') + 1)
    const expression = SERVICES.find((item) => item.id === 'expression')
    expect(expression?.status).toBe('available')
    // 웹캠 영상을 저장·전송하지 않는다는 것을 먼저 알린다
    expect(expression?.description).toContain('저장하거나 보내지 않아요')
    expect(expression?.description).toContain('로그인하면 내 작업실 편집실에서')
    expect(expression?.action).toMatchObject({ href: '/studio', memberOnly: true })
  })

  it('AI 관상은 이용 가능이고 재미용 안내·회원 전용을 지킨다', () => {
    const reading = SERVICES.find((item) => item.id === 'ai-face-reading')
    expect(reading?.status).toBe('available')
    expect(reading?.description).toContain('의학적·과학적 근거가 없고')
    expect(reading?.action?.memberOnly).toBe(true)
  })

  it('보기 필터: 이용 가능은 예정이 아닌 것, 예정은 예정만', () => {
    const face = servicesOf('face')
    expect(face.filter((item) => matchesFilter(item, 'all'))).toHaveLength(5)
    expect(face.filter((item) => matchesFilter(item, 'available')).map((i) => i.id)).toEqual([
      'face-custom',
      'hair',
      'expression',
    ])
    expect(face.filter((item) => matchesFilter(item, 'planned'))).toHaveLength(2)
    // 이용 가능 필터는 일부 체험(AI 실장님 상담)도 담는다
    expect(
      servicesOf('ai')
        .filter((item) => matchesFilter(item, 'available'))
        .map((i) => i.id),
    ).toContain('ai-consult')
  })

  it('상담은 코·눈·윤곽·체중을 다룬다. 예정 부위 칩이 남지 않는다', () => {
    const consult = SERVICES.find((item) => item.id === 'ai-consult')
    expect(consult?.options).toEqual([
      '코 · 이용 가능',
      '눈 · 이용 가능',
      '윤곽 · 이용 가능',
      '체중 · 이용 가능',
    ])
    for (const item of SERVICES) {
      for (const option of item.options) expect(option).not.toMatch(/예정$/)
    }
  })
})
