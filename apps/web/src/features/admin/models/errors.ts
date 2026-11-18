import { ApiError } from '@/shared/api/ApiError'

export const INVALID_USER_ID = '사용자 ID 형식이 맞지 않아요'

/**
 * 관리자 조회 실패 문구. `what`은 조사까지 붙여 받는다(예: "모델 목록을").
 * 서명 URL이나 응답 본문은 문구에 넣지 않는다.
 *
 * `userScoped`: 경로에 userId가 들어간 조회(모델 목록·저장소). UUID가 아니면 서버가 400(INVALID_REQUEST)을 준다.
 */
export function adminErrorMessage(error: unknown, what: string, userScoped = false): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && userScoped) return INVALID_USER_ID
    if (error.status === 401) return '로그인이 필요해요'
    if (error.status === 403) return '관리자만 볼 수 있어요'
    if (error.status === 404) return `${what} 찾지 못했어요`
  }
  return `${what} 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요`
}
