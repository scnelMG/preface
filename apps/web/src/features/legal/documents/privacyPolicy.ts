import {
  ANALYTICS_ENTRUSTMENT_ROWS,
  ANALYTICS_ITEMS,
  ANALYTICS_OPT_OUT,
  ANALYTICS_OVERSEAS_HEAD,
  ANALYTICS_OVERSEAS_ROWS,
  ANALYTICS_RECORDING_MASK,
  ANALYTICS_RETENTION,
  CONTACT,
  EFFECTIVE_AT,
  ENTRUSTMENT_ROWS,
  ENTRUSTMENT_TERMS,
  CONSENT_EXIT,
  CONSENT_EXIT_BASIS,
  LLM_SCOPE,
  OPERATOR,
  OPERATOR_NOTE,
  PRIVACY_OFFICER,
  REMEDY_AGENCIES,
  RETENTION_ROWS,
  SERVER_LOG,
  SERVICE,
  STORAGE_LOCATION,
  WITHDRAWAL,
  koreanDate,
  EFFECTIVE_AT_V2,
  ENTRUSTMENT_ROWS_V2,
  FACE_READING_NOTE,
  LLM_SCOPE_V2,
  RETENTION_ROWS_V2,
} from '../facts'
import { revise } from '../revise'
import type { LegalBlock, LegalDocument } from '../types'

/**
 * 개인정보 처리방침 2026-10-v1.
 *
 * 동의서가 아니라 법 제30조에 따라 누리집에 계속 게시해야 하는 문서라 consent_document 시드에는 없다.
 * 항목 순서는 「개인정보 처리방침 작성지침」(2026. 4.) Ⅱ-2 "기재 사항" 표의 번호를 따른다.
 * 해당 없는 항목도 "해당 없음"으로 적는다(작성지침 같은 표의 "해당시" 안내).
 */
