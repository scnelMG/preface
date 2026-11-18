import type { LegalSource } from './types'

/**
 * 동의서·약관을 쓸 때 본 공식 출처. 날짜는 2026-10-26에 원문을 열어 확인한 판이다.
 * 법령이 개정되면 이 목록과 해당 조항을 같이 고친다.
 */
export const LEGAL_SOURCES: readonly LegalSource[] = [
  {
    id: 'pipa',
    name: '개인정보 보호법',
    org: '국가법령정보센터(법제처)',
    edition: '법률 제21445호, 2026. 3. 10. 일부개정, 2026. 9. 11. 시행',
    url: 'https://www.law.go.kr/법령/개인정보보호법',
  },
  {
    id: 'pipa-decree',
    name: '개인정보 보호법 시행령',
    org: '국가법령정보센터(법제처)',
    edition: '대통령령 제36671호, 2026. 9. 10. 일부개정, 2026. 9. 11. 시행',
    url: 'https://www.law.go.kr/법령/개인정보보호법시행령',
  },
  {
    id: 'terms-act',
    name: '약관의 규제에 관한 법률',
    org: '국가법령정보센터(법제처)',
    edition: '법률 제20239호, 2024. 2. 6. 타법개정, 2024. 8. 7. 시행',
    url: 'https://www.law.go.kr/법령/약관의규제에관한법률',
  },
  {
    id: 'medical-act',
    name: '의료법',
    org: '국가법령정보센터(법제처)',
    edition: '법률 제21490호, 2026. 3. 24. 타법개정, 2026. 10. 2. 시행',
    url: 'https://www.law.go.kr/법령/의료법',
  },
  {
    id: 'policy-guide',
    name: '개인정보 처리방침 작성지침 (부록 1 생성형 AI 서비스 처리방침 포함)',
    org: '개인정보보호위원회 자율보호정책과',
    edition: '2026. 4. 개정',
    url: 'https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=12018',
  },
  {
    id: 'integrated-guide',
    name: '개인정보 처리 통합 안내서 (종전 「알기 쉬운 개인정보 처리 동의 안내서」·「위·수탁 안내서」 통합)',
    org: '개인정보보호위원회',
    edition: '2025. 7. 제정',
    url: 'https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=11352',
  },
  {
    id: 'biometric-guide',
    name: '생체정보 보호 안내서 (종전 「생체정보 보호 가이드라인」(2021. 9.) 통합)',
    org: '개인정보보호위원회',
    edition: '2024. 12.',
    url: 'https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030000&nttId=10900',
  },
]
