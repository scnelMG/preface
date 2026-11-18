import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Uint32BufferAttribute } from 'three'
import { expect, it } from 'vitest'
import { profileQuestion, readFaceProfile } from './faceProfile'

it('원본 피부에서 눈·입술·턱·옆모습을 재고 세분화된 정점을 기준점으로 오인하지 않는다', () => {
  const rows = [
    [0, 0, 2.5, 0.3],
    [2, 0, 4, 0.5],
    [4, 0, 5, 1],
    [13, 0, 2, 0.3],
    [14, 0, 1.8, 0.3],
    [18, 0, 1, 0.2],
    [33, -3, 6, 0],
    [61, -2, 2, 0],
    [133, -1, 6, 0],
    [152, 0, -2, 0],
    [168, 0, 7, 0.5],
    [172, -3, 0, 0],
    [199, 0, -1.5, 0.2],
    [234, -5, 5, 0],
    [263, 3, 6, 0],
    [291, 2, 2, 0],
    [362, 1, 6, 0],
    [397, 3, 0, 0],
    [454, 5, 5, 0],
  ]
  const ids = Array.from({ length: 468 }, (_, id) => id)
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...rows.flatMap((r) => r.slice(1)), 10, 10, 10], 3),
  )
  geometry.setAttribute(
    '_detail_index',
    new Uint32BufferAttribute([...rows.map(([id]) => id), 700], 1),
  )
  geometry.setAttribute(
    '_template_index',
    new Uint32BufferAttribute([...rows.map(([id]) => id), 0], 1),
  )
  const skin = new Mesh(geometry)
  skin.name = 'skin'
  const scene = new Group().add(skin)
  const result = readFaceProfile(scene, ids, true)
  expect(result?.overall[0]?.value).toBe('0.80배')
  expect(result?.eyes.map((m) => m.value)).toEqual(['0.33배', '0.33배'])
  expect(result?.lips.map((m) => m.value)).toEqual(['0.40배', '1.60배'])
  expect(result?.lower.map((m) => m.value)).toEqual(['0.25배', '0.60배'])
  expect(result?.side).toHaveLength(2)
  expect(readFaceProfile(scene, ids, false)?.lips).toHaveLength(1)
  expect(readFaceProfile(scene, [], true)).toBeNull()

  const deformed = geometry.clone()
  deformed.deleteAttribute('_detail_index')
  deformed.deleteAttribute('_template_index')
  const chin = rows.findIndex(([id]) => id === 152)
  const eye = rows.findIndex(([id]) => id === 133)
  const displacement = new Float32Array(deformed.getAttribute('position').count * 3)
  displacement[chin * 3 + 1] = 1
  deformed.morphAttributes.position = [new Float32BufferAttribute(displacement, 3)]
  deformed.morphTargetsRelative = true
  const edited = new Mesh(deformed)
  edited.name = 'skin'
  const editedScene = new Group().add(edited)
  const neutral = Float32Array.from(geometry.getAttribute('position').array)
  neutral[eye * 3] += 0.5
  deformed.getAttribute('position').setY(chin, -5)
  edited.morphTargetInfluences![0] = 1
  const measured = () =>
    readFaceProfile(editedScene, ids, true, () => ({ source: geometry, base: neutral }))
  expect(measured()?.overall[0]?.value).toBe('0.70배')
  expect(measured()?.eyes[0]?.value).toBe('0.25배')
  expect(readFaceProfile(scene, ids, true)?.overall[0]?.value).toBe('0.80배')
  edited.morphTargetInfluences![0] = 0
  expect(measured()?.overall[0]?.value).toBe('0.80배')
})

it('분석 후속 질문을 구분하고 직접 편집 및 문헌 질문은 기존 상담으로 넘긴다', () => {
  expect(profileQuestion('제 얼굴 전체적으로 어때요?')).toBe('overall')
  expect(profileQuestion('윗입술 아랫입술 균형은 어때요?')).toBe('lips')
  expect(profileQuestion('제 인중 긴 편인가요?')).toBe('lower')
  expect(profileQuestion('입술은요?', 'overall')).toBe('lips')
  expect(profileQuestion('입술은요?')).toBeNull()
  expect(profileQuestion('콧볼과 눈 안쪽 간격 비율은요?', 'eyes')).toBeNull()
  expect(profileQuestion('옆모습에서 입술이 나온 편인가요?')).toBe('side')
  expect(profileQuestion('얼굴 비율 보고 콧볼을 줄이고 싶어')).toBeNull()
  expect(profileQuestion('클래식 황금비율은 뭐예요?')).toBeNull()
})
