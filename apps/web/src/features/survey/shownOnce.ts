/**
 * 설문 안내를 기기에서 한 번만 띄웠는지 남기는 기록(1차 배포 한정, S15P31B204-428·-844).
 * 기기별 localStorage에 남기고, 저장소가 막혀 있으면 이 탭의 메모리에만 기억한다(`features/tutorial/storage`와 같은 방식).
 * 2차 배포 때 이 폴더와 함께 지운다.
 */

/** localStorage에 못 쓴 기록. 새로고침하면 사라진다 */
const memory = new Set<string>()

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function wasShown(key: string): boolean {
  try {
    if (storage()?.getItem(key)) return true
  } catch {
    // 읽기 실패는 처음처럼 다룬다
  }
  return memory.has(key)
}

export function markShown(key: string): void {
  memory.add(key)
  try {
    storage()?.setItem(key, 'shown')
  } catch {
    // 저장이 막혀도 이번 탭에서는 다시 띄우지 않는다(메모리 기록)
  }
}

/** 기록을 지운다(테스트·다시 보기용) */
export function clearShown(key: string): void {
  memory.delete(key)
  try {
    storage()?.removeItem(key)
  } catch {
    // 지우기 실패는 무시한다
  }
}
