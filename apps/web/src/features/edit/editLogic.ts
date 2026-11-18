import { ErrorCode } from '@/shared/api/errorCodes'
import { formatPercent } from '@/shared/ui/format'
import { noseControls, TIP_HEIGHT_CODE, TIP_ROTATION_CODE } from './noseControls'
import { WEIGHT_SHAPE_CODE, weightShapeLabel } from './weightShapeControls'
import type { AppliedChange, MorphParameterCatalog, MorphState } from './types'

/**
 * 실험실 화면의 순수 계산. React·API를 모른다(테스트 대상).
 */

const EPSILON = 1e-9

/**
 * 1차 MVP에서 편집할 수 있는 부위. 눈은 `연결 예정`으로 막는다(2026-10-26 사용자 결정: 1차 배포는 코만).
 * EDIT-01이 EYE 항목을 줘도 슬라이더·상담 슬라이더 열기·3D 반영에 쓰지 않는다.
 */
// 2026-11-03: 윤곽(광대·턱끝·볼·턱선) 시험 연결. GLB에 윤곽 morph target이 없는 모델은 줄마다 잠긴다
export const EDITABLE_PARTS: ReadonlySet<string> = new Set(['NOSE', 'CONTOUR'])

/** 1차에서 막은 눈 코드(`eye.*`)인지 */
export function isLockedCode(code: string): boolean {
  return code.startsWith('eye.')
}

/**
 * 3D에 넘길 가중치. 막은 눈 값은 빼서, 예전 시안에 눈 값이 남아 있어도 After에 보이지 않게 한다.
 * 저장된 값 자체는 건드리지 않는다.
 */
export function viewerWeights(weights: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(weights).filter(([code]) => !isLockedCode(code)))
}

/**
 * 원본과 다른 항목 수. 상태 줄 "N개 항목 조절"과 `처음으로` 활성 여부에 쓴다.
 * 1차에서 막은 눈 값은 화면에도 3D에도 보이지 않으니 세지 않는다(보이는 변화만 센다).
 */
export function countAdjusted(weights: Readonly<Record<string, number>>): number {
  const active = Object.entries(weights).filter(
    ([code, w]) => !isLockedCode(code) && Math.abs(w) > EPSILON,
  )
  const height = weights[TIP_HEIGHT_CODE] ?? 0
  const rotation = weights[TIP_ROTATION_CODE] ?? 0
  // 코끝 높이·회전이 한 슬라이더의 0.6:0.4 결속값이면 화면에서도 한 항목이다.
  const coupled =
    Math.abs(height) > EPSILON &&
    Math.abs(rotation) > EPSILON &&
    Math.abs(rotation - (height * 2) / 3) <= 0.001
  return active.length - Number(coupled)
}

/**
 * 서버 응답으로 상태를 맞추되, 아직 서버에 보내지 않은 슬라이더 값(pending)은 화면 값을 유지한다.
 * 저장 요청이 도는 동안 다른 슬라이더를 움직이면 그 값이 서버 응답에 덮이지 않게 한다.
 */
export function overlayPending(
  server: Readonly<Record<string, number>>,
  local: Readonly<Record<string, number>>,
  pendingCodes: Iterable<string>,
): Record<string, number> {
  const merged: Record<string, number> = { ...server }
  for (const code of pendingCodes) {
    if (code in local) merged[code] = local[code]
  }
  return merged
}

/** 서버가 편집할 수 있는 가중치 코드 앞부분(BE MorphEdits.EDITABLE_PREFIXES와 같다) */
const EDITABLE_PREFIXES = ['nose.', 'contour.'] as const

/**
 * `처음으로`(API-EDIT-07)가 돌려줄 상태. BE SimulationService.originalMorphState와 같은 규칙이다:
 * 편집할 수 있는 코·윤곽 가중치(체중 변화 포함)를 지우고, 점 편집·눈 편집을 비운다. 그 밖의 값(막은 예전 눈 값 등)은 남긴다.
 * 응답을 기다리지 않고 화면에 먼저 보이는 데 쓴다.
 */
