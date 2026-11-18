import { Mesh, Vector3, type BufferGeometry, type Object3D } from 'three'
import type { EyeState } from '../eyes/state'

export type Point = readonly [number, number, number]
type Metric = { id?: string; label: string; value: string; method: string; rawRatio?: number }

export const PROFILE_SECTIONS = {
  overall: '전체',
  eyes: '눈·코',
  lips: '입술',
  lower: '인중·턱',
  side: '옆모습',
} as const
export type ProfileSection = keyof typeof PROFILE_SECTIONS
export type FaceProfile = Record<ProfileSection, Metric[]>
export type MeasureProfileTrial = {
  (changes: readonly { code: string; value: number }[]): FaceProfile | null
  eye?: (state: EyeState) => Promise<FaceProfile | null>
}

const IDS = [0, 2, 4, 13, 14, 18, 33, 61, 133, 152, 168, 172, 199, 234, 263, 291, 362, 397, 454]

export function readFaceProfile(
  scene: Object3D,
  landmarkIds: unknown,
  detailed: boolean,
  editedSkin?: (mesh: Mesh) =>
    | {
        source: BufferGeometry
        base?: ArrayLike<number>
        offset?: ArrayLike<number>
      }
    | undefined,
) {
  if (!Array.isArray(landmarkIds) || landmarkIds.length !== 468) return null
  const lookup = new Map<number, number[]>()
  for (const index of IDS) {
    const id: unknown = landmarkIds[index]
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) continue
    lookup.set(id, [...(lookup.get(id) ?? []), index])
  }
  const points = new Map<number, Point>()
  const invalid = new Set<number>()
  const sampled = new Vector3()
  scene.traverse((object) => {
    if (!(object instanceof Mesh) || object.name !== 'skin') return
    const edit = editedSkin?.(object)
    if (editedSkin && !edit) return
    const source = edit?.source ?? object.geometry
    const prefix = detailed ? 'DETAIL' : 'TEMPLATE'
    const ids =
      source.getAttribute(`_${prefix}_INDEX`) ??
      source.getAttribute(`_${prefix.toLowerCase()}_index`)
    const original = source.getAttribute('position')
    const position = object.geometry.getAttribute('position')
    if (
      !ids ||
      ids.itemSize !== 1 ||
      !position ||
      !original ||
      original.itemSize !== 3 ||
      ids.count !== original.count ||
      ids.count > position.count ||
      position.itemSize !== 3
    )
      return
    const baseWeight =
      edit && !object.geometry.morphTargetsRelative && object.geometry.morphAttributes.position
        ? 1 - (object.morphTargetInfluences ?? []).reduce((sum, weight) => sum + weight, 0)
        : 1
    for (let i = 0; i < ids.count; i++) {
      const keys = lookup.get(ids.getX(i))
      if (!keys) continue
      const raw: Point = [position.getX(i), position.getY(i), position.getZ(i)]
      let point = raw
      if (edit) {
        object.getVertexPosition(i, sampled)
        const coordinate = (axis: 0 | 1 | 2) => {
          const index = i * 3 + axis
          const neutral =
            (edit.base?.[index] ?? original.getComponent(i, axis)) + (edit.offset?.[index] ?? 0)
          return sampled.getComponent(axis) + (neutral - raw[axis]) * baseWeight
        }
        point = [coordinate(0), coordinate(1), coordinate(2)]
      }
      for (const key of keys) {
        const prior = points.get(key)
        if (
          keys.length !== 1 ||
          !point.every(Number.isFinite) ||
          prior?.some((v, k) => v !== point[k])
        ) {
          invalid.add(key)
        } else {
          points.set(key, point)
        }
      }
    }
  })
  for (const key of invalid) points.delete(key)
  return measureFaceProfile(points)
}

