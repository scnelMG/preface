/** 조건부 className을 합친다. falsy 값은 빠진다 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
