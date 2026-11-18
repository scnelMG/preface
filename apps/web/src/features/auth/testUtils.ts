import { vi } from 'vitest'

/** 테스트용 가짜 fetch 응답. 공통 응답 `{ success, data, error }` 모양 */
export function ok<T>(data: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({ success: true, data, error: null }),
  } as unknown as Response
}

export function fail(status: number, code: string, message = '실패') {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, data: null, error: { code, message, details: [] } }),
  } as unknown as Response
}

type Route = [method: string, pathPart: string, response: Response | (() => Response)]

/**
 * 경로별 가짜 fetch. 먼저 맞는 항목을 쓰고 지운다(같은 경로를 여러 번 등록하면 순서대로 나간다).
 * 등록되지 않은 요청은 실패시킨다.
 */
export function routeFetch(routes: Route[]) {
  const queue = [...routes]
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const index = queue.findIndex(([m, part]) => m === method && url.includes(part))
    if (index < 0) throw new Error(`예상하지 못한 요청: ${method} ${url}`)
    const [, , response] = queue.splice(index, 1)[0]
    return typeof response === 'function' ? response() : response
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** 호출 목록에서 경로가 들어간 요청만 */
export function callsTo(mock: ReturnType<typeof vi.fn>, pathPart: string) {
  return mock.mock.calls.filter(([input]) => String(input).includes(pathPart))
}
