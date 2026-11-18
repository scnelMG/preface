import { afterEach, describe, expect, it } from 'vitest'
import {
  clearLinkTokenFromUrl,
  parseLinkToken,
  parseSameDevice,
  qrUrlForPage,
  sameDeviceCaptureUrl,
  takeLinkFromUrl,
} from './linkToken'

describe('parseLinkToken', () => {
  it('fragment의 t 값을 꺼낸다', () => {
    expect(parseLinkToken('#t=abc-123_XYZ')).toBe('abc-123_XYZ')
  })

  it('# 없이 와도 읽는다', () => {
    expect(parseLinkToken('t=abc')).toBe('abc')
  })

  it('다른 값과 섞여 있어도 t만 꺼낸다', () => {
    expect(parseLinkToken('#x=1&t=abc&y=2')).toBe('abc')
  })

  it('퍼센트 인코딩을 푼다', () => {
    expect(parseLinkToken('#t=a%2Bb%3D')).toBe('a+b=')
  })

  it.each(['', '#', '#t=', '#token=abc'])('토큰이 없으면 null (%s)', (hash) => {
    expect(parseLinkToken(hash)).toBeNull()
  })
})

describe('주소창에서 토큰 지우기', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('경로와 쿼리는 남기고 fragment만 지운다', () => {
    window.history.replaceState(null, '', '/m/capture?from=qr#t=secret')

    clearLinkTokenFromUrl()

    expect(window.location.pathname).toBe('/m/capture')
    expect(window.location.search).toBe('?from=qr')
    expect(window.location.hash).toBe('')
  })

  it('읽으면서 바로 지운다', () => {
    window.history.replaceState(null, '', '/m/capture#t=secret')
    const before = window.history.length

    expect(takeLinkFromUrl().token).toBe('secret')
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('secret')
    // 방문 기록을 새로 쌓지 않는다(뒤로 가기로 토큰 주소에 돌아가지 않게)
    expect(window.history.length).toBe(before)
  })

  it('두 번째로 읽으면 토큰이 없다 — 새로고침해도 같은 토큰을 다시 교환하지 않는다', () => {
    window.history.replaceState(null, '', '/m/capture#t=secret')

    takeLinkFromUrl()

    expect(takeLinkFromUrl().token).toBeNull()
  })
})

describe('같은 기기 촬영(-457)', () => {
  it('QR 주소의 경로·토큰을 지금 사이트에 붙이고 같은 기기 표시를 단다', () => {
    const url = sameDeviceCaptureUrl(
      'https://qr.example.test/m/capture#t=fake',
      'https://app.example.test',
    )
    expect(url).toBe('https://app.example.test/m/capture#t=fake&self=1')
    const hash = new URL(url).hash
    expect(parseLinkToken(hash)).toBe('fake')
    expect(parseSameDevice(hash)).toBe(true)
  })

  it('QR로 들어오면 같은 기기가 아니다', () => {
    expect(parseSameDevice('#t=fake')).toBe(false)
  })
})

describe('촬영 디버그 수치를 QR로 켜기(-716)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('PC 주소가 ?debug=1이면 QR fragment에 debug=1을 붙인다', () => {
    const url = qrUrlForPage('https://app.example.test/m/capture#t=fake', '?debug=1')
    expect(url).toBe('https://app.example.test/m/capture#t=fake&debug=1')
    expect(parseLinkToken(new URL(url).hash)).toBe('fake')
  })

  it.each(['', '?x=1', '?debug=0'])(
    'PC 주소에 debug=1이 없으면 QR을 그대로 둔다 (%s)',
    (search) => {
      expect(qrUrlForPage('https://app.example.test/m/capture#t=fake', search)).toBe(
        'https://app.example.test/m/capture#t=fake',
      )
    },
  )

  it('휴대폰은 fragment의 debug=1을 쿼리로 옮기고 토큰은 지운다', () => {
    window.history.replaceState(null, '', '/m/capture#t=secret&debug=1')

    expect(takeLinkFromUrl().token).toBe('secret')
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('secret')
    // 촬영 화면(LiveCapture)은 쿼리의 debug=1을 읽는다. 쿼리라 새로고침해도 남는다
    expect(new URLSearchParams(window.location.search).get('debug')).toBe('1')
  })

  it('원래 쿼리는 지키고 debug=1을 덧붙인다', () => {
    window.history.replaceState(null, '', '/m/capture?from=qr#t=secret&debug=1')

    takeLinkFromUrl()

    const q = new URLSearchParams(window.location.search)
    expect(q.get('from')).toBe('qr')
    expect(q.get('debug')).toBe('1')
  })

  it('fragment에 debug가 없으면 쿼리를 바꾸지 않는다', () => {
    window.history.replaceState(null, '', '/m/capture?from=qr#t=secret')

    takeLinkFromUrl()

    expect(window.location.search).toBe('?from=qr')
  })
})
