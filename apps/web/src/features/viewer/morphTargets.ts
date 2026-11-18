/**
 * API morph code(`nose.bridge_height` 등, MorphState.weights의 키) → GLB morph target(blendshape) 대응.
 *
 * 원본 계약: contracts/edit/effects-v1.md (S15P31B204-71). 계약은 서비스 저장 코드와 PoC 내부 키
 * (`dorsum_height` 등)까지만 정했고, **GLB 안 morph target 이름은 아직 정하지 않았다**(확인 필요).
 * 그래서 이 파일 한 곳에 대응표를 두고, 이름 후보를 순서대로 찾는다.
 *
 * 1. 서비스 저장 코드 그대로 (`nose.bridge_height`)
 * 2. PoC 내부 키 (`dorsum_height`, 계약 표의 "PoC 내부 키")
 *
 * 부호별 한계가 다른 모델(계약 "값과 지원 범위")을 위해 한 효과를 두 target으로 나눈 경우도 받는다.
 * 이름 뒤에 `_pos`·`_neg`를 붙인 쌍이 있으면 양수 weight는 `_pos`에, 음수 weight는 `|weight|`로 `_neg`에 준다.
 * 쌍이 없으면 target 하나에 weight를 부호 그대로 준다(three.js는 음수 influence를 반대 방향으로 그린다).
 *
 * 이 모듈은 three.js를 불러오지 않는다(타입도 구조로만 받는다). 서버 번들·Vitest에서 그대로 쓴다.
 */

/** 서비스 저장 코드 → PoC 내부 키. FE와 최종 메시 검사가 같은 표를 쓴다. */
import { POC_MORPH_KEYS as SHARED_CODES } from '../../../../../services/gpu-worker/reconstruction/engine/effect-codes.mjs'
export const POC_MORPH_KEYS: Readonly<Record<string, string>> = SHARED_CODES

/** 윤곽 코드. 엔진 없이 GLB morph target 쌍(`_neg`·`_pos`)으로만 움직인다(tools/contour_morphs.py가 굽는다) */
import { CONTOUR_CODES as SHARED_CONTOUR_CODES } from '../../../../../services/gpu-worker/reconstruction/engine/contour-codes.mjs'
export const CONTOUR_CODES: readonly string[] = SHARED_CONTOUR_CODES

/** 대응표에 있는 저장 코드 전체. Before·After를 같은 기준(0)에서 시작하려고 먼저 0으로 맞출 때 쓴다 */
export const KNOWN_MORPH_CODES: readonly string[] = [
  ...Object.keys(POC_MORPH_KEYS),
  ...CONTOUR_CODES,
]

/** 계약상 공개 weight 범위. 양방향 효과 [-1, 1] (계약 "값과 지원 범위") */
export const WEIGHT_LIMIT = 1

export const POSITIVE_SUFFIX = '_pos'
export const NEGATIVE_SUFFIX = '_neg'

/** three.js Mesh에서 쓰는 두 필드만 본다. 테스트에서는 평범한 객체로 만든다 */
export interface MorphTargetHolder {
  morphTargetDictionary?: Record<string, number>
  morphTargetInfluences?: number[]
}

export type MorphBinding =
  { kind: 'single'; index: number } | { kind: 'split'; positive: number; negative: number }

/** code가 GLB에서 찾을 이름 후보(우선순위 순) */
export function morphTargetCandidates(code: string): string[] {
  const poc = POC_MORPH_KEYS[code]
  return poc ? [code, poc] : [code]
}

/** 한 메시 안에서 code에 해당하는 target을 찾는다. 없으면 null(이 모델이 지원하지 않는 효과) */
export function resolveMorphBinding(
  dictionary: Readonly<Record<string, number>>,
  code: string,
): MorphBinding | null {
  for (const name of morphTargetCandidates(code)) {
    const positive = dictionary[name + POSITIVE_SUFFIX]
    const negative = dictionary[name + NEGATIVE_SUFFIX]
    if (positive !== undefined && negative !== undefined) {
      return { kind: 'split', positive, negative }
    }
    const single = dictionary[name]
    if (single !== undefined) return { kind: 'single', index: single }
  }
  return null
}

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0
  return Math.min(WEIGHT_LIMIT, Math.max(-WEIGHT_LIMIT, weight))
}

/**
 * 가중치를 메시들의 morph target influence에 그대로 적용한다.
 *
 * - `codes`에 든 모든 효과를 먼저 0으로 되돌린 뒤 weights를 쓴다. weights에서 빠진 키는 0(원본)이다.
 *   그래서 Before에는 빈 weights를 주면 원본이 된다.
 * - 대응표에 없는 target(모델 고유 표정 등)은 건드리지 않는다.
 * - 반환값: weights에 있지만 어느 메시에서도 찾지 못한 code(미지원 효과). 화면에서 알릴 때 쓴다.
 */
export function applyMorphWeights(
  holders: Iterable<MorphTargetHolder>,
  weights: Readonly<Record<string, number>>,
  codes: Iterable<string> = Object.keys(weights),
): string[] {
  const allCodes = new Set([...codes, ...Object.keys(weights)])
  const found = new Set<string>()

  for (const holder of holders) {
    const dictionary = holder.morphTargetDictionary
    const influences = holder.morphTargetInfluences
    if (!dictionary || !influences) continue

    for (const code of allCodes) {
      const binding = resolveMorphBinding(dictionary, code)
      if (!binding) continue
      found.add(code)
      const weight = clampWeight(weights[code] ?? 0)
      if (binding.kind === 'single') {
        influences[binding.index] = weight
      } else {
        influences[binding.positive] = weight > 0 ? weight : 0
        influences[binding.negative] = weight < 0 ? -weight : 0
      }
    }
  }

  return Object.keys(weights).filter((code) => !found.has(code) && (weights[code] ?? 0) !== 0)
}

/** 메시들이 지원하는 code 목록(대응표·저장 코드 기준). 개발 페이지와 미지원 안내용 */
export function supportedCodes(
  holders: Iterable<MorphTargetHolder>,
  codes: Iterable<string>,
): string[] {
  const list = [...holders]
  return [...codes].filter((code) =>
    list.some((holder) => {
      const binding =
        holder.morphTargetDictionary && resolveMorphBinding(holder.morphTargetDictionary, code)
      return binding && (code !== 'contour.weight_shape' || binding.kind === 'split')
    }),
  )
}