export function originalMorphState(state: MorphState): MorphState {
  return {
    ...state,
    weights: Object.fromEntries(
      Object.entries(state.weights).filter(
        ([code]) => !EDITABLE_PREFIXES.some((prefix) => code.startsWith(prefix)),
      ),
    ),
    pointStrokes: [],
    eyeEdit: null,
  }
}

const SIDE_LABEL: Record<string, string> = { left: '왼쪽', right: '오른쪽' }

/**
 * 저장 코드의 화면 이름. 카탈로그에 있으면 그 label, 눈 v2 코드(`eye.open.left`)는 효과 이름 + 좌우,
 * 없으면 코드 그대로.
 */
export function labelOf(catalog: MorphParameterCatalog | null, code: string): string {
  if (code === 'nose.tip_projection') return '코끝 앞뒤'
  if (code === WEIGHT_SHAPE_CODE) return '체중 변화'
  const items = catalog?.parts.flatMap((p) => p.items) ?? []
  const exact = items.find((item) => item.code === code)
  if (exact) return exact.label
  const match = /^(.*)\.(left|right)$/.exec(code)
  if (match) {
    const base = items.find((item) => item.code === match[1])
    if (base) return `${base.label}(${SIDE_LABEL[match[2]]})`
  }
  return code
}

/** 적용 카드 한 줄: "+10% → +20%" */
export function describeChange(change: Pick<AppliedChange, 'from' | 'to'>): string {
  return `${formatPercent(change.from)} → ${formatPercent(change.to)}`
}

/** 비로그인 체험의 브라우저 안 되돌리기 이력. 서버 이력과 같은 50단계 */
export const GUEST_HISTORY_LIMIT = 50

export function pushHistory<T>(stack: readonly T[], entry: T, limit = GUEST_HISTORY_LIMIT): T[] {
  const next = [...stack, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** 두 가중치가 같은가(누락 키 = 0) */
export function sameWeights(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > EPSILON) return false
  }
  return true
}

/**
 * EDIT-01을 못 받았을 때 쓰는 코 3항목. 명세서 v3.1 EDIT-01 예시(v1, DB 시드 V3)와 같다.
 * 비로그인 체험이 서버 없이도 열리도록 한다. 회원 화면은 서버 카탈로그를 기다린다.
 */
export const FALLBACK_CATALOG: MorphParameterCatalog = {
  schemaVersion: 'v1',
  parts: [
    {
      part: 'NOSE',
      label: '코',
      items: [
        {
          code: 'nose.bridge_height',
          subPart: 'BRIDGE',
          label: '콧대 높이',
          min: -0.5,
          max: 0.8,
          default: 0,
          step: 0.05,
        },
        {
          code: 'nose.tip_height',
          subPart: 'TIP',
          label: '코끝',
          min: -0.5,
          max: 0.5,
          default: 0,
          step: 0.05,
        },
        {
          code: 'nose.alar_width',
          subPart: 'ALAR',
          label: '콧볼 너비',
          min: -0.5,
          max: 0.5,
          default: 0,
          step: 0.05,
        },
      ],
    },
  ],
}

/**
 * 항목을 직접 조절 슬라이더 순서(카탈로그 순서: 부위 → 항목)로 정렬한다.
 * 좌우 코드는 좌우 없는 항목 자리에 왼쪽·오른쪽 순으로, 카탈로그에 없는 코드는 맨 뒤에 원래 순서대로 둔다.
 */
