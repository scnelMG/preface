import { describe, expect, it } from 'vitest'
import { safeReturnTo } from './oauthSession'

describe('safeReturnTo', () => {
  it('같은 사이트의 경로만 받는다', () => {
    expect(safeReturnTo('/studio')).toBe('/studio')
    expect(safeReturnTo('/simulations/s-1?tab=ai')).toBe('/simulations/s-1?tab=ai')
  })

  it('외부 주소는 버린다 (open redirect 방지)', () => {
    expect(safeReturnTo('https://evil.example')).toBeNull()
    expect(safeReturnTo('//evil.example')).toBeNull()
    expect(safeReturnTo('/\\evil.example')).toBeNull()
    expect(safeReturnTo('')).toBeNull()
    expect(safeReturnTo(null)).toBeNull()
  })

  it('브라우저가 지우는 탭·줄바꿈이나 역슬래시로 감싼 외부 주소도 버린다', () => {
    // new URL('/\t/evil.com', origin)은 https://evil.com/ 이 된다
    expect(safeReturnTo('/\t/evil.example')).toBeNull()
    expect(safeReturnTo('/\n/evil.example')).toBeNull()
    expect(safeReturnTo('/\r/evil.example')).toBeNull()
    expect(safeReturnTo('/\\\\evil.example')).toBeNull()
    expect(safeReturnTo('/studio\\..\\x')).toBeNull()
    expect(safeReturnTo('/ /evil.example')).toBeNull()
    expect(safeReturnTo('/\u0000/evil.example')).toBeNull()
  })

  it('풀리지 않은 퍼센트 문자열은 경로 글자로 남아 같은 사이트 안이므로 받는다', () => {
    // ?returnTo= 값은 URLSearchParams가 먼저 풀어 탭이 된 뒤 여기서 걸린다.
    // 풀리지 않은 채 오면 router에서도 /%09/evil.example 경로 그대로다
    expect(safeReturnTo('/%09/evil.example')).toBe('/%09/evil.example')
    expect(
      safeReturnTo(new URLSearchParams('returnTo=/%09/evil.example').get('returnTo')),
    ).toBeNull()
  })

  it('로그인·가입·콜백 화면으로는 돌아가지 않는다', () => {
    expect(safeReturnTo('/login')).toBeNull()
    expect(safeReturnTo('/signup?x=1')).toBeNull()
    expect(safeReturnTo('/oauth/kakao?code=c')).toBeNull()
  })
})
