/**
 * 브라우저 알림(Notification API). FN-REC-03 "성공·실패 시 인앱 알림 + 권한 허용 시 브라우저 알림".
 *
 * - 권한이 없거나(거부·미지원) 생성자가 막힌 기기(모바일 Chrome 등, 서비스 워커 필요)에서는 아무것도 하지 않는다.
 *   인앱 알림(헤더 점·알림 목록·진행 팝업 토스트)만 남는다.
 * - 권한 요청은 브라우저가 사용자 동작(클릭) 안에서만 허용한다. `requestBrowserNotificationPermission`은
 *   반드시 버튼 onClick 안에서 부른다. 화면 진입 때 자동으로 부르지 않는다.
 *   지금은 머리 추가(PC)의 "영상 촬영하기" 클릭이 부른다(`features/capture-link/NewHeadFlow`).
 * - 진행 팝업(-196, `announceFinished`)과 헤더 조회기(`unread.ts`)가 모두 이 helper로 띄운다. 같은 tag
 *   (`preface-recon`)라 두 곳이 같은 완료를 알려도 브라우저가 한 장으로 바꿔 끼운다.
 */

export type BrowserNotificationPermission = NotificationPermission | 'unsupported'

/** 복원 완료 알림 tag. 같은 tag의 알림은 쌓이지 않고 바뀐다 */
export const RECON_NOTIFICATION_TAG = 'preface-recon'

function supported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

/** 지금 권한 상태. 서버·미지원 브라우저는 'unsupported' */
export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  return supported() ? Notification.permission : 'unsupported'
}

/**
 * 권한을 묻는다. **사용자 클릭 안에서만** 부른다.
 * 이미 정해졌으면(granted·denied) 다시 묻지 않고 그 값을 돌려준다.
 */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!supported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export interface ShowBrowserNotificationOptions {
  body?: string
  /** 같은 tag는 한 장으로 바뀐다. 기본 RECON_NOTIFICATION_TAG */
  tag?: string
  /** 알림을 누르면. 창을 앞으로 가져온 뒤 부른다 */
  onClick?: () => void
  /** true면 탭이 보이는 동안은 띄우지 않는다(보이는 화면에는 인앱 알림이 있다). 기본 true */
  onlyWhenHidden?: boolean
}

/**
 * 권한이 있으면 브라우저 알림을 띄운다. 띄웠으면 true, 아니면(권한 없음·탭이 보임·생성자 막힘) false.
 * false면 호출부는 인앱 알림만 쓴다.
 */
// ── 켜기/끄기(2026-10-30): 권한과 별개로 이 기기에서 받을지 사용자가 정한다. 값이 없으면 켬 ──
const PREF_KEY = 'preface.browserNotifications'
const PREF_EVENT = 'preface:browser-notifications'

/** 이 기기에서 브라우저 알림을 받기로 했는지. 저장소를 못 읽으면 켬으로 본다 */
export function getBrowserNotificationEnabled(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setBrowserNotificationEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // 저장소가 막힌 창(시크릿 등)은 이번 방문 동안만 화면 상태로 남는다
  }
  window.dispatchEvent(new Event(PREF_EVENT))
}

/** useSyncExternalStore용: 켜기/끄기와 권한 변화(다른 탭 포함)를 듣는다 */
export function subscribeBrowserNotificationSettings(onChange: () => void): () => void {
  window.addEventListener(PREF_EVENT, onChange)
  window.addEventListener('storage', onChange)
  window.addEventListener('focus', onChange)
  return () => {
    window.removeEventListener(PREF_EVENT, onChange)
    window.removeEventListener('storage', onChange)
    window.removeEventListener('focus', onChange)
  }
}

export function showBrowserNotification(
  title: string,
  {
    body,
    tag = RECON_NOTIFICATION_TAG,
    onClick,
    onlyWhenHidden = true,
  }: ShowBrowserNotificationOptions = {},
): boolean {
  if (!supported() || Notification.permission !== 'granted') return false
  if (!getBrowserNotificationEnabled()) return false
  if (onlyWhenHidden && document.visibilityState !== 'hidden') return false
  try {
    const notification = new Notification(title, { body, tag })
    notification.onclick = () => {
      window.focus()
      onClick?.()
      notification.close()
    }
    return true
  } catch {
    // 모바일 Chrome 등은 생성자를 막는다(서비스 워커 필요). 인앱 알림으로 충분하다
    return false
  }
}
