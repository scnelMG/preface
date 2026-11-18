/**
 * 에러 코드. 원본은 API 명세서 v3.2 "8. 에러 코드 전체"다.
 * 접두사: COMMON, AUTH, CAP, QR, REC, NOTI, CON, EDIT, HIS, SHR
 */

export const ErrorCode = {
  // 공통
  INVALID_REQUEST: 'COMMON_001',
  NOT_FOUND: 'COMMON_002',
  TOO_MANY_REQUESTS: 'COMMON_003',
  INTERNAL_ERROR: 'COMMON_999',

  // 인증·회원·동의
  UNAUTHORIZED: 'AUTH_001',
  ACCESS_TOKEN_EXPIRED: 'AUTH_002',
  REFRESH_TOKEN_INVALID: 'AUTH_003',
  UNSUPPORTED_PROVIDER: 'AUTH_010',
  REDIRECT_URI_NOT_ALLOWED: 'AUTH_011',
  STATE_MISMATCH: 'AUTH_012',
  PROVIDER_ERROR: 'AUTH_013',
  /** 제공자 동의 취소. 서버는 내리지 않는다 — 제공자가 FE 콜백에 `error`를 돌려주는 단계라 FE가 처리한다(명세 v2.8 AUTH-02) */
  PROVIDER_DENIED: 'AUTH_014',
  /** [제안] 동의서 버전 변경 후 재동의 필요. 재동의 정책이 미결이라 서버가 아직 내리지 않는다 */
  RECONSENT_REQUIRED: 'AUTH_021',
  CAPTURE_SCOPE_FORBIDDEN: 'AUTH_023',
  SIGNUP_REQUIRED: 'AUTH_024',
  CONSENT_OUTDATED: 'AUTH_030',
  CONSENT_INCOMPLETE: 'AUTH_031',
  SIGNUP_TOKEN_INVALID: 'AUTH_032',

  // 업로드
  FACE_CONSENT_MISSING: 'CAP_001',
  UPLOAD_INVALID: 'CAP_002',
  UPLOAD_OBJECT_MISSING: 'CAP_003',
  UPLOAD_EXPIRED: 'CAP_004',
  UPLOAD_CHECKSUM_MISMATCH: 'CAP_005',

  // QR 휴대폰 연결
  QR_EXPIRED: 'QR_001',
  QR_ALREADY_CONNECTED: 'QR_002',

  // 3D 복원
  RECONSTRUCTION_IN_PROGRESS: 'REC_002',
  /** [제안] 대기열 가득(REC-01 503). BE 구현이 없어 지금은 오지 않는다 */
  QUEUE_FULL: 'REC_003',

  // 상담
  MESSAGE_INVALID: 'CON_001',
  AI_TIMEOUT: 'CON_002',
  AI_SCHEMA_FAILED: 'CON_003',
  CHANGE_REQUEST_NOT_APPLICABLE: 'CON_010',
  CONSULT_DUPLICATE_REQUEST: 'CON_011',

  // 편집
  UNKNOWN_MORPH_CODE: 'EDIT_001',
  VERSION_CONFLICT: 'EDIT_002',
  NOTHING_TO_UNDO: 'EDIT_003',
  NOTHING_TO_REDO: 'EDIT_004',
  /** 헤어 템플릿 없음(HAIR-02). 헤어는 2차 범위라 1차 화면에서는 쓰지 않는다 */
  HAIR_TEMPLATE_NOT_FOUND: 'EDIT_010',
  RECONSTRUCTION_NOT_READY: 'EDIT_020',
  /** 이 3D는 모델별 지원 범위·형상 검사가 준비되지 않아 채팅 변경 요청을 적용할 수 없다(EDIT-05, S15P31B204-307) */
  CHAT_EDIT_UNSUPPORTED: 'EDIT_030',
  NOSE_EDIT_NOT_READY: 'EDIT_031',
  UNSAFE_NOSE_EDIT: 'EDIT_032',
  UNSAFE_CONTOUR_EDIT: 'EDIT_033',

  // 시안·이력
  RESOURCE_DELETING: 'HIS_002',

  // 시안 공유(S15P31B204-574). 없음·끝남·만료·삭제를 구분하지 않고 SHR_001 하나다
  SHARE_LINK_UNAVAILABLE: 'SHR_001',
  SHARE_EMPTY_SIMULATION: 'SHR_002',
  SHARE_CONSENT_REQUIRED: 'SHR_003',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * 화면 처리 분류. 명세서 8절 "FE 화면 매핑"을 그대로 옮겼다.
 * 분류에 없는 코드는 공통 오류 토스트로 처리한다.
 */
export const ErrorGroup = {
  /** 잠시 후 다시 시도 */
  RETRYABLE: [
    ErrorCode.PROVIDER_ERROR,
    ErrorCode.AI_TIMEOUT,
    ErrorCode.AI_SCHEMA_FAILED,
    ErrorCode.TOO_MANY_REQUESTS,
  ],
  /** 다시 로그인해야 한다 */
  REAUTH: [ErrorCode.REFRESH_TOKEN_INVALID, ErrorCode.SIGNUP_TOKEN_INVALID],
  /** 가입 동의 화면으로 보낸다 */
  SIGNUP: [ErrorCode.SIGNUP_REQUIRED],
  /** 동의 문구가 바뀌었다 */
  CONSENT_CHANGED: [ErrorCode.CONSENT_OUTDATED],
  /** "한 번에 하나만" 팝업 */
  JOB_CONFLICT: [ErrorCode.RECONSTRUCTION_IN_PROGRESS],
  /** 휴대폰 연결이 끝났다 */
  CAPTURE_ENDED: [
    ErrorCode.CAPTURE_SCOPE_FORBIDDEN,
    ErrorCode.QR_EXPIRED,
    ErrorCode.QR_ALREADY_CONNECTED,
  ],
  /** 다시 업로드해야 한다 */
  REUPLOAD: [ErrorCode.UPLOAD_OBJECT_MISSING, ErrorCode.UPLOAD_CHECKSUM_MISMATCH],
  /** 최신 상태를 다시 불러오고 토스트를 띄운다 */
  REFETCH: [ErrorCode.VERSION_CONFLICT, ErrorCode.UNKNOWN_MORPH_CODE],
} as const

export function isInGroup(code: string, group: readonly string[]): boolean {
  return group.includes(code)
}
