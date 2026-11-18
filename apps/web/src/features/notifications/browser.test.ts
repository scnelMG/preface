import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  setBrowserNotificationEnabled,
  showBrowserNotification,
} from './browser'
import { FakeNotification, installFakeNotification, setVisibility } from './testing'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.removeItem('preface.browserNotifications')
  setVisibility('visible')
})

describe('브라우저 알림', () => {
  it('지원하지 않으면 unsupported이고 아무것도 띄우지 않는다', async () => {
    vi.stubGlobal('Notification', undefined)
    expect(getBrowserNotificationPermission()).toBe('unsupported')
    expect(await requestBrowserNotificationPermission()).toBe('unsupported')
    expect(showBrowserNotification('완성')).toBe(false)
  })

  it('거부했으면 다시 묻지 않고 띄우지도 않는다(인앱만)', async () => {
    installFakeNotification('denied')
    setVisibility('hidden')
    expect(await requestBrowserNotificationPermission()).toBe('denied')
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    expect(showBrowserNotification('완성')).toBe(false)
    expect(FakeNotification.instances).toHaveLength(0)
  })

  it('권한이 있어도 이 기기에서 끈 사용자에게는 띄우지 않는다(2026-10-30)', () => {
    installFakeNotification('granted')
    setVisibility('hidden')
    setBrowserNotificationEnabled(false)
    expect(showBrowserNotification('완성')).toBe(false)
    setBrowserNotificationEnabled(true)
    expect(showBrowserNotification('완성')).toBe(true)
  })

  it('아직 안 물었으면 묻는다', async () => {
    installFakeNotification('default')
    expect(await requestBrowserNotificationPermission()).toBe('granted')
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('권한이 있어도 탭이 보이면 띄우지 않는다(기본)', () => {
    installFakeNotification('granted')
    setVisibility('visible')
    expect(showBrowserNotification('완성')).toBe(false)
    expect(showBrowserNotification('완성', { onlyWhenHidden: false })).toBe(true)
  })

  it('탭이 숨겨져 있고 권한이 있으면 띄우고, 누르면 onClick을 부른다', () => {
    installFakeNotification('granted')
    setVisibility('hidden')
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const onClick = vi.fn()
    expect(showBrowserNotification('완성', { body: '확인해 보세요', onClick })).toBe(true)
    const shown = FakeNotification.instances[0]
    expect(shown.title).toBe('완성')
    expect(shown.options).toEqual({ body: '확인해 보세요', tag: 'preface-recon' })
    shown.onclick?.()
    expect(focus).toHaveBeenCalled()
    expect(onClick).toHaveBeenCalled()
    expect(shown.close).toHaveBeenCalled()
  })

  it('생성자가 막힌 기기에서는 false', () => {
    installFakeNotification('granted')
    setVisibility('hidden')
    class Throwing {
      static permission = 'granted'
      constructor() {
        throw new TypeError('Illegal constructor')
      }
    }
    vi.stubGlobal('Notification', Throwing)
    expect(showBrowserNotification('완성')).toBe(false)
  })
})
