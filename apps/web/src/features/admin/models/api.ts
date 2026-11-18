import { api } from '@/shared/api/client'
import type { AdminFaceModel, AdminFaceModelAssets, AdminPage, AdminUserStorage } from './types'

/** 관리자 목록 size 최대값(계약 "페이지 형식"). 앱 공통 `pageQuery`는 50으로 자르므로 쓰지 않는다 */
const MAX_SIZE = 100

/**
 * 관리자 사용자별 생성 모델·S3 조회 API(S15P31B204-655, 계약 6·7·8절). 모두 ADMIN만 부를 수 있다(아니면 403 `ADM_001`).
 * 응답의 서명 URL은 화면 상태에만 둔다. 로그·주소창·브라우저 저장소에 남기지 않는다.
 */
export const adminModelsApi = {
  /** 계약 6. 최신순 */
  faceModels: (userId: string, { page = 0, size = 20 }: { page?: number; size?: number } = {}) =>
    api.get<AdminPage<AdminFaceModel>>(`/admin/users/${encodeURIComponent(userId)}/face-models`, {
      query: { page, size: Math.min(size, MAX_SIZE) },
    }),

  /** 계약 7. 서명 URL 만료 5분(`expiresAt`) */
  assets: (faceModelId: string) =>
    api.get<AdminFaceModelAssets>(`/admin/face-models/${encodeURIComponent(faceModelId)}/assets`),

  /** 계약 8. 사용자 한 명의 prefix만 */
  storage: (userId: string) =>
    api.get<AdminUserStorage>(`/admin/users/${encodeURIComponent(userId)}/storage`),
}

/** 서명 URL이 아직 쓸 만한지. 뷰어가 받는 동안 끊기지 않게 30초 여유를 둔다 */
export function assetsFresh(assets: Pick<AdminFaceModelAssets, 'expiresAt'>, now = Date.now()) {
  const expires = Date.parse(assets.expiresAt)
  return Number.isFinite(expires) && expires - now > 30_000
}
