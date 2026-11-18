import { api } from '@/shared/api/client'
import type {
  AuthorizeUrl,
  ConsentDocument,
  LoginResult,
  Me,
  ProviderPath,
  SessionResult,
  SignupRequest,
} from './types'

/** 인증 API. 원본: API 명세서 v2.9 "2. 상세 — 인증·회원·동의 (AUTH)" */
export const authApi = {
  /** API-AUTH-01. 인증 없이 부른다. `redirectUri`는 BE 허용 목록(`preface.auth.allowed-redirect-uris`)에 있어야 한다 */
  authorizeUrl: (provider: ProviderPath, redirectUri: string) =>
    api.get<AuthorizeUrl>(`/auth/oauth/${provider}/authorize-url`, {
      query: { redirectUri },
      anonymous: true,
    }),

  /** API-AUTH-02. 기존 회원이면 refresh 쿠키도 같이 온다 */
  login: (provider: ProviderPath, body: { code: string; state: string; redirectUri: string }) =>
    api.post<LoginResult>(`/auth/oauth/${provider}/login`, body, { anonymous: true }),

  /** API-AUTH-04. 서버가 refresh를 폐기하고 쿠키를 만료시킨다 */
  logout: () => api.post<Record<string, never>>('/auth/logout'),

  /** API-AUTH-05 */
  me: () => api.get<Me>('/users/me'),

  /** API-AUTH-07. 인증 없이도 되지만 가입 토큰이 있으면 같이 보낸다 */
  consentDocuments: () => api.get<ConsentDocument[]>('/consent-documents'),

  /** API-AUTH-08. 가입 토큰으로 부른다 */
  signup: (body: SignupRequest) => api.post<SessionResult>('/auth/signup', body),
}
