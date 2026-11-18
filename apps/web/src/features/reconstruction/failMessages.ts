import type { FailCode } from './types'

/**
 * 복원 실패 FE 문구 사전 (REQ-F-06, FN-CAP-03 수용 2·4).
 *
 * 서버·워커는 사용자 문구를 내리지 않고 코드 목록(`failCodes[]`)만 준다(FN-CAP-03 수용 3, API-REC-02 비고).
 * 코드마다 **이유**와 **고치는 방법**을 짝으로 둔다. 코드 목록 원본은 API 명세서 REC-02 `failCodes`.
 * QUALITY_ANGLE·QUALITY_LIGHT 문구는 Figma Wireframe v3.2 SCR-09(267:2695) 예시 그대로다.
 * 문구를 바꾸면 R-01(UI 문구 금칙어) 검토 대상이다.
 */
export interface FailMessage {
  /** 무엇이 잘못됐는지 */
  reason: string
  /** 다시 찍을 때 어떻게 하면 되는지 */
  fix: string
}

export const FAIL_MESSAGES: Record<FailCode, FailMessage> = {
  QUALITY_NO_FACE: {
    reason: '영상에서 얼굴을 찾지 못했어요',
    fix: '얼굴 전체가 화면 가운데 오도록 하고, 마스크·모자·앞머리로 가리지 말고 찍어 주세요.',
  },
  QUALITY_ANGLE: {
    reason: '옆모습이 충분히 담기지 않았어요',
    fix: '휴대폰을 얼굴 옆쪽까지 조금 더 옮겨 주세요.',
  },
  QUALITY_LIGHT: {
    reason: '너무 밝거나 어두워요',
    fix: '창문을 등지지 말고 얼굴 앞쪽이 밝은 곳에서 찍어 주세요.',
  },
  QUALITY_COMPRESSED: {
    reason: '영상 화질이 너무 낮아요',
    fix: '메신저로 받거나 편집한 영상 말고, 휴대폰으로 찍은 원본 영상을 그대로 올려 주세요.',
  },
  FIT_FAILED: {
    reason: '얼굴 모양을 3D로 맞추지 못했어요',
    // 사진 관련 단계가 실패했다는 것만 안다(워커 build_failure). 원인을 단정하지 않는다(-420)
    fix: '얼굴이 잘 보이게, 휴대폰을 천천히 옮기며 다시 찍어 주세요.',
  },
  TIMEOUT: {
    reason: '3D를 만드는 데 시간이 너무 오래 걸렸어요',
    fix: '영상 문제는 아닐 수 있어요. 잠시 뒤 다시 시도해 주세요.',
  },
  INTERNAL: {
    reason: '서버에 문제가 생겨 3D를 만들지 못했어요',
    fix: '영상 문제는 아니에요. 잠시 뒤 다시 시도해 주세요.',
  },
}

/** 사전에 없는 코드(서버가 새 코드를 먼저 내린 경우)나 코드가 비었을 때 */
export const UNKNOWN_FAIL_MESSAGE: FailMessage = {
  reason: '3D를 만들지 못했어요',
  fix: '밝은 곳에서 휴대폰을 얼굴 둘레로 천천히 옮겨 다시 찍어 주세요.',
}

/**
 * 실패 코드 목록 → 화면에 보일 문구 목록. 여러 개면 모두, 받은 순서대로 보여 준다.
 * 같은 코드가 겹치면 한 번만, 모르는 코드는 일반 문구 하나로 모은다. 빈 목록이면 일반 문구 하나.
 */
export function failMessagesOf(codes: readonly string[]): FailMessage[] {
  const seen = new Set<string>()
  const messages: FailMessage[] = []
  let unknownAdded = false
  for (const code of codes) {
    if (seen.has(code)) continue
    seen.add(code)
    const known = (FAIL_MESSAGES as Record<string, FailMessage | undefined>)[code]
    if (known) messages.push(known)
    else if (!unknownAdded) {
      unknownAdded = true
      messages.push(UNKNOWN_FAIL_MESSAGE)
    }
  }
  return messages.length ? messages : [UNKNOWN_FAIL_MESSAGE]
}
