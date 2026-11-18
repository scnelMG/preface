import { EFFECTIVE_AT_V2, FRONT_PHOTO_EFFECTIVE_AT, koreanDate } from '../facts'
import { revise } from '../revise'
import type { LegalDocument } from '../types'
import { editList, FRONT_PHOTO_PURPOSE } from './frontPhoto'
import { PRIVACY_2026_10_V1 } from './privacy'
import { PRIVACY_POLICY_2026_10_V2 } from './privacyPolicy'
import { TERMS_2026_10_V1 } from './terms'

export const PERSON_REFERENCE_VERSION = '2026-12-v1'
export const PERSON_REFERENCE_EFFECTIVE_AT = '2026-12-15'

/** 시행 전에는 기존 버전의 동의 증빙을 바꾸지 않는다. */
export const TERMS_2026_12_V1: LegalDocument = revise(
  TERMS_2026_10_V1,
  { version: PERSON_REFERENCE_VERSION, effectiveAt: PERSON_REFERENCE_EFFECTIVE_AT },
  {
    obligations: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'list'
          ? {
              ...block,
              items: block.items.map((item) =>
                item.startsWith('AI 실장님에 실제 인물의 이름을 넣으면')
                  ? 'AI 실장님은 특정 인물이나 사진처럼 닮게 바꾸는 요청을 현재 지원하지 않습니다. 이런 요청으로 판정되면 얼굴을 바꾸거나 SSAFY GMS에 문장을 보내지 않고, 대화에는 원문 대신 [인물·사진 참조 요청]만 저장합니다. 그 밖의 대화에서 감지한 인물명은 [인물]로 가릴 수 있고, 이전 기록에도 마스킹된 문장이 남아 있을 수 있습니다. 다른 사람을 비방하거나 사생활을 침해하는 문장은 쓰지 않습니다.'
                  : item,
              ),
            }
          : block,
      ),
      basis: [...section.basis, 'S15P31B204-98(Spring 상담의 인물·사진 참조 차단)'],
    }),
    addendum: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'p'
          ? {
              ...block,
              text: `이 약관은 ${koreanDate(PERSON_REFERENCE_EFFECTIVE_AT)}부터 시행합니다.`,
            }
          : block,
      ),
    }),
  },
)

export const PRIVACY_2026_12_V1: LegalDocument = revise(
  PRIVACY_2026_10_V1,
  { version: PERSON_REFERENCE_VERSION, effectiveAt: PERSON_REFERENCE_EFFECTIVE_AT },
  {
    'items-purpose': (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              rows: block.rows.map((row) =>
                row[0] === '서비스 이용'
                  ? [
                      row[0],
                      'AI 실장님 대화(인물·사진 참조로 판정한 요청은 원문 대신 [인물·사진 참조 요청]으로 저장, 그 밖의 대화와 이전 기록에는 감지한 인물명을 [인물]로 가린 문장이 있을 수 있음), 시안 이름·변경값·변경 이력, 알림',
                      row[2],
                    ]
                  : row,
              ),
            }
          : block,
      ),
      basis: [...section.basis, 'S15P31B204-98(Spring 상담의 인물·사진 참조 차단)'],
    }),
  },
)

/**
 * Mattermost 알림(S15P31B204-476)의 처리. 이용자가 내 정보·3D 대기 화면에서 별도 동의 뒤 켜면 Mattermost 아이디와 연결 시각을
 * 저장하고, 확인 코드는 해시로 10분 보관한다(BE `User.mattermostUsername`·`MattermostVerificationStore`). 알림 문구와 아이디는
 * SSAFY Mattermost를 거쳐 전달돼 SSAFY 위탁 행에 더한다.
 *
 * 처음에는 2026-12-v1(12-15)에 넣고 그때까지 운영에서 숨기기로 했다가(-517), 3D 생성이 길어 완성 알림이 꼭 필요해 v2 시행일(11-03)에
 * 맞춘 2026-11-v3에 넣는다(S15P31B204-543, 사용자 결정 2026-11-02). v2(관상 등)와 v3는 같은 날(11-03, facts.ts EFFECTIVE_AT_V2)
 * 시행하고, 그 전에는 연결 화면의 별도 동의(4항목 고지, `features/account/MattermostNotify.tsx`)를 근거로 받는다.
 */
