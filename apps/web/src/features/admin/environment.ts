import { PRODUCTION_HOST } from '@/shared/analytics/config'
import type { AdminEnvironment } from './types'

/**
 * 운영 | 개발 탭(관리자 API 계약 "운영 | 개발 탭" 1안, S15P31B204-654).
 *
 * 운영과 개발은 같은 호스트에서 포트로만 나뉜다(infra/ec2/proxy/Caddyfile: 운영 443, 개발 8080, 둘 다 Caddy가 HTTPS로 받는다).
 * 호스트는 분석 도구가 운영 주소를 가르는 값(`shared/analytics/config.ts`의 PRODUCTION_HOST)을 같이 쓴다.
 * 지금 어느 환경인지는 주소가 아니라 `/admin/me`의 `environment`(BE 설정값)로 정한다.
 */
export type SwitchableEnvironment = Exclude<AdminEnvironment, 'local'>

export const ADMIN_ENV_ORIGINS: Record<SwitchableEnvironment, string> = {
  prod: `https://${PRODUCTION_HOST}`,
  dev: `https://${PRODUCTION_HOST}:8080`,
}

export const ADMIN_ENV_LABELS: Record<AdminEnvironment, string> = {
  prod: '운영',
  dev: '개발',
  local: '로컬',
}

/**
 * 다른 환경의 같은 화면 주소. 경로와 쿼리는 그대로 두고 출처만 바꾼다.
 * 작업·사용자 ID는 환경마다 달라서 상세 화면이면 상대 환경에서 "없음"이 뜰 수 있다. 그래도 같은 경로로 보낸다(계약).
 */
export function environmentUrl(
  target: SwitchableEnvironment,
  pathname: string,
  search = '',
): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const query = search && !search.startsWith('?') ? `?${search}` : search
  return `${ADMIN_ENV_ORIGINS[target]}${path}${query === '?' ? '' : query}`
}