export function orderByCatalog<T>(
  catalog: MorphParameterCatalog | null,
  list: readonly T[],
  codeOf: (entry: T) => string,
): T[] {
  const index = new Map<string, number>()
  catalog?.parts
    .flatMap((p) => p.items)
    .forEach((item, i) => {
      if (!index.has(item.code)) index.set(item.code, i)
    })
  const rank = (code: string): number => {
    const exact = index.get(code)
    if (exact !== undefined) return exact
    const match = /^(.*)\.(left|right)$/.exec(code)
    const base = match ? index.get(match[1]) : undefined
    if (base !== undefined) return base + (match?.[2] === 'left' ? 0.25 : 0.5)
    return Number.POSITIVE_INFINITY
  }
  return list
    .map((entry, i) => ({ entry, i, rank: rank(codeOf(entry)) }))
    .sort((a, b) => (a.rank === b.rank ? a.i - b.i : a.rank - b.rank))
    .map(({ entry }) => entry)
}

/**
 * 슬라이더 한 번 조절(손을 뗀 뒤 저장된 값). `from`·`to`는 원본 대비 가중치.
 * `requested`는 보낸 값이다. 서버가 이 얼굴에서 바꿀 수 있는 한계로 줄였으면 `to`와 다르다.
 */
export interface SliderChange extends Pick<AppliedChange, 'code' | 'from' | 'to'> {
  requested?: number
}

/**
 * 손을 뗀 순간(저장 응답 전) 화면이 확정할 수 있는 변경. 확정할 수 없으면 null이다(S15P31B204-852).
 * - 코(`nose.`)는 null. 서버 검사기가 모델별 승인 범위 안에서도 형상을 보고 값을 더 줄이거나 그대로 둘 수 있어
 *   (NoseEditService → NoseEditValidation.requireSafeActual) 응답을 봐야 알 수 있다.
 * - 나머지(윤곽·체중 변화)는 서버가 카탈로그 범위로만 자른다(MorphEdits). 화면이 아는 범위(`catalog`, 모델별
 *   범위를 씌운 것)를 넘었으면 그 끝으로 잘라 `requested`에 보낸 값을 남긴다. 그러면 알림이 바로 한계 문구가 된다.
 */
export function confirmableChanges(
  catalog: MorphParameterCatalog | null,
  changes: readonly SliderChange[],
): SliderChange[] | null {
  if (changes.some((change) => change.code.startsWith('nose.'))) return null
  const items = new Map(
    (catalog?.parts ?? []).flatMap((part) => part.items.map((item) => [item.code, item] as const)),
  )
  return changes.map((change) => {
    const item = items.get(change.code)
    if (!item) return change
    const to = Math.min(item.max, Math.max(item.min, change.to))
    return to === change.to ? change : { ...change, to, requested: change.to }
  })
}

/** 두 가중치 사이에서 값이 달라진 항목(누락 키 = 0). 비로그인 체험의 커밋 요약에 쓴다 */
export function diffWeights(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): SliderChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .map((code) => ({ code, from: before[code] ?? 0, to: after[code] ?? 0 }))
    .filter((change) => Math.abs(change.to - change.from) > EPSILON)
}

/** 편집 알림의 종류. 문구 끝만 다르다 */
export type EditFeedbackKind = 'change' | 'undo' | 'redo'

/** 되돌리기·앞으로 가기 문구 끝. 슬라이더 조절(`change`)은 수치를 알리지 않는다(S15P31B204-852) */
const FEEDBACK_VERB: Record<Exclude<EditFeedbackKind, 'change'>, string> = {
  undo: '되돌렸어요',
  redo: '다시 바꿨어요',
}

/** 바뀐 값이 없을 때(눈·점 편집만 되돌렸을 때 등) 되돌리기·앞으로 가기 문구 */
const FEEDBACK_FALLBACK: Record<Exclude<EditFeedbackKind, 'change'>, string> = {
  undo: '이전 상태로 되돌렸어요',
  redo: '다음 상태로 다시 바꿨어요',
}

