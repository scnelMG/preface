import { buildControls, type ControlDefinition, type PartControl } from './noseControls'
import type { MorphParameterCatalog } from './types'

/**
 * 윤곽 조작 카드(광대·턱끝·볼·턱선). 코 카드와 같은 형식: 묶음 제목 + 짧은 이름 + 양끝 문구.
 * 한 줄 = 한 저장 코드. 묶음 안의 실제 변형(광대 = 앞광대 + 옆광대, 사각턱 = 턱선 + 턱 근육 0.6)은
 * GLB에 굽는 쪽(gpu-worker tools/contour_morphs.py)이 정한다. 2026-11-03 PoC 시험 화면에서 고른 구성.
 */
export type ContourControlId =
  'cheekbone' | 'chinProjection' | 'chinLength' | 'chinWidth' | 'cheekVolume' | 'jawAngle'
// 볼살은 광대 바로 아래 부위라 광대 다음에 둔다(2026-11-04 사용자 결정)
export const CONTOUR_GROUPS = ['광대', '볼', '턱끝', '턱선'] as const

const DEFINITIONS: readonly ControlDefinition<ContourControlId>[] = [
  {
    id: 'cheekbone',
    group: '광대',
    label: '광대',
    accessibleLabel: '광대 크기',
    ends: ['줄이기', '키우기'],
    effects: [{ code: 'contour.cheekbone', gain: 1 }],
  },
  {
    id: 'cheekVolume',
    group: '볼',
    label: '볼살',
    accessibleLabel: '볼살',
    ends: ['줄이기', '채우기'],
    effects: [{ code: 'contour.cheek_volume', gain: 1 }],
  },
  {
    id: 'chinProjection',
    group: '턱끝',
    label: '앞뒤',
    accessibleLabel: '턱끝 앞뒤',
    ends: ['뒤로', '앞으로'],
    effects: [{ code: 'contour.chin_projection', gain: 1 }],
  },
  {
    id: 'chinLength',
    group: '턱끝',
    label: '길이',
    accessibleLabel: '턱끝 길이',
    ends: ['짧게', '길게'],
    effects: [{ code: 'contour.chin_length', gain: 1 }],
  },
  {
    id: 'chinWidth',
    group: '턱끝',
    label: '폭',
    accessibleLabel: '턱끝 폭',
    ends: ['좁게', '넓게'],
    effects: [{ code: 'contour.chin_width', gain: 1 }],
  },
  {
    id: 'jawAngle',
    group: '턱선',
    label: '사각턱',
    accessibleLabel: '사각턱',
    ends: ['좁게', '넓게'],
    effects: [{ code: 'contour.jaw_angle', gain: 1 }],
  },
]

export type ContourControl = PartControl<ContourControlId>

export function contourControls(
  catalog: MorphParameterCatalog,
  weights: Readonly<Record<string, number>>,
  supportedCodes?: readonly string[] | null,
): ContourControl[] {
  return buildControls('CONTOUR', DEFINITIONS, catalog, weights, supportedCodes)
}

/**
 * 카탈로그 윤곽 묶음. 서버 카탈로그(EDIT-01)는 V21부터 같은 코드를 준다(백엔드 migration). 이 정적 묶음은 서버
 * 카탈로그가 윤곽을 주지 않을 때(배포 전 서버, 체험 기본 모델, 개발용 가짜 API)의 대체값이다.
 */
export const SAMPLE_CONTOUR_PART: MorphParameterCatalog['parts'][number] = {
  part: 'CONTOUR',
  label: '윤곽',
  items: DEFINITIONS.map((d) => ({
    code: d.effects[0].code,
    subPart: d.id.toUpperCase(),
    label: d.accessibleLabel,
    min: -1,
    max: 1,
    default: 0,
    step: 0.01,
  })),
}