const MATTERMOST_PURPOSE =
  '3D 생성 진행·결과 알림(서비스 안 알림, 이용자가 원하면 SSAFY Mattermost DM)'
const MATTERMOST_ITEMS =
  'Mattermost 아이디와 알림 연결 시각(Mattermost 알림을 켠 경우), Mattermost 확인 코드 해시'
const MATTERMOST_RETENTION: readonly [string, string] = [
  'Mattermost 아이디·알림 연결 시각',
  '알림을 끄거나 탈퇴하면 바로 삭제합니다. 확인 코드는 해시로 10분 동안만 보관한 뒤 삭제합니다.',
]
const MATTERMOST_ENTRUSTMENT =
  'Mattermost 알림 전달(이용자가 알림을 켠 경우 SSAFY Mattermost로 아이디·알림 문구 전달)'

export const PRIVACY_POLICY_2026_11_V3_VERSION = '2026-11-v3'

/** 개인정보 처리방침 2026-11-v3 (S15P31B204-543): v2 + Mattermost 알림(선택, 별도 동의). v2와 같은 날 시행한다. */
export const PRIVACY_POLICY_2026_11_V3: LegalDocument = revise(
  PRIVACY_POLICY_2026_10_V2,
  { version: PRIVACY_POLICY_2026_11_V3_VERSION, effectiveAt: EFFECTIVE_AT_V2 },
  {
    purpose: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'list'
          ? {
              ...block,
              items: block.items.map((item) =>
                item === '3D 생성 진행·결과 알림' ? MATTERMOST_PURPOSE : item,
              ),
            }
          : block,
      ),
    }),
    items: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              rows: block.rows.map((row) =>
                row[0] === '서비스 이용' ? [row[0], `${row[1]}, ${MATTERMOST_ITEMS}`, row[2]] : row,
              ),
            }
          : block,
      ),
    }),
    retention: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              rows: block.rows.flatMap((row) =>
                row[0].startsWith('알림(') ? [row, MATTERMOST_RETENTION] : [row],
              ),
            }
          : block,
      ),
    }),
    entrustment: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              rows: block.rows.map((row) =>
                row[0] === 'SSAFY' ? [row[0], `${row[1]}, ${MATTERMOST_ENTRUSTMENT}`] : row,
              ),
            }
          : block,
      ),
      basis: [...section.basis, 'S15P31B204-476·543(Mattermost 알림, SSAFY Mattermost 경유)'],
    }),
    changes: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'list'
          ? {
              ...block,
              items: block.items.map((item) =>
                item.startsWith('이전 버전:')
                  ? `${item}, 선택 기능인 Mattermost 알림(별도 동의한 분의 아이디 처리·SSAFY Mattermost 전달)을 처리 목적·항목·보유 기간·위탁에 더함`
                  : item,
              ),
            }
          : block,
      ),
    }),
  },
)

export const PRIVACY_POLICY_2026_11_V4_VERSION = '2026-11-v4'

/**
 * 개인정보 처리방침 2026-11-v4 (S15P31B204-770): v3 + 정면 사진 1장 본인 편집실 표시 목적.
 * -891에서 버전은 그대로 두고 AI 관상 결과 화면 표시를 목적·바뀐 점 문장에 더했다(frontPhoto.ts 주석).
 */
