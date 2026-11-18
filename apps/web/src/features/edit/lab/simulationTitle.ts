/**
 * 시안 이름 규칙. 편집실 도구 줄 제목(-812)과 작업실 이름 바꾸기가 함께 쓴다.
 * 예전 `시안 저장` 이름 창(SaveSimulationModal)에 있던 것을 S15P31B204-844에서 창을 걷으며 옮겼다.
 */

/**
 * 시안 이름 1~20자(S15P31B204-838). 서버(API-HIS-05)는 1~100자를 받지만, 작업실 카드·편집 도구 줄에서 한눈에 읽히게 화면에서 20자로 줄인다.
 * 자동으로 붙는 이름(`2026.11.14 시안 7`, 12자 남짓)은 들어간다
 */
export const TITLE_MAX = 20

/** 이름 칸이 한도(TITLE_MAX)에 닿으면 칸 아래에 보이는 안내(S15P31B204-838). 칸은 maxLength로 더 쓰지 못하게 막는다 */
export const TITLE_LIMIT_HINT = `최대 ${TITLE_MAX}자까지 쓸 수 있어요`

/** 앞뒤 공백을 뺀 이름이 규칙에 맞지 않으면 문구, 맞으면 null */
export function validateTitle(title: string): string | null {
  const trimmed = title.trim()
  if (!trimmed) return '시안 이름을 적어 주세요.'
  if (trimmed.length > TITLE_MAX) return `시안 이름은 ${TITLE_MAX}자까지예요.`
  return null
}

/**
 * 서버가 시안을 만들 때 붙이는 이름(API-EDIT-02, `SimulationService.create`): 서울 날짜 `yyyy.MM.dd` + ` 시안`,
 * 같은 날 같은 모델에 이미 있으면 뒤에 ` 2`, ` 3`…이 붙는다. 사용자가 똑같이 적은 이름도 자동 이름으로 본다
 */
const DEFAULT_TITLE = /^\d{4}\.\d{2}\.\d{2} 시안(?: \d+)?$/

/** 아직 자동으로 붙은 이름 그대로인지(S15P31B204-844). 완료 알림에 `이름 바꾸기`를 붙일지 정한다 */
export function isDefaultTitle(title: string): boolean {
  return DEFAULT_TITLE.test(title.trim())
}
