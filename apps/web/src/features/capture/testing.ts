/**
 * 테스트용 가짜 응답. fetch를 vi.fn()으로 바꾼 뒤 mockResolvedValueOnce에 넣는다.
 * 실제 토큰·URL을 쓰지 않는다.
 */
export function okResponse<T>(data: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({ success: true, data, error: null }),
  } as unknown as Response
}

export function failResponse(status: number, code: string, details: unknown[] = []) {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      data: null,
      error: { code, message: '서버 문구', details },
    }),
  } as unknown as Response
}

export const EXCHANGE_OK = {
  captureSessionToken: 'capture-session-token',
  expiresIn: 1800,
  linkId: 'lk-1',
  user: { nickname: '민서', maskedEmail: 'm***@kakao.com' },
}
