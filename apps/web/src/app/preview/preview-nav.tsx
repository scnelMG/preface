'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import {
  BellIcon,
  FolderSimpleIcon,
  ListIcon,
  MoonIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { setTheme, useTheme } from '@/shared/theme/theme'
import { SERVICES } from '@/features/services/catalog'
import { PreviewTooltip } from './preview-tooltip'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * 회원 편집실에서만 쓰는 이용 가능 항목(헤어 -747, 표정 트래킹 -874). 2026-11-15부터 둘 다 '이용 가능'(-878).
 * 회원은 내 작업실로 가고, 비로그인은 로그인 창을 연다. 순서는 메뉴에 보이는 순서다
 */
const MEMBER_SERVICES = ['헤어 스타일', '표정 트래킹'] as const

// 예정 목록은 그 밖의 얼굴 · 스타일 예정 항목이다(catalog.ts에서 예정인 것)
const plannedStyles = SERVICES.filter(
  (service) => service.group === 'face' && service.status === 'planned',
).slice(0, 3)

export function PreviewNav({
  workspace = false,
  member = true,
  connected = false,
  nickname = '나',
  unread = false,
  notificationsActive = false,
  notificationPanel: NotificationPanel,
  onLogout,
  loggingOut = false,
}: {
  workspace?: boolean
  member?: boolean
  connected?: boolean
  nickname?: string
  unread?: boolean
  /** 지금 알림 목록 화면(/notifications)이면 종 아이콘을 채운다 */
  notificationsActive?: boolean
  /** 실제 계정 알림 팝업 내용(SiteHeader가 NotificationPopover를 넘긴다). 없으면 미리보기 안내를 보여 준다 */
  notificationPanel?: ComponentType<{ onClose: () => void }>
  onLogout?: () => void
  loggingOut?: boolean
}) {
  const [panel, setPanel] = useState<'services' | 'notifications' | null>(null)
  const root = useRef<HTMLElement>(null)
  const account = useRef<HTMLDetailsElement>(null)
  const lastTrigger = useRef<HTMLButtonElement | null>(null)
  const showLogin = useLoginPrompt((state) => state.show)
  const theme = useTheme()
  // 팝업 안에서 닫으면(닫기·알림 누름·전체 보기) 종 아이콘으로 포커스를 돌려준다
  const closePanel = useCallback(() => {
    setPanel(null)
    lastTrigger.current?.focus()
  }, [])
  const closeAccount = useCallback(() => {
    if (account.current?.open) account.current.open = false
  }, [])
  // 메뉴는 한 번에 하나만 열린다. 다른 곳(머리줄 안의 다른 메뉴 포함)을 누르거나 Escape를 누르면 닫는다
  useEffect(() => {
    function outside(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.pp-account')) closeAccount()
      if (!target?.closest('#pp-nav-panel, [data-nav-panel-trigger]')) setPanel(null)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (account.current?.open) {
        closeAccount()
        account.current.querySelector('summary')?.focus()
      }
      if (panel) {
        setPanel(null)
        lastTrigger.current?.focus()
      }
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [panel, closeAccount])
  return (
    <header className="pp-global-nav" ref={root}>
      <Link
        className="pp-logo"
        href={connected ? '/' : member ? '/preview?member=1' : '/preview/landing'}
        aria-label="Preface 홈"
      >
        preface<span>°</span>
      </Link>
      <nav aria-label="주요 메뉴">
        <PreviewTooltip label="내 작업실">
          {(id) => (
            <Link
              className="pp-nav-icon"
              href={connected ? '/studio' : '/preview/workspace'}
              aria-label="내 작업실"
              aria-describedby={id}
              aria-current={workspace ? 'page' : undefined}
            >
              <FolderSimpleIcon size={21} weight={workspace ? 'fill' : 'regular'} />
            </Link>
          )}
        </PreviewTooltip>
        {/* 말풍선은 뜻이 아이콘만으로 안 보이는 '내 작업실'에만 둔다(2026-10-31). 알림·메뉴·밝기는 아이콘이 곧 뜻 */}
        <button
          type="button"
          className="pp-nav-icon"
          aria-label={unread ? '알림, 새 알림 있음' : '알림'}
          aria-expanded={panel === 'notifications'}
          aria-current={notificationsActive ? 'page' : undefined}
          data-nav-panel-trigger
          aria-controls={panel === 'notifications' ? 'pp-nav-panel' : undefined}
          onClick={(event) => {
            if (!member) {
              showLogin(connected ? { returnTo: '/notifications' } : undefined)
              return
            }
            lastTrigger.current = event.currentTarget
            setPanel(panel === 'notifications' ? null : 'notifications')
          }}
        >
          {/* 활성(팝업 열림·목록 화면)은 잉크로 채운다. 보라는 안 읽은 알림 점에만 */}
          <BellIcon
            size={21}
            weight={panel === 'notifications' || notificationsActive ? 'fill' : 'regular'}
          />
          {unread && <span className="pf-unread-dot" aria-hidden="true" />}
        </button>
        <button
          className="pp-nav-icon"
          aria-label="서비스 메뉴"
          data-nav-panel-trigger
          aria-expanded={panel === 'services'}
          aria-controls={panel === 'services' ? 'pp-nav-panel' : undefined}
          onClick={(event) => {
            lastTrigger.current = event.currentTarget
            setPanel(panel === 'services' ? null : 'services')
          }}
        >
          <ListIcon size={22} weight="regular" />
        </button>
        {/* 화면 밝기: 기본은 밝은 화면, 누르면 어두운 화면(이 기기에만 저장, shared/theme) */}
        <button
          type="button"
          className="pp-nav-icon"
          aria-label={theme === 'dark' ? '밝은 화면으로 보기' : '어두운 화면으로 보기'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? (
            <SunIcon size={21} weight="regular" />
          ) : (
            <MoonIcon size={21} weight="regular" />
          )}
        </button>
        {member ? (
          <details className="pp-account" ref={account}>
            <summary role="button" aria-label={connected ? '계정 메뉴' : '프로필 메뉴'}>
              <span {...PRIVATE_TEXT}>{nickname.slice(0, 1)}</span>
            </summary>
            <div>
              <strong>내 계정</strong>
              {connected ? (
                <>
                  <Link href="/me" onClick={closeAccount}>
                    내 정보
                  </Link>
                  <Link href="/me/consents" onClick={closeAccount}>
                    동의 내역
                  </Link>
                  <button
                    onClick={() => {
                      closeAccount()
                      onLogout?.()
                    }}
                    disabled={loggingOut}
                  >
                    {loggingOut ? '로그아웃 중…' : '로그아웃'}
                  </button>
                </>
              ) : (
                <>
                  <span>로그인 화면 미리보기</span>
                  <Link href="/preview">비로그인 화면 보기</Link>
                </>
              )}
            </div>
          </details>
        ) : (
          <button className="pp-nav-login" onClick={() => showLogin()}>
            로그인
          </button>
        )}
      </nav>
      {panel && (
        <section
          className={`pp-nav-panel${panel === 'services' ? ' pp-service-directory' : ' pp-notice-panel'}`}
          id="pp-nav-panel"
          aria-label={
            panel === 'services' ? '서비스' : NotificationPanel ? '알림' : '알림 미리보기'
          }
        >
          {/* 실제 알림 팝업은 머리(모두 읽음·닫기)를 스스로 그린다 */}
          {panel === 'notifications' && NotificationPanel ? null : (
            <div className="pp-nav-panel-heading">
              <h2>{panel === 'services' ? '서비스' : '알림'}</h2>
              <button
                aria-label="메뉴 닫기"
                onClick={() => {
                  setPanel(null)
                  lastTrigger.current?.focus()
                }}
              >
                <XIcon size={17} />
              </button>
            </div>
          )}
          {panel === 'services' ? (
            <>
              {/* 실제 화면(connected): 회원은 내 작업실, 비로그인은 기본 모델 실험실. /preview 시안은 그대로 둔다 */}
              <Link
                className="pp-service-current"
                href={
                  connected
                    ? member
                      ? '/studio'
                      : '/lab'
                    : member
                      ? '/preview/editor'
                      : '/preview'
                }
                onClick={() => setPanel(null)}
              >
                <strong>3D 얼굴 편집</strong>
                <small>이용 가능</small>
              </Link>
              {/* 헤어·표정 트래킹은 회원 편집실에만 있다. 비로그인은 로그인 창을 연다 */}
              {MEMBER_SERVICES.map((title) =>
                member ? (
                  <Link
                    key={title}
                    className="pp-service-current"
                    href={connected ? '/studio' : '/preview/workspace'}
                    onClick={() => setPanel(null)}
                  >
                    <strong>{title}</strong>
                    <small>이용 가능</small>
                  </Link>
                ) : (
                  <button
                    key={title}
                    type="button"
                    className="pp-service-current"
                    onClick={() => {
                      setPanel(null)
                      showLogin(connected ? { returnTo: '/studio' } : undefined)
                    }}
                  >
                    <strong>{title}</strong>
                    <small>이용 가능</small>
                  </button>
                ),
              )}
              <div className="pp-service-planned">
                {plannedStyles.map((service) => (
                  <span key={service.id}>
                    {service.title}
                    <small>예정</small>
                  </span>
                ))}
              </div>
              <Link className="pp-service-all" href="/services" onClick={() => setPanel(null)}>
                전체 서비스
              </Link>
            </>
          ) : NotificationPanel ? (
            <NotificationPanel onClose={closePanel} />
          ) : (
            <div className="pp-nav-empty">
              <BellIcon size={27} weight="light" />
              <p>모델과 시안의 소식을 모아볼 곳이에요.</p>
              <small>실제 계정 알림은 아직 연결되지 않았어요.</small>
            </div>
          )}
        </section>
      )}
    </header>
  )
}