export function measureFaceProfile(points: ReadonlyMap<number, Point>): FaceProfile | null {
  const data: FaceProfile = { overall: [], eyes: [], lips: [], lower: [], side: [] }
  const axis = (first: number, last: number, coordinate: 0 | 1) => {
    const a = points.get(first)?.[coordinate]
    const b = points.get(last)?.[coordinate]
    return a === undefined || b === undefined ? NaN : a - b
  }
  const ratio = (
    part: keyof FaceProfile,
    id: string,
    label: string,
    a: number,
    b: number,
    method: string,
  ) => {
    const rawRatio = a / b
    if (a > 0 && b > 0 && Number.isFinite(rawRatio)) {
      data[part].push({ id, label, value: `${rawRatio.toFixed(2)}배`, method, rawRatio })
    }
  }
  const span = (a: number, b: number) => Math.abs(axis(a, b, 0))
  const faceWidth = span(234, 454)
  ratio(
    'overall',
    'eye-to-chin-face-width',
    '눈 바깥쪽 높이부터 턱끝까지 / 얼굴 양옆 너비',
    (axis(33, 152, 1) + axis(263, 152, 1)) / 2,
    faceWidth,
    '양쪽 눈 바깥 모서리의 평균 높이부터 턱끝까지 쟀어요. 헤어라인은 포함하지 않아요.',
  )
  ratio(
    'eyes',
    'intercanthal-outer-eye-width',
    '눈 안쪽 간격 / 눈 바깥쪽 너비',
    span(133, 362),
    span(33, 263),
    '정면에서 양쪽 눈 안쪽 모서리 사이를 양쪽 바깥 모서리 사이와 비교했어요.',
  )
  ratio(
    'eyes',
    'nose-length-nose-to-chin',
    '코 길이 / 코 시작점부터 턱끝까지',
    axis(168, 2, 1),
    axis(168, 152, 1),
    '정면에서 코 시작점부터 코밑까지의 세로 길이를, 같은 시작점부터 턱끝까지의 길이와 비교했어요.',
  )
  ratio(
    'lips',
    'mouth-width-face-width',
    '입 너비 / 얼굴 양옆 너비',
    span(61, 291),
    faceWidth,
    '정면에서 양쪽 입꼬리 사이와 얼굴 양옆 기준점 사이를 비교했어요.',
  )
  ratio(
    'lips',
    'lower-upper-vermilion-height',
    '아랫입술 / 윗입술 높이',
    axis(14, 18, 1),
    axis(0, 13, 1),
    '입술 중앙에서 보이는 붉은 부분의 높이를 쟀어요. 입술 사이 틈과 전체 부피는 이 수치에 포함하지 않아요.',
  )
  ratio(
    'lower',
    'philtrum-nose-base-to-chin',
    '인중 길이 / 코밑부터 턱끝까지',
    axis(2, 0, 1),
    axis(2, 152, 1),
    '코밑부터 윗입술 경계까지의 세로 길이를 코밑부터 턱끝까지의 길이와 비교했어요.',
  )
  ratio(
    'lower',
    'jaw-width-face-width',
    '턱 양옆 너비 / 얼굴 양옆 너비',
    span(172, 397),
    faceWidth,
    '정면에서 아래쪽 얼굴 윤곽의 두 기준점과 얼굴 양옆의 두 기준점을 비교했어요. 뼈나 하악각을 잰 값은 아니에요.',
  )
  const nose = points.get(4)
  const chin = points.get(199)
  if (nose && chin && nose[1] > chin[1]) {
    for (const [id, label] of [
      [0, '윗입술'],
      [18, '아랫입술'],
    ] as const) {
      const lip = points.get(id)
      if (!lip || lip[1] <= chin[1] || lip[1] >= nose[1]) continue
      const dy = nose[1] - chin[1]
      const dz = nose[2] - chin[2]
      const value =
        (100 * (dy * (lip[2] - chin[2]) - dz * (lip[1] - chin[1]))) / (dy * dy + dz * dz)
      if (Number.isFinite(value))
        data.side.push({
          id: id === 0 ? 'upper-lip-profile-line' : 'lower-lip-profile-line',
          label: `${label} 기준점 / 코끝–턱끝 기준선`,
          value: `${value > 0 ? '+' : ''}${value.toFixed(1)}%`,
          rawRatio: value / 100,
          method:
            '옆모습에서 코끝과 턱끝 앞쪽을 이은 선까지의 수직 거리를 선 길이로 나눴어요. +는 선 앞쪽, −는 뒤쪽이에요.',
        })
    }
  }
  return Object.values(data).some((metrics) => metrics.length) ? data : null
}

export function profileQuestion(
  text: string,
  currentSection?: ProfileSection | null,
): ProfileSection | null {
  if (
    /줄여|줄이|늘려|늘리|올려|올리|내려|내리|좁혀|좁히|넓혀|넓히|높여|높이(?:고|어)|낮춰|낮추|바꿔|바꾸|맞춰|수정|조절|적용|되돌|초기화|수술|시술|황금|트렌디|다른 사람|사진|이미지|연예인|닮|처럼|\d\s*(?:%|으로|로)/.test(
      text,
    )
  )
    return null
  if (/콧볼/.test(text) && /눈\s*안쪽/.test(text)) return null
  const followUp =
    currentSection &&
    /^(?:제\s*)?(?:옆모습|측면|입술|입매|인중|턱|하안부|눈|코)(?:은|는|도)?요[?!.\s]*$/.test(
      text.trim(),
    )
  if (/옆모습|측면/.test(text) && (followUp || /어때|비율|나온|돌출|분석|설명/.test(text)))
    return 'side'
  if (/입술|입매|입이/.test(text) && (followUp || /어때|비율|편|균형|분석|설명/.test(text)))
    return 'lips'
  if (/인중|턱|하안부/.test(text) && (followUp || /어때|어떻|비율|긴|길이|분석|설명/.test(text)))
    return 'lower'
  if (/눈|코/.test(text) && (followUp || /비율|균형|분석/.test(text))) return 'eyes'
  return /(?:얼굴|안면).*(?:어때|비율|분석|균형)/.test(text) ? 'overall' : null
}
