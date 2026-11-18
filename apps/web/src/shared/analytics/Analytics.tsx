'use client'

import Script from 'next/script'
import { useEffect, useSyncExternalStore } from 'react'
import { toast } from '@/shared/ui'
import {
  CLARITY_PROJECT_ID,
  GA_MEASUREMENT_ID,
  canMeasure,
  canRecordSession,
  isProductionHost,
} from './config'
import { applyAnalyticsParam, isAnalyticsOff } from './optOut'

/**
 * GA4(유입·전환)와 Microsoft Clarity(히트맵·세션 녹화)를 불러온다. 루트 레이아웃에 하나 붙인다.
 *
 * - 운영 주소 + ID가 있을 때만 불러온다(`config.ts`). 그 밖에는 아무것도 그리지 않는다.
 * - 화면이 뜬 뒤(hydration 직후)에 따로 받는다. 스크립트는 비동기로 받아 첫 화면 속도를 막지 않는다.
 *   Clarity를 브라우저가 한가할 때(`lazyOnload`) 받으면, 메인처럼 3D·영상을 불러오느라 계속 바쁜 화면에서는
 *   20초가 넘도록 불러오지 않았다(운영 확인 2026-10-29). 메인만 보고 나가는 방문이 녹화에서 빠지므로 GA4와 같이 받는다.
 * - 스크립트가 광고 차단 등으로 막혀도 서비스 동작은 그대로다. 수집만 빠진다.
 * - 화면 이동(App Router)의 페이지뷰는 GA4 향상된 측정(브라우저 기록 변경)이 잡는다.
 * - 첫 화면이 촬영 경로(`/m/`)면 Clarity를 불러오지 않는다. 얼굴이 나오는 요소는 `PRIVATE_MEDIA`로 따로 가린다.
 * - `?analytics=off`로 한 번 들어온 브라우저는 불러오지 않는다(팀원 테스트 기록 빼기, `optOut.ts`). `?analytics=on`이면 다시 켠다.
 */
export function Analytics({
  gaId = GA_MEASUREMENT_ID,
  clarityId = CLARITY_PROJECT_ID,
}: {
  gaId?: string
  clarityId?: string
}) {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'off' as const)
  useEffect(() => {
    // 끈 사람이 됐는지 알 수 있게 알린다. 주소의 ?analytics=는 지운다
    const changed = applyAnalyticsParam()
    if (changed === 'off') toast('이 브라우저에서는 이용 분석을 하지 않아요.')
    else if (changed === 'on') toast('이 브라우저에서 이용 분석을 다시 켰어요.')
  }, [])
  return <AnalyticsScripts mode={mode} gaId={gaId} clarityId={clarityId} />
}

export type AnalyticsMode = 'off' | 'measure' | 'record'

/** 주소로 정한다. measure: GA4만, record: GA4 + Clarity */
export function analyticsMode(host: string, pathname: string): AnalyticsMode {
  if (!isProductionHost(host) || !canMeasure(pathname)) return 'off'
  return canRecordSession(pathname) ? 'record' : 'measure'
}

/** 첫 화면에서 한 번 정한다. 레이아웃은 화면을 옮겨도 다시 그려지지 않는다 */
function subscribe() {
  return () => {}
}

function readMode(): AnalyticsMode {
  if (isAnalyticsOff(window.location.search)) return 'off'
  return analyticsMode(window.location.host, window.location.pathname)
}

export function AnalyticsScripts({
  mode,
  gaId,
  clarityId,
}: {
  mode: AnalyticsMode
  gaId: string
  clarityId: string
}) {
  if (mode === 'off') return null
  return (
    <>
      {gaId && (
        <>
          {/* 광고 기능(Google 신호·광고 맞춤 설정)은 끈다. 처리방침상 광고용 수집을 하지 않는다 */}
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;` +
              `gtag('js',new Date());gtag('config',${JSON.stringify(gaId)},` +
              `{allow_google_signals:false,allow_ad_personalization_signals:false});`}
          </Script>
          <Script
            id="ga4"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
            strategy="afterInteractive"
          />
        </>
      )}
      {mode === 'record' && clarityId && (
        // Clarity 공식 설치 코드. 입력값 가리기(Strict)는 Clarity 대시보드 설정에서 켠다.
        // id를 "clarity"로 두면 브라우저가 이 요소를 window.clarity로도 내놓아, 설치 코드가 함수 대신 요소를 남기고
        // Clarity가 시작하지 못한다("a[c] is not a function", S15P31B204-475). 도구의 전역 이름과 다른 id를 쓴다
        <Script id="clarity-init" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};` +
            `t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;` +
            `y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);` +
            `})(window,document,"clarity","script",${JSON.stringify(clarityId)});`}
        </Script>
      )}
    </>
  )
}
