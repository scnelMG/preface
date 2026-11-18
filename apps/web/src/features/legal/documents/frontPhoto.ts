import { FRONT_PHOTO_EFFECTIVE_AT } from '../facts'
import { revise } from '../revise'
import type { LegalBlock, LegalDocument } from '../types'
import { FACE_DATA_2026_10_V2 } from './faceData'

/**
 * 편집실 `원본 사진`(S15P31B204-599·770): 3D 완성 때 보관한 얼굴 사진 5방향 중 정면 1장을 본인 편집실에서 3D와 비교해 보여 준다.
 * 새로 모으는 정보·보유 기간은 그대로이고, 처리 목적만 더한다. 2026-11-11 사용자 결정으로 바로 시행한다(7일 사전 고지 생략).
 * 기존 회원에게 FACE_DATA 재동의를 받지 않는다(사용자 결정 A). 설계: docs/design/face-model-front-photo.md
 *
 * S15P31B204-891(사용자 결정 2026-11-16): 3D 완성 뒤 AI 관상 결과 화면에도 같은 정면 사진을 본인에게만 보여 주므로,
 * 버전(처리방침 2026-11-v4·동의서 2026-11-v3)은 그대로 두고 아래 두 문장의 목적에 "AI 관상 결과와 함께 볼 수 있도록"을
 * 더해 본문을 그 자리에서 고쳤다(-850과 같은 방식). 새로 모으는 정보·보유 기간·AI(LLM) 전송 여부는 그대로다.
 */

export function editList(
  blocks: readonly LegalBlock[],
  edit: (items: readonly string[]) => readonly string[],
): LegalBlock[] {
  return blocks.map((block) =>
    block.kind === 'list' ? { ...block, items: edit(block.items) } : block,
  )
}

/** 처리방침 처리 목적에 더하는 줄(5방향 줄 바로 뒤). 처리방침 2026-11-v4·2026-12-v1은 personReference.ts에 있다 */
export const FRONT_PHOTO_PURPOSE =
  '본인이 편집실에서 3D 얼굴과 실제 얼굴을 비교하거나 AI 관상 결과와 함께 볼 수 있도록, 얼굴 사진 5방향 중 정면 사진 1장을 본인 화면에 표시(본인 계정에서만, 새로 모으는 정보 없음)'

/** 얼굴 데이터 동의서 목적 셋째 줄(얼굴 사진 5장) */
export const FACE_DATA_PHOTO_PURPOSE_V3 =
  '얼굴 사진 5장은 3D 얼굴의 품질을 확인하고 이용자 피드백을 분석해 서비스를 개선하는 데 씁니다. 그중 정면 사진 1장은 본인이 편집실에서 3D와 비교하거나 AI 관상 결과와 함께 볼 수 있도록 본인 화면에만 보여 드립니다. 다른 사람에게 보이지 않고, AI(LLM)로 보내지 않습니다.'

export const FACE_DATA_2026_11_V3_VERSION = '2026-11-v3'

/**
 * 얼굴 데이터 수집·이용 2026-11-v3 (S15P31B204-770): v2에서 목적 셋째 줄만 바꾼다. 얼굴 인식·목적 외 이용 금지 문단은 그대로다.
 * BE V33 migration이 같은 버전 행을 넣는다(effective_at 2026-11-10 15:00 UTC = 11-11 00:00 KST).
 */
export const FACE_DATA_2026_11_V3: LegalDocument = revise(
  FACE_DATA_2026_10_V2,
  { version: FACE_DATA_2026_11_V3_VERSION, effectiveAt: FRONT_PHOTO_EFFECTIVE_AT },
  {
    purpose: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) =>
        items.map((item) =>
          item.startsWith('얼굴 사진 5장은') ? FACE_DATA_PHOTO_PURPOSE_V3 : item,
        ),
      ),
      basis: [...section.basis, 'S15P31B204-599·604·770(편집실 정면 사진 표시)'],
    }),
  },
)
