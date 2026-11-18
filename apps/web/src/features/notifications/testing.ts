import { vi } from 'vitest'
import type { AppNotification, NotificationList } from './types'

/** 테스트용 알림. 합성 값만 쓴다 */
export function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    notificationId: 'n-1',
    type: 'RECON_SUCCEEDED',
    title: '새 모델이 완성됐어요',
    body: '작업실에서 확인해 보세요.',
    target: { kind: 'FACE_MODEL', id: 'fm-1' },
    readAt: null,
    createdAt: '2026-10-22T06:35:00Z',
    ...overrides,
  }
}

export function list(
  items: AppNotification[],
  overrides: Partial<NotificationList> = {},
): NotificationList {
  return {
    items,
    page: 0,
    size: 20,
    totalElements: items.length,
    unreadCount: items.filter((n) => !n.readAt).length,
    ...overrides,
  }
}

/** Notification API 흉내. permission을 바꿔 가며 쓴다 */
export class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
  static instances: FakeNotification[] = []
  onclick: (() => void) | null = null
  close = vi.fn()
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this)
  }
}

export function installFakeNotification(permission: NotificationPermission) {
  FakeNotification.permission = permission
  FakeNotification.instances = []
  FakeNotification.requestPermission.mockReset()
  FakeNotification.requestPermission.mockImplementation(async () => {
    FakeNotification.permission = 'granted'
    return 'granted'
  })
  vi.stubGlobal('Notification', FakeNotification)
}

/** jsdom의 document.visibilityState는 늘 visible이다. 탭을 숨긴 것처럼 만든다 */
export function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}
