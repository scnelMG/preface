import type { MorphParameter, MorphParameterCatalog } from './types'

/** UI의 내림만 양수=아래다. 저장 코드의 양수=위 방향은 유지한다. */
export const TIP_HEIGHT_CODE = 'nose.tip_height'
export const TIP_ROTATION_CODE = 'nose.tip_rotation'
export type NoseControlId = 'bridge' | 'projection' | 'lower' | 'alar'
export interface MorphValueChange {
  code: string
  value: number
}
interface Effect {
  code: string
  gain: number
}
/** 조작 카드 한 줄의 정의. 코·윤곽이 같은 모양을 쓴다(한 값이 여러 저장 코드를 gain 비율로 움직일 수 있다) */
export interface ControlDefinition<Id extends string = string> {
  id: Id
  group: string
  label: string
  accessibleLabel: string
  ends: readonly [string, string]
  effects: readonly Effect[]
}
const DEFINITIONS = [
  {
    id: 'bridge',
    group: '콧대',
    label: '콧대',
    accessibleLabel: '콧대 높이',
    ends: ['낮게', '높게'],
    effects: [{ code: 'nose.bridge_height', gain: 1 }],
  },
  {
    id: 'projection',
    group: '코끝',
    label: '앞뒤',
    accessibleLabel: '코끝 앞뒤',
    ends: ['뒤로', '앞으로'],
    effects: [{ code: 'nose.tip_projection', gain: 1 }],
  },
  {
    id: 'lower',
    group: '코끝',
    label: '위아래',
    accessibleLabel: '코끝 위아래',
    ends: ['올리기', '내리기'],
    effects: [
      { code: TIP_HEIGHT_CODE, gain: -0.6 },
      { code: TIP_ROTATION_CODE, gain: -0.4 },
    ],
  },
  {
    id: 'alar',
    group: '콧볼',
    label: '콧볼',
    accessibleLabel: '콧볼 너비',
    ends: ['좁게', '넓게'],
    effects: [{ code: 'nose.alar_width', gain: 1 }],
  },
] as const

export interface PartControl<Id extends string = string> extends ControlDefinition<Id> {
  parameters: MorphParameter[]
  min: number
  max: number
  rawMin: number
  rawMax: number
  step: number
  value: number
  mixed: boolean
  unavailable: boolean
  /** 모델 지원 코드를 아직 읽는 중(supportedCodes === null). 이때는 잠겨도 "조절할 수 없어요"를 보이지 않는다 */
  loading: boolean
}
export type NoseControl = PartControl<NoseControlId>

/** 화면의 ±100%는 원본 대비 모델별 승인 범위의 끝값이다. 저장값은 그대로 둔다. */
export function displayWeight(value: number, bounds?: { min: number; max: number }): number {
  if (!bounds || value === 0) return value
  const extent = value < 0 ? -bounds.min : bounds.max
  return extent > 0 ? value / extent : value
}

export function noseControlId(code: string): NoseControlId | undefined {
  return DEFINITIONS.find((d) => d.effects.some((e) => e.code === code))?.id
}

export function isTipLowerPair(changes: readonly { code: string }[]): boolean {
  return (
    changes.length === 2 &&
    changes.some((change) => change.code === TIP_HEIGHT_CODE) &&
    changes.some((change) => change.code === TIP_ROTATION_CODE)
  )
}

/** 카탈로그와 모델이 모두 지원하는 조절만 연다. 기존 개별값은 읽기만 한다. */
export function noseControls(
  catalog: MorphParameterCatalog,
  weights: Readonly<Record<string, number>>,
  supportedCodes?: readonly string[] | null,
): NoseControl[] {
  return buildControls('NOSE', DEFINITIONS, catalog, weights, supportedCodes)
}

