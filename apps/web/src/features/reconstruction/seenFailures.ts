/**
 * 확인한 실패. 진행 팝업 자리의 실패 카드(`FailedDockCard`)를 누르거나 실패 안내(SCR-09)를 보면 다시 띄우지 않으려고 둔다.
 *
 * API-REC-03 `includeRecentFailed=true`는 끝난 지 24시간 안의 실패를 계속 돌려준다. 서버에 '확인함' 기록이 없어
 * 기기별 localStorage에 jobId만 남긴다(얼굴·영상 정보는 넣지 않는다). 다른 기기에서는 다시 보일 수 있다.
 * 저장소가 막혀 있으면 이 탭의 메모리에만 기억한다.
 */
// 비밀값이 아니라 localStorage 키 이름이다
export const SEEN_FAILURES_STORAGE_KEY = 'preface.reconstruction.seenFailures.v1' // gitleaks:allow

/** 실패는 24시간만 돌아오므로 최근 몇 개만 남기면 된다 */
const MAX_KEPT = 20

/** localStorage에 못 쓴 기록. 새로고침하면 사라진다 */
const seenInMemory = new Set<string>()

function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_FAILURES_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    // 읽기 실패는 본 적 없는 것으로 본다
    return []
  }
}

export function markFailureSeen(jobId: string): void {
  seenInMemory.add(jobId)
  try {
    const kept = readStored().filter((id) => id !== jobId)
    window.localStorage.setItem(
      SEEN_FAILURES_STORAGE_KEY,
      JSON.stringify([...kept, jobId].slice(-MAX_KEPT)),
    )
  } catch {
    // 저장이 막혀도 이번 탭에서는 다시 띄우지 않는다(메모리 기록)
  }
}

export function isFailureSeen(jobId: string): boolean {
  return seenInMemory.has(jobId) || readStored().includes(jobId)
}

/** 테스트용 */
export function resetSeenFailures(): void {
  seenInMemory.clear()
  try {
    window.localStorage.removeItem(SEEN_FAILURES_STORAGE_KEY)
  } catch {
    // 지우지 못해도 메모리 기록은 지웠다
  }
}
