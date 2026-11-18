import { EFFECTIVE_AT_V2 } from '@/features/legal/facts'

/**
 * 운영에서 AI 관상을 여는 시각: 동의서·처리방침 v2(-439) 시행일 00:00 KST(2026-11-03, 사용자 결정 2026-11-02).
 * 그 전에는 BE AGENTS.md 보안 절 예외 조건대로 운영에서 켜지 않는다.
 */
export const FACE_READING_OPEN_AT = Date.parse(`${EFFECTIVE_AT_V2}T00:00:00+09:00`)

/**
 * AI 관상을 보여 줄지(S15P31B204-440). FE는 운영·개발을 API 주소만 바꿔 같은 코드로 빌드하므로, 시행 전에는 개발 서버(:8080)와
 * 로컬에서만 켜고 `FACE_READING_OPEN_AT`부터는 어디서나 켠다. 시각은 화면을 그릴 때 한 번 읽는다(자정을 넘겨도 새로고침 전에는 그대로).
 *
 * 시행일이 지나 운영에도 반영되면 이 파일을 지우고 부르는 곳의 분기를 없앤다.
 */
export function isFaceReadingEnabled(
  location: Pick<Location, 'hostname' | 'port'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.location,
  now: number = Date.now(),
): boolean {
  if (!location) return false
  if (now >= FACE_READING_OPEN_AT) return true
  return (
    location.port === '8080' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  )
}
