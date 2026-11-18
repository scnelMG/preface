/**
 * 튜토리얼을 끝냈는지(완료·건너뛰기) 기기별로 기억한다(REQ-F-09, FN-REC-04 "기기별 localStorage").
 *
 * - 서버에 보내지 않는다. 같은 기기·브라우저에서만 다시 띄우지 않으면 된다.
 * - 저장소가 막혀 있어도(사생활 보호 모드, 저장 공간 가득, 쿠키 차단) 화면은 그대로 동작해야 한다.
 *   읽기·쓰기는 모두 try/catch로 감싸고, 쓰기에 실패하면 이 탭의 메모리에만 기억한다.
 * - 키 이름에 버전을 넣는다. 단계가 크게 바뀌면 `v2`로 올려 모두에게 다시 보여 준다.
 */
export const TUTORIAL_STORAGE_KEY = 'preface.tutorial.v1'

/**
 * 메인 체험 튜토리얼(2026-11-02). 10/30 재구성으로 단계 내용·조작이 바뀌어 v1을 끝낸 기기에도 한 번 다시 보인다
 */
export const MAIN_TUTORIAL_STORAGE_KEY = 'preface.tutorial.v2'
/** 편집실 첫 사용 안내(2026-11-03). 메인과 따로 기록한다 */
export const EDITOR_TUTORIAL_STORAGE_KEY = 'preface.tutorial.editor.v1'
/** 체험 실험실(`/lab`) 첫 사용 안내(S15P31B204-746). 메인·편집실과 따로 기록한다 */
export const GUEST_LAB_TUTORIAL_STORAGE_KEY = 'preface.tutorial.guest-lab.v1'

/** 끝낸 방식. 다시 띄우지 않는 데는 차이가 없지만, 나중에 지표를 볼 수 있게 남긴다 */
export type TutorialRecord = 'completed' | 'skipped'

function isRecord(value: unknown): value is TutorialRecord {
  return value === 'completed' || value === 'skipped'
}

/** localStorage에 못 쓴 기록. 새로고침하면 사라진다 */
const memory = new Map<string, TutorialRecord>()
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // 일부 브라우저는 저장소를 막으면 접근만 해도 SecurityError를 던진다
    return null
  }
}

export function readTutorialRecord(key: string = TUTORIAL_STORAGE_KEY): TutorialRecord | null {
  try {
    const value = storage()?.getItem(key)
    if (isRecord(value)) return value
  } catch {
    // 읽기 실패는 처음 방문처럼 다룬다. 메모리에 남은 기록이 있으면 그걸 쓴다
  }
  return memory.get(key) ?? null
}

export function writeTutorialRecord(
  record: TutorialRecord,
  key: string = TUTORIAL_STORAGE_KEY,
): void {
  memory.set(key, record)
  try {
    storage()?.setItem(key, record)
  } catch {
    // 저장이 막혀도 이번 탭에서는 다시 띄우지 않는다(메모리 기록)
  }
  notify()
}

/** 확인용 페이지의 "다시 보기"와 테스트에서 쓴다 */
export function clearTutorialRecord(key: string = TUTORIAL_STORAGE_KEY): void {
  memory.delete(key)
  try {
    storage()?.removeItem(key)
  } catch {
    // 지우지 못해도 메모리 기록은 지웠다
  }
  notify()
}

function notify() {
  for (const listener of listeners) listener()
}

/** useSyncExternalStore용. 다른 탭에서 바꾼 것(storage 이벤트)도 따라간다 */
export function subscribeTutorialRecord(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}
