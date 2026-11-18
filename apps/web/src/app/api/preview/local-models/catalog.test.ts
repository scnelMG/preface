import { afterEach, describe, it, expect, vi } from 'vitest'
import { isLocalDevelopment } from './catalog'
import { GET } from './route'
afterEach(() => vi.unstubAllEnvs())
describe('로컬 모델 제공 범위', () => {
  it('운영 환경에서는 localhost여도 파일을 제공하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const response = await GET(new Request('http://127.0.0.1:3002/api/preview/local-models'))
    expect(response.status).toBe(404)
  })
  it('개발 환경에서도 외부 호스트는 거절한다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isLocalDevelopment(new Request('https://example.com/api/preview/local-models'))).toBe(
      false,
    )
    expect(isLocalDevelopment(new Request('http://127.0.0.1:3002/api/preview/local-models'))).toBe(
      true,
    )
  })
})
