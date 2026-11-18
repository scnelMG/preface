/**
 * 인증·회원·동의 타입. 원본: API 명세서 v3.2 "2. 상세 — 인증·회원·동의 (AUTH)"
 * BE DTO: services/backend/api/.../auth/dto, consent/dto
 */

export type Provider = 'KAKAO' | 'GOOGLE'

/** API-AUTH-01·02 경로의 provider 값 */
export type ProviderPath = 'kakao' | 'google'

export type ConsentType = 'TERMS' | 'PRIVACY' | 'FACE_DATA' | 'FACE_PUBLIC'

/** 동의 4종. 전부 필수다 (REQ-F-32) */
export const CONSENT_TYPES: readonly ConsentType[] = [
  'TERMS',
  'PRIVACY',
  'FACE_DATA',
  'FACE_PUBLIC',
]

/** API-AUTH-05 GET /users/me */
export interface Me {
  id: string
  /** BE `User.nickname`이 nullable이라 null일 수 있다. 화면은 "회원" 등으로 대신 보여 준다 */
  nickname: string | null
  /** 서버가 마스킹해서 내린다. 원문 이메일은 내려오지 않는다 */
  maskedEmail: string | null
  providers: Provider[]
  createdAt: string
  /** 재동의 정책 미결. 1차는 항상 [] */
  reconsentRequired: ConsentType[]
  dataSummary: {
    faceModelCount: number
    simulationCount: number
  }
  /** 완료 알림을 받을 Mattermost 아이디(S15P31B204-476). 등록 전이면 null, 옛 서버는 내려주지 않는다 */
  mattermostUsername?: string | null
}

/** API-AUTH-07 GET /consent-documents */
export interface ConsentDocument {
  consentDocumentId: string
  consentType: ConsentType
  version: string
  title: string
  /** 전문 주소. BE 시드는 FE 경로(`/legal/terms/2026-10-v1`) [가정] */
  contentUrl: string
  required: boolean
  /**
   * v3.1부터 `consent_document.summary`(버전별, 최대 500자)에서 온다.
   * 값이 없는 버전은 null이다(2026-10-v1은 FACE_DATA만 값이 있다)
   */
  summary: string | null
  effectiveAt: string
}

/** API-AUTH-09 GET /users/me/consents */
export interface ConsentRecord {
  consentType: ConsentType
  title: string
  version: string
  effectiveAt: string
  status: 'AGREED' | 'WITHDRAWN'
  agreedAt: string | null
  withdrawnAt: string | null
  isLatestVersion: boolean
}

/** API-AUTH-01 응답 */
export interface AuthorizeUrl {
  authorizeUrl: string
  state: string
}

export interface UserSummary {
  id: string
  /** BE `User.nickname`이 nullable이라 null일 수 있다 */
  nickname: string | null
}

/** 가입 동의 화면에 보여 줄 제공자 정보. 이메일은 서버가 마스킹해 내린다 */
export interface SignupProfile {
  provider: Provider
  nickname: string | null
  maskedEmail: string | null
}

/** API-AUTH-02 응답 — 기존 회원. refresh token은 쿠키로 온다 */
export interface ExistingUserLogin {
  isNewUser: false
  accessToken: string
  expiresIn: number
  user: UserSummary
}

/** API-AUTH-02 응답 — 신규 사용자. 세션이 아니라 가입 토큰(scope=signup, 10분)이 온다 */
export interface NewUserLogin {
  isNewUser: true
  signupToken: string
  signupExpiresIn: number
  profile: SignupProfile
}

/** API-AUTH-02 응답. BE는 빈 필드를 내보내지 않는다(`@JsonInclude(NON_NULL)`) */
export type LoginResult = ExistingUserLogin | NewUserLogin

/** API-AUTH-08 응답(201). refresh token은 쿠키로 온다 */
export interface SessionResult {
  accessToken: string
  expiresIn: number
  user: UserSummary
}

/** API-AUTH-08 요청 */
export interface SignupRequest {
  consents: { consentDocumentId: string; agreed: boolean }[]
}
