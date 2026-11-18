/**
 * 공유 링크의 보내는 사람 이름(S15P31B204-843). 공유한 사람이 직접 적은 값만 쓴다. 계정 닉네임을 미리 채우거나 대신 보내지 않는다.
 *
 * BE `ShareSenderName`과 같은 규칙이다: 앞뒤 공백을 지운 뒤 1~20자(코드 포인트), 비었으면 이름 없음.
 * 제어·서식 문자(방향 바꾸기·폭 없는 문자 등)와 줄/문단 구분자는 받지 않는다.
 */
export const SENDER_NAME_MAX = 20

const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

export type SenderNameCheck =
  { ok: true; name: string | null } | { ok: false; reason: 'too-long' | 'invalid-char' }

/** 글자 수(코드 포인트). 이모지 하나도 1자로 센다(BE와 같다) */
export function senderNameLength(value: string) {
  return [...value].length
}

/**
 * 입력칸 `maxLength`. 브라우저는 UTF-16 단위로 세므로, 남은 글자 수만큼만 더 받게 해 코드 포인트 20자에서 멈춘다.
 * 비어 있으면 20이다. 이미 20자를 넘었으면(긴 글을 붙인 경우) 더 늘지 않게 지금 길이로 둔다.
 */
export function nameMaxLength(value: string) {
  return value.length + Math.max(0, SENDER_NAME_MAX - senderNameLength(value))
}

export function checkSenderName(raw: string): SenderNameCheck {
  const name = raw.trim()
  if (!name) return { ok: true, name: null }
  if (senderNameLength(name) > SENDER_NAME_MAX) return { ok: false, reason: 'too-long' }
  if (FORBIDDEN.test(name)) return { ok: false, reason: 'invalid-char' }
  return { ok: true, name }
}
