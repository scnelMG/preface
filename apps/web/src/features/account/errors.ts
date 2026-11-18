import { ApiError, NetworkError } from '@/shared/api/ApiError'

const RETRY = '잠시 후 다시 시도해 주세요.'

/**
 * 위험한 동작(탈퇴·로그아웃)이 실패했을 때 문구. 서버 `message`가 있으면 그대로 붙인다(apps/web/AGENTS.md "API 연동").
 * 서버 내부 오류(500)·네트워크 오류는 재시도를 안내한다.
 */
export function failureMessage(head: string, error: unknown): string {
  if (error instanceof NetworkError) return `${head} ${error.message}`
  if (error instanceof ApiError && error.status < 500 && error.message)
    return `${head} ${error.message}`
  return `${head} ${RETRY}`
}
