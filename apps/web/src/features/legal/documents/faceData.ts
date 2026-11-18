import {
  EDIT_SCOPE,
  EFFECTIVE_AT,
  EFFECTIVE_AT_V2,
  FACE_READING_NOTE,
  LLM_SCOPE_V2,
  RETENTION_ROWS_V2,
  CONSENT_EXIT,
  CONSENT_EXIT_BASIS,
  LLM_SCOPE,
  OPERATOR,
  RETENTION_ROWS,
  STORAGE_LOCATION,
  VIDEO_FRAMES_ITEM,
  WITHDRAWAL,
} from '../facts'
import { revise } from '../revise'
import type { LegalBlock, LegalDocument } from '../types'

/**
 * 얼굴 데이터 수집·이용 2026-10-v1 (consent_document FACE_DATA).
 *
 * 다른 동의와 별도로 받는다(법 제23조제1항제1호 방식). 얼굴 데이터가 법상 "민감정보"(시행령 제18조제3호 —
 * 특정 개인을 알아볼 목적으로 생성한 정보)에 해당하는지는 해석의 여지가 있다: 생체정보 보호 안내서(2024. 12.) 기준으로는
 * 식별 목적이 아닌 얼굴 처리는 "일반적인 생체정보"다. 팀은 REQ-N-01에 따라 민감정보 수준으로 다룬다.
 *
 * 얼굴 사진 5방향 보관(API 명세서 v2.9)은 실제 처리라 본문에 넣었다(사용자 결정 2026-10-26).
 */