/** 받침이 있으면 `을`·`은`, 없으면 `를`·`는`. 한글로 끝나지 않으면 `을(를)`·`은(는)` */
function particle(word: string, [withFinal, withoutFinal]: readonly [string, string]): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (Number.isNaN(code) || code < 0 || code > 11171) return `${withFinal}(${withoutFinal})`
  return code % 28 ? withFinal : withoutFinal
}

interface ShownItem {
  codes: readonly string[]
  label: string
  /** 화면 슬라이더 값(`+20%`). 코끝 위아래가 개별 값이면 null */
  value: string | null
}

/**
 * 가중치를 화면 슬라이더 단위로 읽는다. 코 조절은 슬라이더 이름(`콧대 높이`·`코끝 위아래`)과
 * 슬라이더에 보이는 %(모델별 승인 범위 끝 = ±100%)를 쓰고, 코끝 높이·회전 두 저장값은 한 항목이다.
 * 슬라이더가 없는 코드는 카탈로그 이름과 저장값 %로 읽는다. 순서는 슬라이더 순서다.
 */
function shownItems(
  catalog: MorphParameterCatalog | null,
  codes: ReadonlySet<string>,
  weights: Readonly<Record<string, number>>,
): ShownItem[] {
  const items: ShownItem[] = []
  const covered = new Set<string>()
  if (codes.has(WEIGHT_SHAPE_CODE)) {
    covered.add(WEIGHT_SHAPE_CODE)
    items.push({
      codes: [WEIGHT_SHAPE_CODE],
      label: '체중 변화',
      value: weightShapeLabel(weights[WEIGHT_SHAPE_CODE] ?? 0),
    })
  }
  for (const control of catalog ? noseControls(catalog, weights) : []) {
    const own = control.effects.map((effect) => effect.code)
    if (!own.some((code) => codes.has(code))) continue
    own.forEach((code) => covered.add(code))
    items.push({
      codes: own,
      label: control.accessibleLabel,
      value: control.mixed ? null : formatPercent(control.value),
    })
  }
  const rest = orderByCatalog(
    catalog,
    [...codes].filter((code) => !covered.has(code)),
    (code) => code,
  )
  for (const code of rest) {
    items.push({
      codes: [code],
      label: labelOf(catalog, code),
      value: formatPercent(weights[code] ?? 0),
    })
  }
  return items
}

/**
 * 편집 알림 한 줄. 값은 바뀐 뒤 슬라이더 값이다.
 * - 슬라이더 조절(`change`)은 수치를 알리지 않고 안전 범위(한계)에 걸렸을 때만 알린다(S15P31B204-852).
 *   보낸 값과 받은 값의 화면 %가 다르면 일부만 바꿨을 때 `콧대 높이는 +40%까지만 바꿀 수 있어요`,
 *   하나도 못 바꿨을 때(받은 값 = 움직이기 전 값) `콧대 높이는 이 얼굴에서 더 바꿀 수 없어요`. 한계가 아니면 null.
 * - 되돌리기·앞으로 가기 한 항목: `콧대 높이 +10%로 되돌렸어요` · `콧대 높이 +20%로 다시 바꿨어요`
 * - 여러 항목: 슬라이더 순서 첫 항목 + `외 N개` — `콧대 높이 +20% 외 1개를 되돌렸어요`
 * - 코끝 위아래(높이·회전 두 저장값)는 한 항목이다. 두 값이 결속을 벗어나 개별 값이면 `코끝 위아래를 되돌렸어요`
 *
 * `weights`는 바뀐 뒤 전체 가중치다. 코끝 위아래처럼 두 저장값 중 하나만 바뀐 경우에도 화면 값을 읽으려고 쓴다.
 * 바뀐 값이 없으면 되돌리기·앞으로 가기는 일반 문구를 쓴다.
 */
