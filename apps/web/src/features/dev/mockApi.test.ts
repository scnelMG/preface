import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { API_BASE_URL } from '@/shared/config/env'
import { installMockApi } from './mockApi'

const realFetch = window.fetch

beforeAll(() => {
  // 가로채지 않는 요청은 없어야 한다(이 테스트는 API 주소만 부른다)
  window.fetch = vi.fn(() => Promise.reject(new Error('실제 네트워크'))) as typeof fetch
  window.localStorage.clear()
  installMockApi('member')
})

afterAll(() => {
  window.fetch = realFetch
  window.localStorage.clear()
})

async function call(path: string, init?: RequestInit) {
  const response = await window.fetch(`${API_BASE_URL}${path}`, init)
  return ((await response.json()) as { data: unknown }).data
}

const patch = (title: string): RequestInit => ({
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title }),
})

describe('개발용 가짜 API — 이름 바꾸기 기억 (S15P31B204-838)', () => {
  it('작업실에서 바꾼 모델 이름을 모델 목록(편집실 제목 아래 이름의 출처)이 돌려준다', async () => {
    const saved = (await call('/face-models/dev-head-1', patch('  바꾼 모델  '))) as {
      title: string
    }
    expect(saved.title).toBe('바꾼 모델')
    const list = (await call('/face-models?page=0&size=50')) as {
      items: { faceModelId: string; title: string }[]
    }
    expect(list.items.find((item) => item.faceModelId === 'dev-head-1')?.title).toBe('바꾼 모델')
    // 시안 상세의 faceModelId가 그 모델을 가리킨다
    const sim = (await call('/simulations/dev-sim-1')) as { faceModelId: string }
    expect(sim.faceModelId).toBe('dev-head-1')
  })

  it('바꾼 시안 이름을 시안 상세·목록이 돌려준다', async () => {
    await call('/simulations/dev-sim-1', patch('새 시안 이름'))
    expect(((await call('/simulations/dev-sim-1')) as { title: string }).title).toBe('새 시안 이름')
    const list = (await call('/simulations?page=0&size=20')) as {
      items: { simulationId: string; title: string }[]
    }
    expect(list.items.find((item) => item.simulationId === 'dev-sim-1')?.title).toBe('새 시안 이름')
  })
})
