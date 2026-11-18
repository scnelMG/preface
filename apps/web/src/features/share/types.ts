import type { EyeReview } from '@/features/edit/eyes/state'
import type { MorphState } from '@/features/edit/types'

/** API-SHR-01. `shareUrl`에 토큰이 들어 있어 이 응답에서만 한 번 온다. 로그에 남기지 않는다 */
export interface ShareCreated {
  shareId: string
  shareUrl: string
  expiresAt: string
}

/** API-SHR-02 항목. 링크는 다시 오지 않는다(서버에는 해시만 있다) */
export interface ShareSummary {
  shareId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
}

/** API-HAIR-01 항목과 같은 모양(서버 헤어 템플릿). URL은 presigned GET(10분) */
export interface SharedHairTemplate {
  hairTemplateId: string
  name: string
  meshUrl: string
  bindingUrl: string | null
  thumbnailUrl: string | null
  headTemplate: string | null
  length: string | null
  bangs: string | null
  part: string | null
  baseRgb: string | null
}

/** 공유 시점 서버 헤어 템플릿(API-HAIR-02로 시안에 저장한 것). `targetRgb`는 3D 모델의 추정 머리색 `#rrggbb` */
export interface SharedHair {
  template: SharedHairTemplate
  targetRgb: string | null
}

/**
 * API-SHR-04(로그인 없음). 파일 URL은 presigned GET(10분)이라 `urlExpiresAt` 전에 다시 받는다.
 *
 * 편집실은 웹에 든 정적 헤어(features/edit/hair/catalog.ts)를 씌우고 서버 시안에는 저장하지 않는다. 그래서 공유를 만들 때 보낸
 * 웹 헤어 ID가 `hairAssetId`로 돌아오고, 받은 사람 화면도 이것으로 같은 헤어를 씌운다(S15P31B204-842).
 * `hair`(서버 헤어 템플릿)는 편집실이 아직 고르지 않으므로(API-HAIR-02는 2차) 받기만 한다.
 */
export interface SharedView {
  meshUrl: string
  rigUrl: string | null
  textureUrl: string | null
  meshFormat: string
  morphState: MorphState
  eyeReview: EyeReview | null
  hair: SharedHair | null
  /** 공유 시점 웹 헤어 ID. 없거나 이 기능 전에 만든 공유면 null·없음 */
  hairAssetId?: string | null
  /** 공유한 사람이 링크를 만들 때 직접 적은 이름. 적지 않았으면 `null`(계정 닉네임이 아니다, S15P31B204-843) */
  senderName: string | null
  expiresAt: string
  urlExpiresAt: string
}
