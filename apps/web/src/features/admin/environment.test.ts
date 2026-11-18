import { describe, expect, it } from 'vitest'
import { ADMIN_ENV_ORIGINS, environmentUrl } from './environment'

describe('운영 | 개발 탭 주소', () => {
  it('운영은 기본 HTTPS 포트, 개발은 같은 호스트의 8080(Caddyfile)', () => {
    expect(ADMIN_ENV_ORIGINS).toEqual({
      prod: 'https://preface.example.com',
      dev: 'https://preface.example.com:8080',
    })
  })

  it('경로와 쿼리는 그대로 두고 출처만 바꾼다', () => {
    expect(environmentUrl('dev', '/admin/jobs', 'status=FAILED&page=2')).toBe(
      'https://preface.example.com:8080/admin/jobs?status=FAILED&page=2',
    )
    expect(environmentUrl('prod', '/admin/jobs/abc', '?x=1')).toBe(
      'https://preface.example.com/admin/jobs/abc?x=1',
    )
  })

  it('쿼리가 없으면 물음표를 붙이지 않는다', () => {
    expect(environmentUrl('prod', '/admin')).toBe('https://preface.example.com/admin')
    expect(environmentUrl('dev', '/admin', '?')).toBe('https://preface.example.com:8080/admin')
  })
})