export function summarizeEdit(
  catalog: MorphParameterCatalog | null,
  changes: readonly SliderChange[],
  kind: EditFeedbackKind = 'change',
  weights: Readonly<Record<string, number>> = {},
): string | null {
  const after: Record<string, number> = { ...weights }
  const requested: Record<string, number> = { ...weights }
  const before: Record<string, number> = { ...weights }
  for (const change of changes) {
    after[change.code] = change.to
    requested[change.code] = change.requested ?? change.to
    before[change.code] = change.from
  }

  const limitedCodes = new Set(
    changes.filter((change) => change.requested !== undefined).map((change) => change.code),
  )
  if (limitedCodes.size) {
    const wanted = shownItems(catalog, limitedCodes, requested)
    const actual = shownItems(catalog, limitedCodes, after)
    const original = shownItems(catalog, limitedCodes, before)
    const index = actual.findIndex(
      (item, i) => item.value !== null && item.value !== wanted[i]?.value,
    )
    const limited = actual[index]
    if (limited) {
      if (limited.value === original[index]?.value)
        return `${limited.label}${particle(limited.label, ['은', '는'])} 이 얼굴에서 더 바꿀 수 없어요`
      return `${limited.label}${particle(limited.label, ['은', '는'])} ${limited.value}까지만 바꿀 수 있어요`
    }
  }
  if (kind === 'change') return null

  const moved = new Set(
    changes.filter((change) => Math.abs(change.to - change.from) > EPSILON).map((c) => c.code),
  )
  const items = shownItems(catalog, moved, after)
  const verb = FEEDBACK_VERB[kind]
  if (!items.length) return FEEDBACK_FALLBACK[kind]
  const [first] = items
  if (items.length > 1) {
    const subject = first.value === null ? first.label : `${first.label} ${first.value}`
    return `${subject} 외 ${items.length - 1}개를 ${verb}`
  }
  if (first.value === null) return `${first.label}${particle(first.label, ['을', '를'])} ${verb}`
  if (first.codes.includes(WEIGHT_SHAPE_CODE))
    return `체중 변화 미리보기를 ${first.value === '원본' ? '원본으로' : `${first.value} 방향으로`} ${verb}`
  return `${first.label} ${first.value}로 ${verb}`
}

/**
 * 코 검사기가 저장을 거절해(EDIT_032 안전하지 않음·EDIT_031 검사 준비 안 됨) 서버 값으로 다시 읽었을 때 알림 한 줄.
 * 일반 오류 문구 대신 어떤 항목을 원래 값으로 돌렸는지 짚는다. 이미 저장된 다른 항목은 그대로라 `codes`는 거절된 저장의 항목만 넘긴다.
 * - EDIT_032: `콧볼 너비는 지금 코 모양에서 적용할 수 없어 원래 값으로 돌렸어요`
 * - EDIT_031: `코 검사가 아직 준비되지 않아 콧볼 너비를 원래 값으로 돌렸어요`
 * - 여러 항목: 슬라이더 순서 첫 항목 + `외 N개`
 * 코 항목이 없거나 다른 오류면 null(일반 오류 문구를 쓴다).
 */
export function revertedNoseMessage(
  catalog: MorphParameterCatalog | null,
  codes: readonly string[],
  errorCode: string,
  weights: Readonly<Record<string, number>> = {},
): string | null {
  if (errorCode !== ErrorCode.UNSAFE_NOSE_EDIT && errorCode !== ErrorCode.NOSE_EDIT_NOT_READY)
    return null
  if (!codes.some((code) => code.startsWith('nose.'))) return null
  const items = shownItems(catalog, new Set(codes), weights)
  if (!items.length) return null
  const subject = items.length > 1 ? `${items[0].label} 외 ${items.length - 1}개` : items[0].label
  if (errorCode === ErrorCode.NOSE_EDIT_NOT_READY)
    return `코 검사가 아직 준비되지 않아 ${subject}${particle(subject, ['을', '를'])} 원래 값으로 돌렸어요`
  return `${subject}${particle(subject, ['은', '는'])} 지금 코 모양에서 적용할 수 없어 원래 값으로 돌렸어요`
}
