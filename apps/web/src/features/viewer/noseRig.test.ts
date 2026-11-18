import { afterEach, describe, expect, it, vi } from 'vitest'
import { Group, Mesh } from 'three'
import {
  applyNoseToSkin,
  highlightedNoseHandles,
  loadNoseRig,
  noseEditPasses,
  nosePointHandles,
  noseHandleWorldPosition,
  type NoseRig,
} from './noseRig'

afterEach(() => vi.unstubAllGlobals())

describe('생성 리그를 최종 GLB 정점에 적용', () => {
  it('상담 카드의 코 효과를 실제 리그 랜드마크 위치에 연결한다', () => {
    const handles = [
      { id: 'nasion' },
      { id: 'pronasale' },
      { id: 'alar_crease_subject_left' },
      { id: 'alar_crease_subject_right' },
    ]
    expect(highlightedNoseHandles(handles, ['nose.bridge_height'])).toEqual([handles[0]])
    expect(highlightedNoseHandles(handles, ['nose.tip_projection', 'nose.tip_height'])).toEqual([
      handles[1],
    ])
    expect(highlightedNoseHandles(handles, ['nose.alar_width'])).toEqual(handles.slice(2))
    expect(highlightedNoseHandles(handles, ['eye.tail_angle.right'])).toEqual([])
  })

  it('코 제어점은 피부 메시의 부모 변환까지 적용한 얼굴 위치에 놓는다', () => {
    const root = new Group()
    root.position.x = 10
    root.scale.setScalar(2)
    const parent = new Group()
    parent.position.y = 3
    const skin = new Mesh()
    skin.position.x = 1
    root.add(parent)
    parent.add(skin)

    expect(
      noseHandleWorldPosition(skin, new Float32Array([0, 0, 0, 2, 0, 0]), 1).toArray(),
    ).toEqual([16, 6, 0])
  })
  it('코 랜드마크와 영향 범위 안에서만 제어점을 선택한다', () => {
    const rig = {
      editable: {
        model: { landmarks: { pronasale: [1, 0, 0] } },
        positions: new Float32Array([0, 0, 0, 1, 0, 0]),
      },
      map: new Int32Array([0, 1]),
      weights: new Float32Array([0, 0.8]),
    } as unknown as NoseRig
    expect(nosePointHandles(rig, [0, 1])).toEqual([
      { id: 'pronasale', label: '코끝', vertex: 1, skinIndex: 1 },
    ])
  })
  it('원본을 바꾸지 않고 템플릿 정점 매핑과 강도를 적용한다', () => {
    const rig = {
      editable: { positions: new Float32Array([0, 0, 0, 1, 0, 0]) },
      map: new Int32Array([0, 1]),
      weights: new Float32Array([1, 0.5]),
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    } as unknown as NoseRig
    const base = new Float32Array([0, 0, 0, 1, 0, 0])
    const target = base.slice()

    applyNoseToSkin(rig, [0, 1], base, [0, 0, 1, 1, 0, 2], target)

    expect([...target]).toEqual([0, 0, 1, 1, 0, 1])
    expect([...base]).toEqual([0, 0, 0, 1, 0, 0])
    expect(() => applyNoseToSkin(rig, [0, 2], base, [0, 0, 1, 1, 0, 2], target)).toThrow()
  })

  it('리그 버전이 맞지 않으면 성공 화면에 쓸 리그를 만들지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          format: 'live-mirror-rig',
          version: 1,
          fit_sha: 'synthetic',
          nose: { engine: 'outdated' },
        }),
      }),
    )
    await expect(loadNoseRig('https://example.invalid/rig.json')).rejects.toThrow('unsupported rig')
  })
})

// 서버 검사기 checkNoseEdit(glb-nose.mjs)의 valid와 같은 조건. 화면이 더 느슨하면 서버가 거절해 값이 되돌아간다(-852)
describe('코 미리보기 판정은 서버 검사기와 같다', () => {
  const passing = { valid: true, protectedRegionsPresent: true, affectedVertices: 12 }
  const alar = { 'nose.alar_width': 0.4, 'nose.tip_projection': -0.85 }

  it('canonical·피부·보호 부위 검사를 모두 통과하고 바뀐 정점이 있으면 통과한다', () => {
    expect(noseEditPasses(true, passing, alar)).toBe(true)
  })

  it('canonical 메시 검사에 실패하면 피부 검사가 통과해도 거절한다', () => {
    expect(noseEditPasses(false, passing, alar)).toBe(false)
    expect(noseEditPasses(false, null, alar)).toBe(false)
  })

  it('보호 부위(눈·입술) 정보가 없으면 거절한다', () => {
    expect(noseEditPasses(true, { ...passing, protectedRegionsPresent: false }, alar)).toBe(false)
    expect(noseEditPasses(true, { ...passing, protectedRegionsPresent: false }, {})).toBe(false)
  })

  it('최종 피부 검사에 실패하면 거절한다', () => {
    expect(noseEditPasses(true, { ...passing, valid: false }, alar)).toBe(false)
  })

  it('코 값이나 점 편집을 요청했는데 바뀐 정점이 없으면 거절하고, 아무것도 요청하지 않았으면 통과한다', () => {
    const still = { ...passing, affectedVertices: 0 }
    expect(noseEditPasses(true, still, alar)).toBe(false)
    expect(noseEditPasses(true, still, { 'nose.alar_width': 0 })).toBe(true)
    expect(noseEditPasses(true, still, { 'contour.cheek_volume': 0.3 })).toBe(true)
    expect(noseEditPasses(true, still, {}, [{ vertex: 1, delta: [0, 0, 0.001] }])).toBe(false)
  })
})
