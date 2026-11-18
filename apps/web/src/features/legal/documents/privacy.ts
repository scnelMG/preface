import {
  CONSENT_EXIT,
  CONSENT_EXIT_BASIS,
  EFFECTIVE_AT,
  LLM_SCOPE,
  OPERATOR,
  RETENTION_ROWS,
  WITHDRAWAL,
} from '../facts'
import type { LegalDocument } from '../types'

/**
 * 개인정보 수집·이용 2026-10-v1 (consent_document PRIVACY).
 * 법 제15조제2항 네 가지(목적·항목·보유 기간·거부 권리와 불이익)를 모두 담는다.
 * 사용자 결정(2026-10-26): 서비스 이용에 꼭 필요한 항목은 계약 이행(제15조제1항제4호)이 처리 근거이고,
 * 이 문서는 그 내용을 알리고 확인받는 문서다. 얼굴 데이터는 「얼굴 데이터 수집·이용」에서 별도 동의를 받는다.
 */
export const PRIVACY_2026_10_V1: LegalDocument = {
  slug: 'privacy',
  consentType: 'PRIVACY',
  version: '2026-10-v1',
  title: '개인정보 수집·이용',
  effectiveAt: EFFECTIVE_AT,
  intro: `${OPERATOR}는 회원 가입과 서비스 제공을 위해 아래와 같이 개인정보를 수집·이용합니다. 얼굴 영상·사진·3D 얼굴은 「얼굴 데이터 수집·이용」에서 따로 동의를 받습니다.`,
  sections: [
    {
      id: 'items-purpose',
      title: '수집하는 항목과 목적',
      blocks: [
        {
          kind: 'table',
          caption: '수집 항목과 이용 목적',
          head: ['구분', '항목', '목적'],
          rows: [
            [
              '가입·로그인',
              '소셜 로그인 제공자(카카오·구글), 제공자의 사용자 식별자, 닉네임, 이메일(제공자에서 이메일 제공에 동의한 경우)',
              '회원 식별, 가입·로그인, 중복 가입 방지',
            ],
            ['동의 기록', '동의서 종류·버전, 동의 일시', '동의 받은 사실의 증빙'],
            [
              '서비스 이용',
              'AI 실장님 대화(실제 인물 이름은 [인물]로 바꾼 문장), 시안 이름·변경값·변경 이력, 알림',
              '참고용 성형 상담 시뮬레이션 제공, 자동 저장과 되돌리기, 3D 생성 결과 알림',
            ],
            [
              '휴대폰 연결',
              '휴대폰 연결용 일회용 코드(원문은 저장하지 않고 해시만 저장)',
              'PC와 휴대폰을 연결해 휴대폰으로 촬영·업로드',
            ],
            [
              '자동 수집',
              '로그인 유지 쿠키, 서버 운영 로그(오류·처리 기록, 용량 기준 자동 삭제)',
              '로그인 유지, 장애 대응',
            ],
          ],
        },
        {
          kind: 'p',
          text: '위 항목은 서비스 이용 계약을 맺고 이행하는 데 꼭 필요한 정보로, 「개인정보 보호법」 제15조제1항제4호(계약의 체결·이행)에 따라 처리합니다.',
        },
        { kind: 'p', text: LLM_SCOPE },
      ],
      basis: [
        '개인정보 보호법 제15조제1항제4호(계약 이행), 제15조제2항제1호(목적)·제2호(항목), 제22조제3항(동의 없이 처리하는 항목은 법적 근거와 구분해 알림)',
        '개인정보 처리 통합 안내서(2025. 7.) Ⅱ장 — 계약 이행에 필요한 범위는 동의 없이 처리, 필수 동의 최소화',
        'BE V1__init.sql(user·social_account·user_consent·consult_message·notification), API 명세서 v3.2 QR·CON 절',
      ],
    },
    {
      id: 'retention',
      title: '보유·이용 기간',
      important: true,
      blocks: [
        {
          kind: 'table',
          caption: '보유·이용 기간',
          head: ['항목', '기간'],
          rows: RETENTION_ROWS,
        },
        { kind: 'p', text: WITHDRAWAL },
      ],
      basis: [
        '개인정보 보호법 제15조제2항제3호(보유·이용 기간), 제21조제1항(지체 없는 파기)·제3항(보존 시 분리 저장)',
        '시행령 제17조제3항제3호(보유 기간은 중요한 내용으로 명확히 표시)',
        '요구사항 REQ-N-02, API 명세서 v3.2 "0. 공통 규칙 · 삭제 방식", BE WithdrawalService(탈퇴 후 동의 기록 유지)',
        '서버 운영 로그: infra/ec2/app/compose.yaml(컨테이너 로그 용량 기준 순환), 인프라 담당 확인(2026-10-26 — 앱 접속 로그 없음)',
        '백업 7일·서울 리전 S3: docs/specs/service-infra.md, 인프라 담당 확인(2026-10-26)',
      ],
    },
    {
      id: 'refuse',
      title: '동의를 거부할 권리',
      blocks: [
        {
          kind: 'p',
          text: '동의하지 않을 수 있습니다. 다만 이 항목은 서비스 이용에 꼭 필요해서, 동의하지 않으면 가입할 수 없고 로그인 화면으로 돌아갑니다. 가입하지 않으면 회원 정보와 동의 기록을 남기지 않습니다.',
        },
        { kind: 'p', text: CONSENT_EXIT },
      ],
      basis: [
        ...CONSENT_EXIT_BASIS,
        '개인정보 보호법 제15조제2항제4호(거부 권리와 불이익)',
        '시행령 제17조제4항(동의 여부를 선택할 수 있다는 사실을 명확히 표시)',
        '요구사항 REQ-F-32(거절 시 가입 불가·로그인 복귀), API-AUTH-08',
      ],
    },
  ],
}
