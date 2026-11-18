import type { LegalDocument, LegalSection } from './types'

/**
 * 새 버전 문서를 이전 버전에서 바뀐 섹션만 바꿔 만든다. 이전 버전 객체는 건드리지 않는다(동의 증빙인 본문이 바뀌지 않게).
 * `replace`의 키는 섹션 id, 값은 이전 섹션을 받아 새 섹션을 돌려주는 함수다. 없는 id를 주면 실수이므로 던진다.
 */
export function revise(
  base: LegalDocument,
  next: Pick<LegalDocument, 'version' | 'effectiveAt'>,
  replace: Record<string, (section: LegalSection) => LegalSection>,
): LegalDocument {
  const ids = new Set(base.sections.map((section) => section.id))
  for (const id of Object.keys(replace)) {
    if (!ids.has(id)) throw new Error(`없는 섹션: ${base.slug}#${id}`)
  }
  return {
    ...base,
    ...next,
    sections: base.sections.map((section) => replace[section.id]?.(section) ?? section),
  }
}
