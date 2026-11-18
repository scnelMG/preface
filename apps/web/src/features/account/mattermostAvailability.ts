import { useSyncExternalStore } from 'react'
import { isProductionHost } from '@/shared/analytics/config'

/**
 * 운영에서 Mattermost 알림을 열지(S15P31B204-543). 처음에는 처리방침 2026-12-v1 전까지 운영에서 숨겼으나(-517), 완성 알림이 꼭
 * 필요해 별도 동의(4항목 고지)로 바로 연다. 처리방침은 2026-11-v3(11-03)에 넣었다. 다시 닫아야 하면 이 값을 false로 바꾼다
 * (서버도 막으려면 운영 webhook을 비운다, 등록 시 NOTI_001).
 */
export const MATTERMOST_NOTIFY_IN_PRODUCTION = true

/** Mattermost 알림(아이디 입력·등록)을 보여도 되는 주소인가. 내 정보 설정과 3D 대기 화면 입력칸(-524)이 같이 쓴다 */
export function isMattermostNotifyAvailable(host: string): boolean {
  return MATTERMOST_NOTIFY_IN_PRODUCTION || !isProductionHost(host)
}

function subscribe() {
  return () => {}
}

/** 화면에서 쓰는 값. 미리 그리는 단계(서버)에서는 숨긴 쪽으로 시작하고, 브라우저에서 주소를 보고 정한다 */
export function useMattermostNotifyAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isMattermostNotifyAvailable(window.location.host),
    () => false,
  )
}
