/**
 * 관리자 화면 경로(S15P31B204-654). 회원 목록(`/admin/users`)은 S15P31B204-708이 더했다.
 * ID는 경로 한 칸으로 인코딩한다.
 */
export const ADMIN_PATHS = {
  home: '/admin',
  jobs: '/admin/jobs',
  job: (jobId: string) => `/admin/jobs/${encodeURIComponent(jobId)}`,
  users: '/admin/users',
  user: (userId: string) => `/admin/users/${encodeURIComponent(userId)}`,
} as const
