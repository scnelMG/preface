/**
 * 사용 분석 도구(GA4·Microsoft Clarity) 설정.
 *
 * - 측정 ID는 브라우저에 그대로 공개되는 값이라 비밀이 아니다. 빌드 인자 대신 여기 둬서 배포 스크립트를 건드리지 않는다.
 * - **ID가 비어 있으면 아무것도 불러오지 않는다.** 개인정보 처리방침에 행태 분석·국외 이전을 적은 뒤(S15P31B204-447) ID를 넣어 켰다.
 *   끄려면 ID를 비운다. 도구를 바꾸면 처리방침의 위탁·국외 이전 표(features/legal/facts.ts)도 같이 고친다.
 * - 운영 주소에서만 켠다. 개발 서버(:8080)·로컬에서 쌓인 기록이 운영 통계에 섞이지 않게 한다.
 */

/** GA4 측정 ID(`G-`로 시작). 비우면 GA4를 불러오지 않는다 */
export const GA_MEASUREMENT_ID = ''

/** Microsoft Clarity 프로젝트 ID. 비우면 Clarity를 불러오지 않는다 */
export const CLARITY_PROJECT_ID = ''

/** 운영 주소(scripts/deploy/deploy.sh의 prod). 개발은 같은 호스트의 8080 포트라 `host`(포트 포함)로 가른다 */
export const PRODUCTION_HOST = 'preface.example.com'

export function isProductionHost(host: string): boolean {
  return host === PRODUCTION_HOST
}

/**
 * 세션 녹화(Clarity)를 하지 않는 경로. 휴대폰 촬영 화면은 얼굴이 계속 화면에 있고,
 * 카메라 녹화 중인 휴대폰에 녹화 스크립트 부담을 더하지 않는다.
 */
const NO_RECORDING_PREFIXES = ['/m/']

/**
 * 분석을 아예 켜지 않는 경로. 공유받은 시안(`/s/{token}`)은 주소의 토큰만 있으면 얼굴 3D를 열 수 있어,
 * GA4 `page_location`·Clarity 녹화에 주소가 실리면 분석 콘솔을 보는 사람이 링크를 얻는다(S15P31B204-575).
 * 관리자 화면(`/admin`)은 사용자 ID·작업 기록을 보여 주므로 측정·녹화하지 않는다(REQ-N-24, S15P31B204-654).
 */
const NO_ANALYTICS_PREFIXES = ['/s/', '/admin']

export function canMeasure(pathname: string): boolean {
  return !NO_ANALYTICS_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function canRecordSession(pathname: string): boolean {
  return !NO_RECORDING_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
