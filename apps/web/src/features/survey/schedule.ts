import { useSyncExternalStore } from 'react'

/**
 * 1차 배포 설문을 닫는 시각(S15P31B204-851). 2026-11-17 0시(KST)부터 설문 UI를 모두 숨긴다.
 * 설문 칩(`SurveyButton`)·3D 완성 안내(`SurveyPopup`)·편집실 완료 뒤 설문 창(`SurveyAfterDone`, -844)이 모두 이 값 하나를 본다.
 * 사용처는 바꾸지 않아도 된다 — 각 컴포넌트가 안에서 `useSurveyOpen()`으로 스스로 숨는다.
 * 행사 종료 뒤 정리: 이 파일과 features/survey 폴더, 사용처를 함께 지운다.
 */
export const SURVEY_ENDS_AT = Date.parse('2026-11-17T00:00:00+09:00')

/** 화면을 열어 둔 채 마감을 넘겨도 닫히도록 다시 보는 간격. 기기가 잠들어 예약한 타이머가 밀려도 1분 안에 따라잡는다 */
const RECHECK_MS = 60_000

/** 지금(기본은 현재 시각) 설문을 받는 중인지 */
export function isSurveyOpen(now: number = Date.now()): boolean {
  return now < SURVEY_ENDS_AT
}

function subscribe(onChange: () => void) {
  const interval = window.setInterval(onChange, RECHECK_MS)
  // 마감 시각에 바로 닫히게 한 번 더 예약한다. setTimeout은 약 24.8일(2^31-1ms)을 넘기면 바로 불리므로 그 안일 때만 건다
  const left = SURVEY_ENDS_AT - Date.now()
  const timeout = left > 0 && left < 2 ** 31 - 1 ? window.setTimeout(onChange, left) : undefined
  return () => {
    window.clearInterval(interval)
    if (timeout !== undefined) window.clearTimeout(timeout)
  }
}

function getSnapshot() {
  return isSurveyOpen()
}

/** 서버와 하이드레이션 첫 그림은 숨긴 상태로 둔다. 시각은 브라우저에서 정한다(하이드레이션 불일치 방지) */
function getServerSnapshot() {
  return false
}

/** 설문을 받는 중인지. 마감 시각이 지나면 열려 있는 화면에서도 저절로 false가 된다 */
export function useSurveyOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