export const FACE_DATA_2026_10_V1: LegalDocument = {
  slug: 'face-data',
  consentType: 'FACE_DATA',
  version: '2026-10-v1',
  title: '얼굴 데이터 수집·이용',
  effectiveAt: EFFECTIVE_AT,
  intro: `${OPERATOR}는 3D 얼굴을 만들기 위해 얼굴 영상을 받습니다. 얼굴 데이터는 다른 개인정보보다 더 조심해서 다뤄야 하므로 다른 동의와 따로 받습니다.`,
  sections: [
    {
      id: 'items',
      title: '수집하는 얼굴 데이터',
      important: true,
      blocks: [
        {
          kind: 'list',
          items: [
            '휴대폰 기본 카메라로 찍은 얼굴 영상(25~45초, 원본 그대로)',
            '영상 정보: 해상도, 초당 프레임 수, 코덱, 길이, 회전, HDR 여부, 비트레이트, 촬영 기기 제조사·모델, 촬영 시각. 위치(GPS) 정보는 저장하지 않고 버립니다.',
            '영상에서 뽑은 얼굴 사진 5장(정면·좌·우·좌 45°·우 45°)',
            '영상으로 만든 3D 얼굴 모델(형태·피부 질감)과 정면 썸네일',
            '3D 얼굴에 적용한 변경값(시안)',
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제15조제2항제2호, 제23조제1항제1호(제15조제2항 각 호를 알리고 다른 동의와 별도로 동의)',
        '시행령 제17조제3항제2호가목(민감정보는 중요한 내용으로 명확히 표시)',
        '기능명세 FN-CAP-02(영상 정보·GPS 폐기), API 명세서 v2.9(사진 5방향), BE V1·V4 마이그레이션(video_meta, face_capture_image)',
      ],
    },
    {
      id: 'purpose',
      title: '이용 목적',
      blocks: [
        {
          kind: 'list',
          items: [
            `3D 얼굴을 만들고, 참고용 성형 상담 시뮬레이션(변경 전후 비교)을 제공합니다. ${EDIT_SCOPE}`,
            '영상이 3D를 만들기에 알맞은지(흔들림·각도·조명·압축 여부) 검사하고, 맞지 않으면 다시 찍는 방법을 알려 드립니다.',
            '얼굴 사진 5장은 3D 얼굴의 품질을 확인하고 이용자 피드백을 분석해 서비스를 개선하는 데 씁니다. 따로 조회하는 화면은 없고, AI(LLM)로 보내지 않습니다.',
          ],
        },
        {
          kind: 'p',
          text: '얼굴 데이터로 본인 여부를 확인하거나 사람을 알아보는 일(얼굴 인식)에는 쓰지 않습니다. 위 목적 밖으로 쓰거나 다른 곳에 제공하지 않습니다.',
        },
      ],
      basis: [
        '개인정보 보호법 제15조제2항제1호, 제18조제1항(목적 외 이용 금지)',
        '생체정보 보호 안내서(2024. 12.) Ⅰ장 — 인증·식별 목적이 아니면 일반적인 생체정보, 나중에 식별 목적으로 쓰려면 새 동의 필요',
        '기능명세 FN-CAP-03(품질 검사), API 명세서 v2.9·AUTH-07 비고(사진 보관 목적, LLM 전송 금지)',
      ],
    },
    {
      id: 'retention',
      title: '보관 기간과 삭제',
      important: true,
      blocks: [
        {
          kind: 'table',
          caption: '얼굴 데이터 보관 기간',
          head: ['항목', '기간'],
          rows: RETENTION_ROWS.slice(0, 3),
        },
        {
          kind: 'p',
          text: '삭제할 때는 저장소의 파일과 데이터베이스 기록을 복구할 수 없게 지웁니다. 저장소 삭제가 실패하면 성공할 때까지 다시 시도합니다.',
        },
      ],
      basis: [
        '개인정보 보호법 제15조제2항제3호, 제21조제1항·제2항(복구·재생되지 않게 파기)',
        '시행령 제16조제1항제1호(전자 파일은 복원 불가능한 방법으로 영구 삭제)',
        '생체정보 보호 안내서 부록 3(특징 추출에 쓴 원본은 지체 없이 파기 권장, 보관하려면 동의)',
        '요구사항 REQ-N-02, 기능명세 FN-HIS-03·04',
      ],
    },
    {
      id: 'storage',
      title: '저장 위치와 보호',
      blocks: [
        {
          kind: 'list',
          items: [
            STORAGE_LOCATION,
            '전송할 때와 저장할 때 모두 암호화합니다. 파일은 본인만 받을 수 있고, 받는 주소는 10분 뒤 만료됩니다.',
            LLM_SCOPE,
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제23조제2항(민감정보 안전성 확보 조치)',
        '생체정보 보호 안내서 부록 3(전송 구간·저장 시 암호화, 분리 보관)',
        '요구사항 REQ-N-03·04·05·10, infra/ec2/app/app.env.example(S3_REGION=ap-northeast-2), docs/specs/service-infra.md v4',
      ],
    },
    {
      id: 'withdraw',
      title: '동의를 거두는 방법(회원 탈퇴)',
      blocks: [
        { kind: 'p', text: CONSENT_EXIT },
        { kind: 'p', text: WITHDRAWAL },
      ],
      basis: CONSENT_EXIT_BASIS,
    },
    {
      id: 'refuse',
      title: '동의를 거부할 권리',
      blocks: [
        {
          kind: 'p',
          text: '동의하지 않을 수 있습니다. 다만 얼굴 영상 없이는 서비스의 핵심인 3D 얼굴을 만들 수 없어 이 동의는 가입에 꼭 필요하며, 동의하지 않으면 가입할 수 없습니다. 가입하지 않아도 기본 얼굴 모델 체험은 할 수 있습니다.',
        },
      ],
      basis: ['개인정보 보호법 제15조제2항제4호', '요구사항 REQ-F-02·32(얼굴 동의 필수)'],
    },
  ],
}

/** 목록 블록의 항목을 바꾸거나 더한다(다른 블록은 그대로) */
function editList(
  blocks: readonly LegalBlock[],
  edit: (items: readonly string[]) => readonly string[],
): LegalBlock[] {
  return blocks.map((block) =>
    block.kind === 'list' ? { ...block, items: edit(block.items) } : block,
  )
}

/**
 * 얼굴 데이터 수집·이용 2026-10-v2 (S15P31B204-439). v1에서 바뀐 것:
 * - 재미로 보는 AI 관상: 이용자가 요청하면 영상에서 고른 정면 사진 1장을 SSAFY GMS로 보내고 결과는 글로만 보관한다(-438)
 * - 영상 길이 표기 25~45초 → 20~60초(-404·-429 반영이 v1 본문에 빠져 있었다, 최소 20초는 -538)
 * - 영상에서 뽑은 프레임 묶음(-353)을 수집 항목·보관 기간에 더했다(-373 검토, -522)
 * 시행 전까지는 v1이 현재 버전이다(BE effective_at, `latestLegalPath`).
 */
export const FACE_DATA_2026_10_V2: LegalDocument = revise(
  FACE_DATA_2026_10_V1,
  { version: '2026-10-v2', effectiveAt: EFFECTIVE_AT_V2 },
  {
    items: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) => [
        ...items.flatMap((item) => {
          if (item.startsWith('휴대폰 기본 카메라로 찍은 얼굴 영상'))
            return ['휴대폰 기본 카메라로 찍은 얼굴 영상(20~60초, 원본 그대로)']
          if (item.startsWith('영상 정보:')) return [item, VIDEO_FRAMES_ITEM]
          return [item]
        }),
        '재미로 보는 AI 관상을 요청했을 때 영상에서 고른 정면 사진 1장(작게 줄여 보내고 저장하지 않음)과 관상 결과(글)',
      ]),
      basis: [
        ...section.basis,
        'S15P31B204-404·429·538(영상 길이 20~60초), S15P31B204-438(AI 관상, BE V14 face_reading)',
        'S15P31B204-353·373·522(영상 프레임 묶음, BE FrameExtractionService)',
      ],
    }),
    purpose: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) => [
        ...items,
        `이용자가 원할 때 재미로 보는 AI 관상 풀이를 만듭니다. 3D를 만드는 동안 영상에서 고른 정면 사진 1장을 수탁자(SSAFY GMS)에 보내고, 결과는 글로만 저장합니다. ${FACE_READING_NOTE}`,
      ]),
      basis: [...section.basis, 'docs/design/face-reading.md(AI 관상, 2차)'],
    }),
    retention: (section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'table' ? { ...block, rows: RETENTION_ROWS_V2.slice(0, 4) } : block,
      ),
    }),
    storage: (section) => ({
      ...section,
      blocks: editList(section.blocks, (items) =>
        items.map((item) => (item.startsWith('AI 실장님(') ? LLM_SCOPE_V2 : item)),
      ),
      basis: [...section.basis, 'services/backend/AGENTS.md 보안 절(AI 관상 예외)'],
    }),
  },
)
