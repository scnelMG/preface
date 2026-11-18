import { dismissToast, toast, type ToastOptions } from '@/shared/ui'

/**
 * 실험실 편집 알림(슬라이더 저장·되돌리기·앞으로 가기·처음으로·저장 실패·충돌) 자리. 한 번에 하나만 띄운다.
 * 새 알림이 오면 앞 알림을 걷고 바꾼다. 같은 화면의 다른 토스트(막힌 탭 안내 등)는 건드리지 않는다.
 *
 * 전역 Toast를 바꾸지 않은 이유: 다른 화면(업로드·작업실 등)은 여러 알림이 함께 떠야 하는 경우가 있고,
 * 이번 정리는 편집 알림이 쌓이는 문제만 다룬다.
 */
let current: number | null = null

export function feedbackToast(message: string, options?: ToastOptions): number {
  if (current !== null) dismissToast(current)
  current = toast(message, options)
  return current
}

/**
 * 편집 동작 순번. 슬라이더·눈 저장, 되돌리기·앞으로 가기, 처음으로를 요청할 때마다 하나씩 올린다.
 * 저장은 한 줄로 서서 늦게 끝나므로, 응답이 왔을 때 더 새 동작이 있으면 그 동작의 알림(`…로 되돌렸어요`·한계 안내)을 띄우지 않는다.
 * 처음으로를 누른 뒤 앞에 줄 선 저장들이 끝나며 알림이 차례로 바뀌어 하나씩 되돌리는 것처럼 보이던 문제(S15P31B204-727).
 */
let latestAction = 0

/** 새 편집 동작을 시작한다. 돌려받은 번호로 나중에 `isLatestEditAction`을 묻는다 */
export function beginEditAction(): number {
  latestAction += 1
  return latestAction
}

/** 이 번호 뒤에 요청한 편집 동작이 없는지 */
export function isLatestEditAction(action: number): boolean {
  return action === latestAction
}