/** 부위 하나의 조작 카드. 카탈로그(`part`)와 모델 지원 코드로 줄마다 범위·잠김을 정한다. */
export function buildControls<Id extends string>(
  part: string,
  definitions: readonly ControlDefinition<Id>[],
  catalog: MorphParameterCatalog,
  weights: Readonly<Record<string, number>>,
  supportedCodes?: readonly string[] | null,
): PartControl<Id>[] {
  const items = catalog.parts.find((p) => p.part === part)?.items ?? []
  return definitions.map((definition) => {
    const parameters = definition.effects.flatMap((e) => items.filter((p) => p.code === e.code))
    let unavailable =
      parameters.length !== definition.effects.length ||
      supportedCodes === null ||
      (supportedCodes !== undefined &&
        definition.effects.some((e) => !supportedCodes.includes(e.code)))
    let min = definition.id === 'lower' ? -1 : -Infinity
    let max = definition.id === 'lower' ? 1 : Infinity
    for (const effect of definition.effects) {
      const parameter = parameters.find((p) => p.code === effect.code)
      if (!parameter) continue
      const limits = [parameter.min / effect.gain, parameter.max / effect.gain].sort(
        (a, b) => a - b,
      )
      min = Math.max(min, limits[0])
      max = Math.min(max, limits[1])
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > 0 || max < 0 || min === max) {
      min = -1
      max = 1
      unavailable = true
    }
    const first = definition.effects[0]
    const candidate = (weights[first.code] ?? 0) / first.gain
    // 서버 소수 셋째 자리 반올림 오차만 허용한다. 평균값으로 두 상태를 덮지 않는다.
    const mixed =
      definition.id === 'lower' &&
      (candidate < min - 0.001 ||
        candidate > max + 0.001 ||
        definition.effects.some(
          (e) => Math.abs((weights[e.code] ?? 0) - e.gain * candidate) > 0.001,
        ))
    return {
      ...definition,
      parameters,
      min: min < 0 ? -1 : 0,
      max: max > 0 ? 1 : 0,
      rawMin: min,
      rawMax: max,
      step: 0.01,
      value: mixed ? 0 : displayWeight(candidate, { min, max }),
      mixed,
      unavailable,
      loading: supportedCodes === null,
    }
  })
}

export function noseControlChanges(control: PartControl, value: number): MorphValueChange[] {
  if (control.unavailable || !Number.isFinite(value)) return []
  const display = Math.max(control.min, Math.min(control.max, value))
  const bounded = display < 0 ? display * -control.rawMin : display * control.rawMax
  return control.effects.map((e) => ({
    code: e.code,
    value: Number((bounded * e.gain).toFixed(3)),
  }))
}

/** 공개 GLB의 4개 조절에 필요한 5개 항목. 실제 렌더 지원도 별도로 확인한다. */
export const SAMPLE_NOSE_CATALOG: MorphParameterCatalog = {
  schemaVersion: 'v2',
  parts: [
    {
      part: 'NOSE',
      label: '코',
      items: [
        ['nose.bridge_height', 'BRIDGE', '콧대 높이'],
        ['nose.tip_projection', 'TIP_PROJECTION', '코끝 돌출'],
        [TIP_HEIGHT_CODE, 'TIP', '코끝 높이'],
        [TIP_ROTATION_CODE, 'TIP_ROTATION', '코끝 회전'],
        ['nose.alar_width', 'ALAR', '콧볼 너비'],
      ].map(([code, subPart, label]) => ({
        code,
        subPart,
        label,
        min: -1,
        max: 1,
        default: 0,
        step: 0.01,
      })),
    },
  ],
}

/**
 * 묶음 제목 아래 슬라이더 줄 이름. 제목이 부위를 말하므로 줄에는 속성만 쓴다(2026-11-01 조작 카드 재구성).
 * 여러 줄인 묶음(코끝)은 항목 이름(앞뒤·위아래), 한 줄 묶음은 접근 이름에서 묶음 이름을 뺀 것(콧대 높이 → 높이).
 */
export function noseRowLabel(
  rows: readonly Pick<PartControl, 'group' | 'label' | 'accessibleLabel'>[],
  index: number,
): string {
  const row = rows[index]
  const shared = rows.filter((other) => other.group === row.group).length > 1
  return shared ? row.label : row.accessibleLabel.replace(`${row.group} `, '')
}