export const PRIVACY_POLICY_2026_11_V4: LegalDocument = revise(
  PRIVACY_POLICY_2026_11_V3,
  { version: PRIVACY_POLICY_2026_11_V4_VERSION, effectiveAt: FRONT_PHOTO_EFFECTIVE_AT },
  {
    purpose: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) =>
        items.flatMap((item) =>
          item.includes('얼굴 사진 5방향') ? [item, FRONT_PHOTO_PURPOSE] : [item],
        ),
      ),
      basis: [...section.basis, 'S15P31B204-599·604·770(편집실 정면 사진 표시)'],
    }),
    changes: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) =>
        items.map((item) => {
          if (item.startsWith('이 처리방침은'))
            return `이 처리방침은 ${koreanDate(FRONT_PHOTO_EFFECTIVE_AT)}부터 적용합니다.`
          if (item.startsWith('이전 버전:'))
            return '이전 버전: 2026-11-v3 — 바뀐 점: 얼굴 사진 5방향 중 정면 사진 1장을 본인 편집실 비교 화면과 AI 관상 결과 화면에 표시하는 목적을 더함. 새로 수집하는 항목과 보유 기간은 바뀌지 않음.'
          return item
        }),
      ),
    }),
  },
)

/**
 * 처리방침 2026-12-v1(12-15 시행, 인물·사진 참조). 처음에는 v3을 이어 받았으나, 11-11에 v4(정면 사진 표시 목적)가 먼저 시행돼
 * v4를 이어 받도록 바꿨다(S15P31B204-770, 사용자 결정 2026-11-11). 시행 전이라 이 버전에 동의한 기록은 없다.
 */
export const PRIVACY_POLICY_2026_12_V1: LegalDocument = revise(
  PRIVACY_POLICY_2026_11_V4,
  { version: PERSON_REFERENCE_VERSION, effectiveAt: PERSON_REFERENCE_EFFECTIVE_AT },
  {
    items: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table'
          ? {
              ...block,
              rows: block.rows.map((row) =>
                row[0] === '서비스 이용'
                  ? [
                      row[0],
                      `AI 실장님 대화(인물·사진 참조로 판정한 요청은 원문 대신 [인물·사진 참조 요청]으로 저장, 그 밖의 대화와 이전 기록에는 감지한 인물명을 [인물]로 가린 문장이 있을 수 있음), 시안·변경 이력, 알림, 휴대폰 연결 코드 해시, ${MATTERMOST_ITEMS}`,
                      row[2],
                    ]
                  : row,
              ),
            }
          : block,
      ),
    }),
    ai: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'list'
          ? {
              ...block,
              items: block.items.map((item) => {
                if (item.startsWith('보내는 정보:'))
                  return `${item} 인물·사진 참조로 판정한 요청은 SSAFY GMS에 보내지 않습니다.`
                if (item.startsWith('입력·결과 보관:'))
                  return '입력·결과 보관: 인물·사진 참조로 판정한 요청은 원문 대신 [인물·사진 참조 요청]으로 저장하고, 얼굴을 바꾸지 않습니다. 그 밖의 대화에서 감지한 인물명은 [인물]로 가릴 수 있고, 이전 기록에도 마스킹된 문장이 남아 있을 수 있습니다. 대화는 시안·3D를 삭제하거나 탈퇴하면 함께 삭제합니다.'
                return item
              }),
            }
          : block,
      ),
      basis: [...section.basis, 'S15P31B204-98(Spring 상담의 인물·사진 참조 차단)'],
    }),
    changes: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'list'
          ? {
              ...block,
              items: block.items.map((item) => {
                if (item.startsWith('이 처리방침은'))
                  return `이 처리방침은 ${koreanDate(PERSON_REFERENCE_EFFECTIVE_AT)}부터 적용합니다.`
                if (item.startsWith('이전 버전:'))
                  return '이전 버전: 2026-11-v4(2026년 11월 11일 시행) — 바뀐 점: 인물·사진 참조 요청의 거절, GMS 미전송, 대화 저장 문구를 실제 처리 방식에 맞게 설명함. 2026-11-v4에서 더한 목적(얼굴 사진 5방향 중 정면 사진 1장을 본인 편집실 비교 화면에 표시)은 그대로 이어 받음'
                return item
              }),
            }
          : block,
      ),
    }),
  },
)
