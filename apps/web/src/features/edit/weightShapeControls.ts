import { buildControls, type ControlDefinition } from './noseControls'
import type { MorphParameterCatalog } from './types'

export const WEIGHT_SHAPE_CODE = 'contour.weight_shape'

export function editedFaceParts(
  weights: Readonly<Record<string, number>>,
  eyesEdited: boolean,
  pointsEdited = false,
) {
  const active = Object.keys(weights).filter((code) => weights[code] !== 0)
  return [
    eyesEdited && '눈',
    active.some((code) => code.startsWith('nose.')) && '코',
    pointsEdited && '코 제어점',
    active.some((code) => code.startsWith('contour.') && code !== WEIGHT_SHAPE_CODE) && '윤곽',
  ]
    .filter(Boolean)
    .join('·')
}
export const WEIGHT_CONTOUR_REJECTED =
  '체중 변화는 눈·코·윤곽과 따로 조절할 수 있어요. 직접 조절에서 원하는 모드로 전환해 주세요.'

export const SAMPLE_WEIGHT_SHAPE_ITEM = {
  code: WEIGHT_SHAPE_CODE,
  subPart: 'WEIGHT_SHAPE',
  label: '체중 변화 미리보기',
  min: -1,
  max: 1,
  default: 0,
  step: 0.01,
}

const DEFINITION: readonly ControlDefinition[] = [
  {
    id: 'weightShape',
    group: '체중',
    label: '감량·증량',
    accessibleLabel: '체중 변화 감량·증량',
    ends: ['감량', '증량'],
    effects: [{ code: WEIGHT_SHAPE_CODE, gain: 1 }],
  },
]

export const weightShapeControls = (
  catalog: MorphParameterCatalog,
  weights: Readonly<Record<string, number>>,
  supportedCodes?: readonly string[] | null,
) => buildControls('CONTOUR', DEFINITION, catalog, weights, supportedCodes)

export const weightShapeLabel = (value: number) =>
  value < 0 ? '감량' : value > 0 ? '증량' : '원본'

export const weightShapeSliderValue = (value: number) => {
  const strength = Math.round(value * 1000) / 10
  return strength > 0 ? `+${strength}` : String(strength)
}

export const weightShapeStrengthLabel = (value: number) =>
  value === 0
    ? '원본'
    : `${weightShapeLabel(value)} 방향 · 강도 ${Math.round(Math.abs(value) * 1000) / 10}`
