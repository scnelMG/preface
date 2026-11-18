/**
 * 환경 변수.
 *
 * `NEXT_PUBLIC_` 접두사가 붙은 값은 **브라우저 번들에 그대로 들어간다.**
 * 토큰·비밀키를 여기에 두지 않는다.
 *
 * Next.js는 빌드할 때 `process.env.NEXT_PUBLIC_X`를 literal로 치환한다.
 * 그래서 변수로 꺼내 쓰지 않고 아래처럼 직접 적는다.
 */

const DEV_API_BASE_URL = 'http://localhost:8080/api/v1'

/**
 * 외부 API Base. 명세서 v2.7 "0. 공통 규칙" — BE-Spring만 외부에 노출한다.
 * 배포 빌드는 같은 출처 상대 경로 `/api/v1`을 넣는다. 서버 프록시가 `/api/*`를 그 환경의 API로 보내므로
 * 웹 이미지 하나를 개발·운영에 같이 쓴다(S15P31B204-379). 로컬 `next dev`는 아래 기본값을 쓴다
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEV_API_BASE_URL

/**
 * 정적 자산(기본 모델 메시, 체험용 남성·여성 기본 모델) 주소. 명세서 "API 없는 1차 FN" FN-REC-04.
 * 비어 있으면 `/public`을 쓴다.
 */
export const ASSET_BASE_URL = process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? ''

// 운영 빌드에서 주소를 안 넣고 나가는 사고를 막는다.
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_BASE_URL) {
  console.warn('NEXT_PUBLIC_API_BASE_URL이 없어 개발용 주소를 쓴다. 배포 설정을 확인한다.')
}
