import type { ConsentRecord } from '@/features/auth/types'
import { api } from '@/shared/api/client'

/** API-AUTH-11 응답(202). S3 삭제는 서버가 뒤에서 이어 간다 */
export interface AccountWithdrawal {
  deletionStatus: 'PENDING'
}

/** 확인 코드를 보냈다(S15P31B204-476) */
export interface MattermostCodeSent {
  username: string
  expiresAt: string
  resendAvailableAt: string
}

/** 등록된 Mattermost 아이디 */
export interface MattermostLink {
  username: string
  linkedAt: string
}

/**
 * 내 정보·동의·탈퇴 API. 원본: API 명세서 v3.1 "2. 상세 — 인증·회원·동의 (AUTH)".
 * 내 정보(API-AUTH-05)·로그아웃(API-AUTH-04)·동의서(API-AUTH-07)는 `features/auth/api`를 쓴다.
 * 얼굴 동의 철회(API-AUTH-10)는 부르지 않는다. 동의 4종은 가입 필수이고, 거두려면 탈퇴한다(2026-10-26 결정).
 */
export const accountApi = {
  /** API-AUTH-09. 동의 종류마다 마지막 기록 하나 */
  consents: () => api.get<ConsentRecord[]>('/users/me/consents'),

  /** API-AUTH-11. 유예 없는 하드 삭제. 서버가 refresh를 폐기하고 쿠키를 만료시킨다 */
  withdraw: () => api.delete<AccountWithdrawal>('/users/me'),

  /** Mattermost 완료 알림(S15P31B204-476): 아이디로 확인 코드 DM 보내기. 고지 동의가 있어야 한다 */
  mattermostRequestCode: (username: string) =>
    api.post<MattermostCodeSent>('/users/me/mattermost/code', { username, agreed: true }),

  /** 코드가 맞으면 등록 */
  mattermostConfirm: (code: string) => api.put<MattermostLink>('/users/me/mattermost', { code }),

  /** 알림 끄기(등록이 없어도 성공) */
  mattermostUnlink: () => api.delete<void>('/users/me/mattermost'),
}
