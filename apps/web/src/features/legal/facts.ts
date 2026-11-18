/**
 * 여러 문서에 똑같이 들어가는 사실을 한 곳에 둔다(같은 내용을 두 곳에 쓰지 않는다).
 * 값의 근거는 저장소 기획·설계 문서이고, 저장소에 값이 없으면 사용자 결정(2026-10-26, 학생 프로젝트 기준 기본값)을 쓴다.
 * 각 상수 위 주석에 출처를 적었다.
 */

/**
 * 페이지 맨 위 "법적 검토 전 초안" 표시. 법무 검토를 마치면 false로 바꾼다.
 * 사용자 결정(2026-10-26): 지금은 켠다.
 */
export const LEGAL_DRAFT = true

/** 문의 연락처(팀 공용 메일, 사용자 결정 2026-10-26). 이 값 하나로 모든 문서에 들어간다 */
export const CONTACT = 'contact@example.com'

/**
 * 시행일. BE가 새 migration으로 동의서 4종 effective_at을 2026-10-26 00:00 KST로 맞췄다(S15P31B204-354, MR !86).
 * 버전(2026-10-v1)은 그대로라 기존 동의가 "최신 아님"이 되지 않는다.
 */
export const EFFECTIVE_AT = '2026-10-26'

/** ISO 날짜를 본문용 "2026년 10월 1일"로 */
export function koreanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일`
}

export const SERVICE = 'Preface'

/** 운영 주체. 사업자 등록이 없는 비영리 교육 프로젝트다(사용자 결정 2026-10-26) */
export const OPERATOR = 'SSAFY 15기 자율 프로젝트 S15P31B204 팀(서비스명 Preface, 이하 "운영자")'
export const OPERATOR_NOTE =
  '운영자는 SSAFY 교육 과정의 비영리 교육용 프로젝트 팀이며 사업자 등록 정보가 없습니다.'

/** 개인정보 보호책임자(법 제30조제1항제6호는 "성명 또는 담당 부서의 명칭과 연락처"를 요구한다) */
export const PRIVACY_OFFICER = 'Preface 팀 개인정보 보호 담당'

/**
 * 1차 편집 범위. 사용자 결정(2026-10-26): 1차 MVP 배포는 코만 편집한다. 눈·윤곽은 이후 제공 예정.
 * 수집 항목·목적은 실제 처리대로 쓴다(편집 부위와 무관하게 얼굴 전체를 촬영·복원한다).
 */
export const EDIT_SCOPE =
  '현재 편집할 수 있는 부위는 코이며, 눈·윤곽 편집은 이후 제공할 예정입니다.'

/** 서비스 성격 고지. 요구사항 v2.7 "서비스 범위", REQ-N-07, 기능명세 R-01(승인된 고정 고지 문구) */
export const NATURE_NOTICE = [
  '이 서비스는 성형·시술 상담을 돕는 참고용 시뮬레이션입니다. 화면의 3D 얼굴과 변경 결과는 실제 수술·시술 결과와 다를 수 있습니다.',
  '이 서비스는 의료 진단을 제공하지 않으며 의료행위가 아닙니다. 수술·시술 여부와 방법은 반드시 의사와 상담해 정하세요.',
  '이 서비스는 특정 의료기관·의료인을 소개·알선·광고하지 않습니다.',
] as const

/**
 * 동의를 거두는 방법. 사용자 결정(2026-10-26): 가입 동의 4종은 모두 필수이고 가입 후 개별 철회가 없다.
 * 동의를 거두려면 탈퇴하며, 탈퇴는 모든 데이터를 지체 없이 하드 삭제한다(BE WithdrawalService).
 * 법 제37조제1항(동의 철회)·제3항(지체 없는 파기)을 탈퇴로 보장하는 방식이다.
 */
export const CONSENT_EXIT =
  '가입 때 받은 네 가지 동의(서비스 이용약관, 개인정보 수집·이용, 얼굴 데이터 수집·이용, 얼굴 데이터 공개 범위)는 모두 서비스 제공에 꼭 필요해서 가입 후 하나만 따로 거둘 수는 없습니다. 동의를 거두려면 "내 정보"에서 회원 탈퇴를 하면 되고, 탈퇴는 언제든 바로 할 수 있습니다.'

/** 위 방식의 근거 메모(작성 근거 표). 동의서·처리방침의 해당 절이 같이 쓴다 */
export const CONSENT_EXIT_BASIS = [
  '개인정보 보호법 제37조제1항(동의 철회)·제3항(철회 시 지체 없는 파기) — 개별 철회 대신 언제든 할 수 있는 회원 탈퇴로 철회를 보장하고, 탈퇴하면 지체 없이 하드 삭제한다(사용자 결정 2026-10-26, BE WithdrawalService)',
  '개인정보 보호법 제22조제5항·개인정보 처리 통합 안내서(2025. 7.) Ⅱ장(필수 동의는 최소한으로) — 4종 모두 서비스 제공에 꼭 필요한 항목으로 보고 가입 필수로 둔다(요구사항 REQ-F-32)',
] as const

/**
 * 서버 로그. 인프라 담당 확인(2026-10-26): 앱 접속 로그는 따로 남기지 않고, 컨테이너 로그는 용량 기준으로 순환한다
 * (infra/ec2/app/compose.yaml `max-size: 10m, max-file: "3"`).
 */
export const SERVER_LOG =
  '이용자의 접속 기록을 따로 남기지 않습니다. 서버가 동작하며 남기는 운영 로그(오류·처리 기록)는 정해진 용량이 차면 오래된 기록부터 자동으로 삭제됩니다.'

/**
 * 보관·파기 기준. 저장소 값: API 명세서 v3.2 "0. 공통 규칙 · 삭제 방식", 요구사항 REQ-N-02, 기능명세 FN-HIS-03·04·05,
 * FN-AUTH-04, BE WithdrawalService(탈퇴 후 동의 기록 유지), infra/ec2/app/compose.yaml(컨테이너 로그 10MB×3 순환),
 * docs/specs/service-infra.md(백업 7일, 서울 S3 — 인프라 담당 확인 2026-10-26). 동의·삭제 기록 1년은 사용자 결정 기본값.
 */
export const RETENTION_ROWS: readonly (readonly [string, string])[] = [
  [
    '촬영한 얼굴 영상(원본)',
    '3D 얼굴 생성에 성공하면 바로 삭제합니다. 생성에 실패하면 24시간 뒤 삭제합니다(1시간마다 점검).',
  ],
  [
    '얼굴 사진 5방향(영상에서 뽑은 정면·좌·우·좌 45°·우 45°)',
    '해당 3D 얼굴과 함께 보관하고, 3D 얼굴을 삭제하면 3D와 같은 시점에 함께 삭제합니다. 탈퇴하면 바로 삭제합니다.',
  ],
  [
    '3D 얼굴 모델·썸네일, 시안(변경값·변경 이력), AI 실장님 대화',
    '직접 삭제하거나 탈퇴하기 전까지 보관합니다. 직접 삭제하면 바로 목록에서 사라지고 30일 뒤 영구 삭제합니다. 변경이 없는 빈 시안은 24시간 뒤 정리합니다.',
  ],
  ['회원 정보(소셜 계정 식별자·닉네임·이메일)', '탈퇴하면 바로 삭제합니다.'],
  [
    '가입 중 정보(소셜 계정 식별자 등)',
    '가입을 마치지 않으면 가입 절차 만료(10분) 뒤 삭제하며, 가입을 거절하면 남기지 않습니다.',
  ],
  [
    '동의 기록(동의서 종류·버전·동의 일시)과 삭제 기록(삭제 대상 ID·일시)',
    '동의·삭제 사실의 증빙을 위해 탈퇴 뒤에도 다른 정보와 분리해 1년 보관한 뒤 파기합니다. 이 기록에는 이름·이메일·얼굴 데이터가 들어 있지 않습니다.',
  ],
  ['알림(3D 생성 성공·실패)', '90일 뒤 삭제합니다.'],
  ['서버 운영 로그', SERVER_LOG],
  [
    '데이터베이스 백업',
    '장애 복구용으로 서울 리전 저장소(Amazon S3)에 7일 동안만 보관합니다. 7일이 지난 백업은 삭제되므로, 삭제한 데이터도 백업에서는 최대 7일 뒤 사라집니다.',
  ],
]

/** 탈퇴 */
export const WITHDRAWAL =
  '탈퇴하면 유예 기간 없이 회원 정보, 얼굴 영상·사진, 3D 얼굴, 시안, 상담 기록을 영구 삭제합니다. 이미 삭제 요청해 30일을 기다리던 데이터도 함께 삭제하고, 진행 중이던 3D 생성은 결과를 저장하지 않고 멈춥니다.'

/**
 * AI 상담 처리 범위. REQ-N-10, API 명세서 v3.2 "0. 공통 규칙 · LLM 전송 범위".
 * 사용자 결정(2026-10-26): 상담 문장을 SSAFY GMS로 보내는 것은 처리위탁이고, 저장은 우리 DB에만 한다.
 */
export const LLM_SCOPE =
  'AI 실장님(대화로 얼굴을 바꾸는 기능)의 답변을 만들기 위해, 이용자가 고르거나 입력한 문장과 현재 편집 상태(변경 항목·값)만 수탁자(SSAFY GMS)에 보냅니다. 얼굴 영상·사진·3D 얼굴 이미지는 보내지 않습니다. 문장은 운영자의 데이터베이스에만 저장합니다.'

/** 처리 위탁 표(법 제26조제2항, 시행령 제28조제2항). 인프라: docs/specs/service-infra.md v4, infra/ec2/app/app.env.example */
export const ENTRUSTMENT_ROWS: readonly (readonly [string, string])[] = [
  [
    'Amazon Web Services(서울 리전, ap-northeast-2)',
    '얼굴 영상·사진·3D 얼굴 파일과 데이터베이스 백업 저장(Amazon S3)',
  ],
  [
    'SSAFY',
    '서비스 서버·데이터베이스 운영 환경(Amazon Web Services 서울 리전) 제공, 얼굴 영상으로 3D 얼굴을 만드는 국내 GPU 서버 제공',
  ],
  ['SSAFY GMS', 'AI 상담 답변 생성(AI 실장님에게 보낸 문장 처리)'],
]

/** 수탁자 관리. 법 제26조제1항·제4항·제5항 */
export const ENTRUSTMENT_TERMS =
  '운영자는 수탁자가 위탁 업무 목적 밖으로 개인정보를 처리하지 않도록 요구하고, 위탁한 정보를 학습 등 다른 목적에 이용하지 않도록 요구하며, 수탁자의 처리 범위 안에서만 다루도록 관리·감독합니다. 수탁자나 위탁 업무가 바뀌면 이 처리방침으로 알립니다.'

/**
 * 저장·처리 위치. infra/ec2/app/app.env.example S3_REGION=ap-northeast-2, docs/specs/service-infra.md(서울 EC2, SSAFY GPU 서버).
 * 인프라 담당 확인(2026-10-26): GPU 서버를 빼면 모두 AWS 서울 리전. 버킷 이름 같은 내부 값은 넣지 않는다.
 * 이용 분석 정보(GA4·Clarity)만 국외(미국)로 간다(S15P31B204-447). 그래서 "개인정보"가 아니라 저장하는 정보를 짚어 쓴다.
 */
export const STORAGE_LOCATION =
  '회원 정보, 얼굴 데이터, 시안·대화 같은 서비스 이용 기록은 국내에서만 저장·처리합니다. 서비스 서버·데이터베이스·파일 저장소·백업은 모두 Amazon Web Services 서울 리전(ap-northeast-2)에 있고, 3D 얼굴을 만드는 GPU 서버는 SSAFY가 제공하는 국내 서버입니다.'

/**
 * 이용 분석 도구(S15P31B204-443, apps/web/src/shared/analytics). 처리방침의 목적·항목·보유 기간·위탁·국외 이전·자동 수집 장치에 쓴다.
 * 보유 기간: GA4는 속성의 이벤트 데이터 보관 설정 14개월(2026-10-29 설정), Clarity는 Microsoft 문서 "Data retention"
 * (화면 녹화 30일, 즐겨찾기·라벨·표본 녹화와 히트맵 13개월). 연락처는 각 회사 개인정보 문의 창구.
 */
export const ANALYTICS_ITEMS =
  '이용 분석 정보(방문한 화면 주소·머문 시간·들어온 경로·클릭과 스크롤 위치·브라우저와 기기 종류·화면 크기·대략적 지역, 분석 쿠키 식별자, 화면 이동·클릭 녹화)'

export const ANALYTICS_RECORDING_MASK =
  '화면 녹화에서는 입력한 글자와 얼굴이 나오는 화면(촬영 영상, 3D 얼굴과 썸네일)을 가리고, 휴대폰 촬영 화면은 녹화하지 않습니다.'

export const ANALYTICS_RETENTION =
  'Google Analytics는 14개월, Microsoft Clarity의 화면 녹화는 30일(즐겨찾기·표본 녹화와 히트맵은 13개월) 보관한 뒤 각 회사가 삭제합니다.'

export const ANALYTICS_OPT_OUT =
  '분석 쿠키 거부 방법: 브라우저 설정에서 쿠키를 막거나, Google Analytics 차단 부가 기능(tools.google.com/dlpage/gaoptout)을 설치할 수 있습니다. 분석 쿠키를 막아도 서비스 이용에는 지장이 없습니다.'

/** 처리 위탁 표에 더하는 분석 도구 행 */
export const ANALYTICS_ENTRUSTMENT_ROWS: readonly (readonly [string, string])[] = [
  ['Google LLC', '서비스 이용 통계 분석(Google Analytics)'],
  ['Microsoft Corporation', '화면 이용 분석(클릭 히트맵·화면 녹화, Microsoft Clarity)'],
]

/**
 * 국외 이전 표(법 제28조의8제2항 각 호). 받는 자가 둘뿐이고 칸이 많아, 행은 항목·열은 받는 자로 둔다.
 * 거부 방법·효과는 표 아래 ANALYTICS_OPT_OUT.
 */
export const ANALYTICS_OVERSEAS_HEAD = ['항목', 'Google LLC', 'Microsoft Corporation'] as const

export const ANALYTICS_OVERSEAS_ROWS: readonly (readonly [string, string, string])[] = [
  ['이전 국가', '미국', '미국'],
  [
    '연락처',
    '개인정보 보호 문의 양식(support.google.com/policies/contact/data_privacy_office)',
    '개인정보 보호 문의 양식(aka.ms/privacyresponse)',
  ],
  [
    '이전 항목',
    '이용 분석 정보(화면 녹화 제외)',
    '이용 분석 정보(입력한 글자와 얼굴 화면을 가린 화면 녹화 포함)',
  ],
  [
    '이전 시기·방법',
    '서비스를 이용할 때 브라우저에서 네트워크로 수시 전송',
    '서비스를 이용할 때 브라우저에서 네트워크로 수시 전송',
  ],
  ['이용 목적', '서비스 이용 통계 분석', '화면 이용 분석(클릭 히트맵·화면 녹화)'],
  ['보유 기간', '14개월', '화면 녹화 30일(즐겨찾기·표본 녹화와 히트맵은 13개월)'],
]

/** 권익침해 구제 기관(작성지침 20 예시) */
export const REMEDY_AGENCIES = [
  '개인정보 분쟁조정위원회: (국번 없이) 1833-6972 (www.kopico.go.kr)',
  '개인정보침해 신고센터: (국번 없이) 118 (privacy.kisa.or.kr)',
  '경찰청: (국번 없이) 182 (ecrm.police.go.kr)',
] as const

// ─── 2026-10-v2: AI 관상(S15P31B204-438·439) ────────────────────────────────
//
// 재미로 보는 AI 관상은 3D를 만드는 동안 영상에서 고른 정면 사진 1장을 SSAFY GMS로 보내 풀이 글을 받는다(사용자·팀 결정 2026-10-29).
// v1 문구(LLM_SCOPE·ENTRUSTMENT_ROWS·RETENTION_ROWS)는 이미 동의한 버전의 본문이라 고치지 않고, v2 값을 따로 둔다.

/**
 * FACE_DATA·개인정보 처리방침 2026-10-v2(와 같은 날 시행하는 처리방침 2026-11-v3) 시행일. 처음에는 "중요한 변경은 시행 7일 전 알림"에
 * 맞춰 11-05로 뒀으나, 운영 릴리스(11-03)와 함께 AI 관상·Mattermost 알림을 열기로 해 11-03으로 당겼다(사용자 결정 2026-11-02).
 * BE V19 migration의 effective_at(2026-11-02 15:00 UTC = 2026-11-03 00:00 KST)과 같아야 한다.
 * AI 관상 운영 공개 시각(`face-reading/flag.ts`)도 이 날 00:00 KST다.
 */
export const EFFECTIVE_AT_V2 = '2026-11-03'

/**
 * 처리방침 2026-11-v4·FACE_DATA 2026-11-v3 시행일(S15P31B204-770, 편집실 정면 사진 표시). 2026-11-11 사용자 결정으로 7일 사전
 * 고지 없이 바로 시행한다. BE V33 migration의 effective_at(2026-11-10 15:00 UTC = 2026-11-11 00:00 KST)과 같아야 한다.
 */
export const FRONT_PHOTO_EFFECTIVE_AT = '2026-11-11'

/**
 * 화면 링크(푸터의 처리방침 등)가 가리킬 "현재 버전"의 기준일. 빌드·미리 렌더링 시점에 현재 시각을 읽을 수 없어 고정값으로 둔다.
 * v2 시행일(EFFECTIVE_AT_V2)이 되면 이 값을 그날로 올려야 링크가 v2로 바뀐다(가입 동의서는 BE가 시행일에 맞춰 자동으로 바꾼다).
 */
export const LEGAL_LINK_DATE = '2026-11-11'

/** AI 관상 설명 한 줄(재미용, 근거 없음) */
export const FACE_READING_NOTE =
  '재미로 보는 AI 관상은 오락용 풀이로, 의학적·과학적 근거가 없고 성형 상담이나 진단이 아닙니다.'

/** v2 LLM 전송 범위. v1(`LLM_SCOPE`)에 AI 관상의 정면 사진 1장을 더했다 */
export const LLM_SCOPE_V2 =
  'AI 실장님(대화로 얼굴을 바꾸는 기능)의 답변을 만들기 위해, 이용자가 고르거나 입력한 문장과 현재 편집 상태(변경 항목·값)만 수탁자(SSAFY GMS)에 보냅니다. 이용자가 재미로 보는 AI 관상을 직접 요청하면, 3D를 만드는 동안 영상에서 고른 정면 사진 1장(작게 줄인 것)을 함께 보냅니다. 그 밖의 얼굴 영상·사진·3D 얼굴 이미지는 보내지 않습니다. 문장과 관상 결과(글)는 운영자의 데이터베이스에만 저장하고, 관상에 쓴 사진은 저장하지 않으며 수탁자에게도 저장하지 않도록 요청합니다.'

/** v2 위탁 표. GMS 업무에 AI 관상을 더했다 */
export const ENTRUSTMENT_ROWS_V2: readonly (readonly [string, string])[] = [
  ENTRUSTMENT_ROWS[0],
  ENTRUSTMENT_ROWS[1],
  [
    'SSAFY GMS',
    'AI 상담 답변 생성(AI 실장님에게 보낸 문장 처리), 재미로 보는 AI 관상 풀이 생성(이용자가 요청할 때 정면 사진 1장 처리)',
  ],
]

/**
 * v2 수집 항목에 더한 영상 프레임 묶음(S15P31B204-522). -353 이후 3D를 만들려고 영상에서 뽑은 프레임을 S3에 잠깐 두고,
 * 원본 영상과 같은 때 지운다(BE ReconstructionFinisher·RetentionSweeper, -373 확인).
 */
export const VIDEO_FRAMES_ITEM =
  '영상에서 뽑은 프레임 묶음(3D를 만드는 데만 쓰고, 원본 영상과 같은 때 삭제)'

/**
 * v2 보관 기간. 첫 행에 영상 프레임 묶음을 더하고(-522), 3D 관련 행 다음에 AI 관상 결과 행을 더했다
 * (얼굴 데이터 동의서는 앞 4행을 쓴다)
 */
export const RETENTION_ROWS_V2: readonly (readonly [string, string])[] = [
  ['촬영한 얼굴 영상(원본)과 영상에서 뽑은 프레임 묶음', RETENTION_ROWS[0][1]],
  ...RETENTION_ROWS.slice(1, 3),
  [
    'AI 관상 결과(글)',
    '해당 3D 얼굴과 함께 보관하고, 3D 얼굴을 삭제하거나 탈퇴하면 바로 삭제합니다. 관상에 쓴 정면 사진은 저장하지 않습니다.',
  ],
  ...RETENTION_ROWS.slice(3),
]
