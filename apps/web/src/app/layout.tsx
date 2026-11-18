import type { Metadata } from 'next'
import { Suspense, type ComponentType } from 'react'
import { MattermostOnboarding } from '@/features/account/MattermostOnboarding'
import { AuthBootstrap } from '@/features/auth/AuthBootstrap'
import { Analytics } from '@/shared/analytics'
import { HandoffLayer } from '@/shared/ui/HandoffLayer'
import { THEME_INIT_SCRIPT } from '@/shared/theme/initScript'
// 글꼴은 Pretendard 한 가족(로고·영문·숫자·한글, OFL-1.1). 빌드가 외부에서 받지 않게 npm 패키지의 파일을 쓴다.
// unicode-range로 쪼개진 조각 중 화면에 필요한 것만 받는다. 글꼴 이름은 globals.css의 --font-sans에 적는다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
// 랜딩·숫자용 보조 글꼴(OFL-1.1): 거대 글자 'pre'의 세리프 이탤릭, 순번·단계 숫자의 고정폭. 라틴 조각만 받는다
import '@fontsource/instrument-serif/latin-400-italic.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import './globals.css'
import './preview/preview.css'
import '../features/layout/service.css'
// 2026-10-31 고른 개선(작업실 순번·편집실 글씨·생성 대기 구성 등)과 어두운 화면. 앞의 층을 덮으므로 마지막에 둔다
import '../features/layout/refine.css'
import '../shared/theme/dark.css'

// 개발 서버 전용 회원·게스트 보기 전환(features/dev). import 문으로 가져오면 쓰지 않아도 운영 번들에 들어가므로,
// 빌드가 NODE_ENV를 상수로 바꿔 이 분기째 지우도록 조건부 require로 가져온다
const DevAuthView: ComponentType | null =
  process.env.NODE_ENV === 'development'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/features/dev/DevAuthView') as typeof import('@/features/dev/DevAuthView'))
        .DevAuthView
    : null

export const metadata: Metadata = {
  title: {
    default: 'Preface',
    template: '%s · Preface',
  },
  description: '얼굴 영상으로 3D 얼굴을 만들고, 원하는 모습을 미리 봅니다.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // 화면 밝기 속성(data-theme)은 아래 스크립트가 하이드레이션 전에 붙이므로 html 속성 차이 경고를 끈다
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* 어두운 화면을 고른 기기는 첫 그림부터 어둡게(깜빡임 방지). 저장소 값만 읽는다(shared/theme) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        {/* 개발 서버 전용 회원·게스트 보기 전환. 가짜 API가 세션 복구보다 먼저 걸리도록 앞에 둔다 */}
        {DevAuthView ? <DevAuthView /> : null}
        {/* 새로고침해도 로그인이 유지되게 refresh 쿠키로 세션을 되살린다(API-AUTH-03) */}
        <AuthBootstrap />
        {children}
        {/* Mattermost 알림 신청 안내: 연결 안 한 회원에게 계정마다 한 번(가입 직후·기존 회원 첫 진입, S15P31B204-544) */}
        {/* 주소(usePathname)를 읽어 미리 그리기에서 빠지도록 Suspense로 감싼다(cacheComponents) */}
        <Suspense fallback={null}>
          <MattermostOnboarding />
        </Suspense>
        {/* 작업실 → 편집실 머리 이어주기(레이아웃이 달라도 이어지게 맨 위에 하나) */}
        <HandoffLayer />
        {/* 사용 분석(GA4·Clarity). 운영 주소 + ID가 있을 때만 불러온다(shared/analytics/config.ts) */}
        <Analytics />
      </body>
    </html>
  )
}