export const PRIVACY_POLICY_2026_10_V1: LegalDocument = {
  slug: 'privacy-policy',
  consentType: null,
  version: '2026-10-v1',
  title: '개인정보 처리방침',
  effectiveAt: EFFECTIVE_AT,
  intro: `${OPERATOR}는 「개인정보 보호법」에 따라 ${SERVICE} 이용자의 개인정보를 보호하고, 관련 고충을 빠르게 처리하기 위해 이 처리방침을 둡니다. ${OPERATOR_NOTE}`,
  sections: [
    {
      id: 'purpose',
      title: '개인정보의 처리 목적',
      blocks: [
        {
          kind: 'list',
          items: [
            '회원 가입·로그인과 회원 식별, 동의 기록 보관',
            '얼굴 영상으로 3D 얼굴을 만들고 참고용 성형 상담 시뮬레이션 제공(현재 편집 부위는 코, 눈·윤곽은 제공 예정)',
            'AI 실장님(문장으로 얼굴 변경 요청) 제공, 시안 자동 저장·되돌리기',
            '3D 생성 진행·결과 알림',
            '3D 얼굴 품질 확인과 이용자 피드백 분석을 통한 서비스 개선(얼굴 사진 5방향)',
            '부정 이용 방지, 장애 대응',
            '서비스 이용 통계 분석과 화면 개선(입력한 글자와 얼굴 화면은 제외)',
          ],
        },
      ],
      basis: ['개인정보 보호법 제30조제1항제1호', '작성지침 Ⅲ-2'],
    },
    {
      id: 'items',
      title: '처리하는 개인정보의 항목',
      blocks: [
        {
          kind: 'table',
          caption: '처리 항목과 근거',
          head: ['구분', '항목', '처리 근거'],
          rows: [
            [
              '회원',
              '소셜 로그인 제공자(카카오·구글), 제공자의 사용자 식별자, 닉네임, 이메일(제공자에서 동의한 경우), 동의 기록',
              '계약 이행(법 제15조제1항제4호)',
            ],
            [
              '얼굴 데이터(민감정보 수준으로 별도 동의)',
              '얼굴 영상, 영상 정보(해상도·fps·코덱·길이·회전·HDR·비트레이트·기기 제조사·모델·촬영 시각, GPS 제외), 얼굴 사진 5방향, 3D 얼굴 모델·썸네일, 변경값',
              '별도 동의(법 제15조제1항제1호, 제23조제1항제1호 방식)',
            ],
            [
              '서비스 이용',
              'AI 실장님 대화(인물 이름 마스킹본), 시안·변경 이력, 알림, 휴대폰 연결 코드 해시',
              '계약 이행(법 제15조제1항제4호)',
            ],
            [
              '자동 수집',
              '로그인 유지 쿠키, 서버 운영 로그(오류·처리 기록)',
              '계약 이행(법 제15조제1항제4호)',
            ],
            ['자동 수집(이용 분석)', ANALYTICS_ITEMS, '정당한 이익(법 제15조제1항제6호)'],
          ],
        },
      ],
      basis: [
        '시행령 제31조제1항제1호(처리하는 개인정보의 항목)',
        '개인정보 보호법 제22조제3항(동의 없이 처리하는 항목은 법적 근거와 구분해 공개)',
        '작성지침 Ⅲ-3, 개인정보 처리 통합 안내서(2025. 7.) Ⅱ장',
      ],
    },
    {
      id: 'children',
      title: '만 14세 미만 아동의 개인정보 처리',
      blocks: [
        {
          kind: 'p',
          text: '이 서비스는 성인을 대상으로 하며, 만 14세 미만 아동은 가입할 수 없습니다. 별도의 연령 확인 절차는 두지 않으며, 만 14세 미만 아동의 개인정보가 처리된 사실을 알게 되면 지체 없이 파기합니다.',
        },
      ],
      basis: ['개인정보 보호법 제22조의2', '작성지침 Ⅲ-4', '요구사항 REQ-F-32(연령 확인 없음)'],
    },
    {
      id: 'retention',
      title: '개인정보의 처리 및 보유 기간',
      blocks: [
        {
          kind: 'table',
          caption: '보유 기간',
          head: ['항목', '기간'],
          rows: [...RETENTION_ROWS, ['이용 분석 정보', ANALYTICS_RETENTION]],
        },
        { kind: 'p', text: WITHDRAWAL },
      ],
      basis: [
        '개인정보 보호법 제30조제1항제2호, 제37조제3항(탈퇴 시 지체 없는 파기)',
        '작성지침 Ⅲ-5',
        '요구사항 REQ-N-02, infra/ec2/app/compose.yaml(로그 순환), 인프라 담당 확인(2026-10-26: 접속 로그 없음, 백업 7일·서울 S3)',
      ],
    },
    {
      id: 'destruction',
      title: '개인정보의 파기 절차 및 방법',
      blocks: [
        {
          kind: 'list',
          items: [
            '절차: 보유 기간이 끝나거나 이용자가 삭제·탈퇴를 요청하면 대상을 정해 삭제합니다. 자동 삭제 대상(실패한 원본 영상, 30일이 지난 삭제분, 빈 시안)은 1시간마다 점검합니다.',
            '방법: 저장소(Amazon S3)의 파일과 데이터베이스 기록을 복원할 수 없는 방법으로 영구 삭제합니다. 저장소 삭제가 실패하면 성공할 때까지 다시 시도하고, 삭제 대상 ID와 일시를 삭제 기록으로 남깁니다.',
            '보존: 다른 법령에 따라 보존해야 하는 개인정보는 없습니다. 동의·삭제 기록은 증빙을 위해 다른 정보와 분리해 1년 보관한 뒤 파기합니다.',
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제21조, 제30조제1항제3호의2',
        '시행령 제16조제1항제1호(전자 파일 영구 삭제)',
        '작성지침 Ⅲ-6',
        '기능명세 FN-HIS-03·04·05, BE data_deletion_log·WithdrawalService',
      ],
    },
    {
      id: 'third-party',
      title: '개인정보의 제3자 제공',
      blocks: [{ kind: 'p', text: '해당 없음. 이용자의 개인정보를 제3자에게 제공하지 않습니다.' }],
      basis: ['개인정보 보호법 제17조, 제30조제1항제3호', '작성지침 Ⅲ-7'],
    },
    {
      id: 'additional-use',
      title: '추가적인 이용·제공의 판단 기준',
      blocks: [{ kind: 'p', text: '해당 없음.' }],
      basis: ['개인정보 보호법 제15조제3항, 시행령 제14조의2', '작성지침 Ⅲ-8'],
    },
    {
      id: 'entrustment',
      title: '개인정보 처리업무의 위탁',
      blocks: [
        {
          kind: 'table',
          caption: '수탁자와 위탁 업무',
          head: ['수탁자', '위탁 업무'],
          rows: [...ENTRUSTMENT_ROWS, ...ANALYTICS_ENTRUSTMENT_ROWS],
        },
        { kind: 'p', text: ENTRUSTMENT_TERMS },
      ],
      basis: [
        '개인정보 보호법 제26조제1항·제2항·제4항·제5항, 제30조제1항제4호',
        '시행령 제28조제1항(위탁 문서 기재 사항)·제2항(인터넷 홈페이지에 지속 게재)',
        '작성지침 Ⅲ-9, 부록 1(외부 생성형 AI 연동은 처리위탁에 해당)',
        'docs/specs/service-infra.md v4, services/gpu-worker/app/consult.py(GMS 호출)',
        'apps/web/src/shared/analytics(Google Analytics·Microsoft Clarity, S15P31B204-443)',
      ],
    },
    {
      id: 'overseas',
      title: '개인정보의 국외 이전',
      blocks: [
        {
          kind: 'p',
          text: '이용 분석 정보만 아래 수탁자에게 처리를 맡기며 국외로 이전합니다.',
        },
        {
          kind: 'table',
          caption: '국외 이전',
          head: ANALYTICS_OVERSEAS_HEAD,
          rows: ANALYTICS_OVERSEAS_ROWS,
        },
        { kind: 'p', text: ANALYTICS_OPT_OUT },
        { kind: 'p', text: STORAGE_LOCATION },
      ],
      basis: [
        '개인정보 보호법 제28조의8제1항제3호·제2항(처리위탁·보관 시 처리방침 공개), 시행령 제31조제1항제2호',
        '작성지침 Ⅲ-10',
        'infra/ec2/app/app.env.example(S3_REGION=ap-northeast-2), 요구사항 REQ-N-05(국내 리전)',
        'GA4 이벤트 데이터 보관 14개월(속성 설정), Microsoft Clarity 문서 "Data retention"',
      ],
    },
    {
      id: 'ai',
      title: '생성형 AI 기능의 개인정보 처리',
      blocks: [
        {
          kind: 'list',
          items: [
            '쓰임: AI 실장님은 이용자가 말한 원하는 변화를 3D 얼굴의 변경 항목(예: 코끝 높이)으로 바꿉니다. 진단이나 시술 판단은 하지 않습니다.',
            `보내는 정보: ${LLM_SCOPE}`,
            '입력·결과 보관: 대화는 실제 인물 이름을 [인물]로 바꾼 문장만 시안과 함께 운영자의 데이터베이스에 저장하고, 시안·3D를 삭제하거나 탈퇴하면 함께 삭제합니다.',
            '학습 이용: 운영자는 대화를 AI 학습에 쓰지 않으며, 수탁자에게도 위탁 업무 범위 안에서만 처리하고 학습에 이용하지 않도록 요구합니다.',
            `부적절한 응답: 금칙 표현을 걸러 내며, 문제 있는 응답은 ${CONTACT}로 알려 주세요.`,
          ],
        },
      ],
      basis: [
        '작성지침 부록 1 "생성형 AI 서비스 처리방침"(의도된 용례, 입력·결과 수집 여부, 학습 활용 여부, 보유 기간, 학습 거부 방법)',
        '기능명세 FN-CON-01, 공통 규칙 R-01, 요구사항 REQ-N-10',
      ],
    },
    {
      id: 'safety',
      title: '개인정보의 안전성 확보조치',
      blocks: [
        {
          kind: 'list',
          items: [
            '관리적 조치: 개인정보를 다루는 팀원을 최소한으로 정하고, 운영 서버·저장소 접근 권한을 필요한 사람에게만 줍니다.',
            '기술적 조치: 전 구간 암호화 통신(HTTPS, TLS 1.2 이상), 저장소 서버 측 암호화, 다른 사람의 데이터는 "없음"으로 응답, 파일은 10분 뒤 만료되는 주소로만 제공',
            '외부 AI 키와 저장소 접근 키는 서버에만 두고 화면 코드에 넣지 않습니다.',
            '휴대폰 연결 코드는 1회용·3분 유효이며 원문 대신 해시만 저장합니다.',
            '데이터베이스 백업은 서울 리전 저장소에 암호화해 7일 동안만 보관합니다.',
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제29조, 시행령 제30조·제31조제1항제3호',
        '작성지침 Ⅲ-11',
        '요구사항 REQ-N-03·04·09·21',
      ],
    },
    {
      id: 'sensitive-public',
      title: '민감정보의 공개 가능성 및 비공개 선택 방법',
      blocks: [
        {
          kind: 'p',
          text: '얼굴 데이터는 본인 외에 공개되지 않으며, 공개되는 화면이 없습니다. 이후 공개 기능을 열면 공개 범위와 비공개로 바꾸는 방법을 미리 알리고 다시 동의를 받습니다. 자세한 내용은 「얼굴 데이터 공개 범위」에 있습니다.',
        },
      ],
      basis: ['개인정보 보호법 제23조제3항, 제30조제1항제3호의3', '작성지침 Ⅲ-12'],
    },
    {
      id: 'pseudonym',
      title: '가명정보 처리',
      blocks: [{ kind: 'p', text: '해당 없음.' }],
      basis: ['개인정보 보호법 제30조제1항제4호의2', '작성지침 Ⅲ-13'],
    },
    {
      id: 'auto-collect',
      title: '개인정보 자동 수집 장치의 설치·운영 및 거부',
      blocks: [
        {
          kind: 'list',
          items: [
            '로그인 유지를 위해 쿠키 1개(로그인 갱신용, 자바스크립트로 읽을 수 없게 설정)를 씁니다.',
            '서비스 이용 통계와 화면 개선을 위해 Google Analytics(쿠키 _ga 등)와 Microsoft Clarity(쿠키 _clck·_clsk 등)를 씁니다. 광고 목적으로는 쓰지 않으며, Google의 광고 기능(Google 신호·광고 맞춤 설정)은 꺼 두었습니다.',
            ANALYTICS_RECORDING_MASK,
            '브라우저 저장소에 튜토리얼 진행 여부, 로그인 진행 상태 같은 화면 편의 정보를 둡니다. 서버로 보내지 않습니다.',
            '거부 방법: 브라우저 설정에서 쿠키를 막을 수 있습니다. 로그인 쿠키를 막으면 로그인 상태가 유지되지 않습니다.',
            ANALYTICS_OPT_OUT,
            '광고 목적으로 행태정보를 수집하거나 제3자에게 제공하지 않습니다.',
            `서버 로그: ${SERVER_LOG}`,
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제30조제1항제7호',
        '작성지침 Ⅲ-14·15',
        'API 명세서 v3.2 "0. 공통 규칙 · 인증"(refresh token HttpOnly 쿠키), apps/web features/tutorial/storage.ts·features/auth/oauthSession.ts',
        'apps/web/src/shared/analytics(운영 주소에서만 불러옴, 촬영 화면 녹화 안 함, 얼굴 화면 가림, 광고 기능 끔)',
      ],
    },
    {
      id: 'rights',
      title: '정보주체와 법정대리인의 권리·의무 및 행사방법',
      blocks: [
        {
          kind: 'list',
          items: [
            '언제든 개인정보 열람, 정정·삭제, 처리정지를 요구할 수 있습니다.',
            '화면에서 바로: "내 정보 > 동의 내용·기록"에서 동의 내용 확인, 이력에서 3D·시안 삭제, "내 정보"에서 회원 탈퇴',
            `동의 철회: ${CONSENT_EXIT} 탈퇴하면 위 "개인정보의 처리 및 보유 기간"에 적은 대로 지체 없이 파기합니다.`,
            `그 밖의 요구는 ${CONTACT}로 보내 주시면 지체 없이 처리하고 결과를 알려 드립니다. 대리인을 통해서도 할 수 있습니다.`,
          ],
        },
      ],
      basis: [
        '개인정보 보호법 제35조·제36조, 제30조제1항제5호',
        ...CONSENT_EXIT_BASIS,
        '작성지침 Ⅲ-16',
        'API-AUTH-09·11, FN-AUTH-04, FN-HIS-03',
      ],
    },
    {
      id: 'automated-decision',
      title: '자동화된 결정',
      blocks: [
        {
          kind: 'p',
          text: '해당 없음. AI 실장님의 변경은 이용자가 요청한 편집을 반영하는 것이며, 이용자의 권리·의무에 중대한 영향을 주는 결정을 하지 않습니다.',
        },
      ],
      basis: ['개인정보 보호법 제37조의2', '작성지침 Ⅲ-17'],
    },
    {
      id: 'officer',
      title: '개인정보 보호책임자 및 고충 처리 부서',
      blocks: [
        {
          kind: 'list',
          items: [
            `개인정보 보호책임자·고충 처리 담당: ${PRIVACY_OFFICER}`,
            `연락처: ${CONTACT}`,
            '개인정보 관련 문의, 불만, 피해 구제 요청을 보내 주시면 지체 없이 답변하고 처리합니다.',
          ],
        },
      ],
      basis: ['개인정보 보호법 제30조제1항제6호, 제31조', '작성지침 Ⅲ-18'],
    },
    {
      id: 'domestic-agent',
      title: '국내대리인 지정',
      blocks: [{ kind: 'p', text: '해당 없음.' }],
      basis: ['개인정보 보호법 제31조의2', '작성지침 Ⅲ-19'],
    },
    {
      id: 'remedy',
      title: '권익침해 구제 방법',
      blocks: [
        {
          kind: 'p',
          text: '개인정보 침해로 상담이나 피해 구제가 필요하면 아래 기관에 문의할 수 있습니다.',
        },
        { kind: 'list', items: REMEDY_AGENCIES },
      ],
      basis: ['작성지침 Ⅲ-20(권장 항목)'],
    },
    {
      id: 'cctv',
      title: '영상정보처리기기 운영·관리',
      blocks: [
        {
          kind: 'p',
          text: '해당 없음. 고정형·이동형 영상정보처리기기를 운영하지 않습니다(이용자가 자신의 휴대폰으로 찍은 영상은 위 얼굴 데이터에 해당합니다).',
        },
      ],
      basis: ['작성지침 Ⅲ-21·22'],
    },
    {
      id: 'changes',
      title: '개인정보 처리방침의 변경',
      blocks: [
        {
          kind: 'list',
          items: [
            `이 처리방침은 ${koreanDate(EFFECTIVE_AT)}부터 적용합니다.`,
            '처리 항목·목적처럼 이용자의 권리에 중요한 내용이 바뀌면 시행 7일 전(이용자에게 불리하면 30일 전)부터 서비스 안에 알리고, 바뀌기 전과 후를 비교해 보여 줍니다.',
            '이전 버전: 없음(첫 버전)',
          ],
        },
      ],
      basis: ['개인정보 보호법 제30조제2항, 시행령 제31조제2항', '작성지침 Ⅲ-24'],
    },
  ],
}

function mapList(
  blocks: readonly LegalBlock[],
  edit: (items: readonly string[]) => readonly string[],
): LegalBlock[] {
  return blocks.map((block) =>
    block.kind === 'list' ? { ...block, items: edit(block.items) } : block,
  )
}

function mapTable(
  blocks: readonly LegalBlock[],
  edit: (rows: readonly (readonly string[])[]) => readonly (readonly string[])[],
): LegalBlock[] {
  return blocks.map((block) =>
    block.kind === 'table' ? { ...block, rows: edit(block.rows) } : block,
  )
}

/**
 * 개인정보 처리방침 2026-10-v2 (S15P31B204-439). v1에서 바뀐 것: 재미로 보는 AI 관상(정면 사진 1장 GMS 처리, 결과 글 보관)을
 * 처리 목적·항목·보유 기간·위탁·생성형 AI 절에 더했다. 영상에서 뽑은 프레임 묶음(-353)도 처리 항목·보유 기간에 더했다(-522).
 * 시행 전까지는 v1이 현재 버전이다(`latestLegalPath`).
 */
export const PRIVACY_POLICY_2026_10_V2: LegalDocument = revise(
  PRIVACY_POLICY_2026_10_V1,
  { version: '2026-10-v2', effectiveAt: EFFECTIVE_AT_V2 },
  {
    purpose: (section) => ({
      ...section,
      blocks: mapList(section.blocks, (items) => [
        ...items.slice(0, 3),
        '재미로 보는 AI 관상 풀이 제공(이용자가 직접 요청할 때)',
        ...items.slice(3),
      ]),
    }),
    items: (section) => ({
      ...section,
      blocks: mapTable(section.blocks, (rows) =>
        rows.map((row) =>
          row[0].startsWith('얼굴 데이터')
            ? [
                row[0],
                `${row[1].replace(', 얼굴 사진 5방향', ', 영상에서 뽑은 프레임 묶음(3D 생성 후 삭제), 얼굴 사진 5방향')}, AI 관상에 쓴 정면 사진 1장(저장하지 않음)·관상 결과(글)`,
                row[2],
              ]
            : row,
        ),
      ),
    }),
    // 두 표는 v1 행(이용 분석 등 다른 이슈가 더한 행 포함)을 그대로 두고 관상 부분만 더하거나 바꾼다
    retention: (section) => ({
      ...section,
      blocks: mapTable(section.blocks, (rows) => [
        ...rows
          .slice(0, 3)
          .map((row) => (row[0] === RETENTION_ROWS[0][0] ? RETENTION_ROWS_V2[0] : row)),
        RETENTION_ROWS_V2[3],
        ...rows.slice(3),
      ]),
    }),
    entrustment: (section) => ({
      ...section,
      blocks: mapTable(section.blocks, (rows) =>
        rows.map((row) => (row[0] === 'SSAFY GMS' ? ENTRUSTMENT_ROWS_V2[2] : row)),
      ),
    }),
    ai: (section) => ({
      ...section,
      blocks: mapList(section.blocks, (items) =>
        items.flatMap((item) => {
          if (item.startsWith('쓰임:')) {
            return [
              item,
              `쓰임(AI 관상): 이용자가 요청하면 정면 사진 1장으로 부위별 관상 풀이와 조언을 글로 만듭니다. ${FACE_READING_NOTE}`,
            ]
          }
          if (item.startsWith('보내는 정보:')) return [`보내는 정보: ${LLM_SCOPE_V2}`]
          return [item]
        }),
      ),
      basis: [...section.basis, 'S15P31B204-438(AI 관상), docs/design/face-reading.md'],
    }),
    changes: (section) => ({
      ...section,
      blocks: mapList(section.blocks, (items) =>
        items.map((item) => {
          if (item.startsWith('이 처리방침은'))
            return `이 처리방침은 ${koreanDate(EFFECTIVE_AT_V2)}부터 적용합니다.`
          if (item.startsWith('이전 버전:')) {
            return `이전 버전: 2026-10-v1(${koreanDate(EFFECTIVE_AT)} 시행) — 바뀐 점: 재미로 보는 AI 관상(정면 사진 1장 처리, 결과 글 보관)을 처리 목적·항목·보유 기간·위탁·생성형 AI 절에 더함, 영상에서 뽑은 프레임 묶음을 처리 항목·보유 기간에 더함`
          }
          return item
        }),
      ),
    }),
  },
)
