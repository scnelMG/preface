/**
 * 관리자 회원 목록·검색 응답(`GET /api/v1/admin/users`, 관리자 2차 계약 2절 · S15P31B204-707).
 * 이메일·Mattermost 이름은 응답에 없다.
 */
export interface AdminUserRow {
  userId: string
  /** 탈퇴 회원은 null */
  nickname: string | null
  /** 연결된 소셜 로그인(KAKAO·GOOGLE, 정렬됨) */
  providers: string[]
  /** USER | ADMIN */
  role: string
  /** ACTIVE | WITHDRAWN */
  status: string
  createdAt: string
  deletedAt: string | null
  /** 삭제된 모델 포함 */
  faceModelCount: number
  /** 마지막 복원 작업을 만든 시각. 없으면 null */
  lastJobAt: string | null
}

export interface AdminUserFilters {
  q?: string
  page?: number
  size?: number
}
