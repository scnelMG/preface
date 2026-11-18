import { describe, expect, it } from 'vitest'
import {
  applyMorphWeights,
  clampWeight,
  CONTOUR_CODES,
  KNOWN_MORPH_CODES,
  morphTargetCandidates,
  resolveMorphBinding,
  supportedCodes,
  type MorphTargetHolder,
} from './morphTargets'

function holder(names: string[], initial = 0): Required<MorphTargetHolder> {
  return {
    morphTargetDictionary: Object.fromEntries(names.map((name, index) => [name, index])),
    morphTargetInfluences: names.map(() => initial),
  }
}

describe('morphTargetCandidates', () => {
  it('저장 코드 다음에 계약의 PoC 내부 키를 찾는다', () => {
    expect(morphTargetCandidates('nose.bridge_height')).toEqual([
      'nose.bridge_height',
      'dorsum_height',
    ])
    expect(morphTargetCandidates('nose.columella_relative_angle')).toEqual([
      'nose.columella_relative_angle',
      'nasolabial_angle',
    ])
  })

  it('대응표에 없는 코드는 이름 그대로만 찾는다', () => {
    expect(morphTargetCandidates('eye.open.left')).toEqual(['eye.open.left'])
  })

  it('계약의 코 효과 13개와 세부 조절 6개, 윤곽 6개와 얼굴형 변화가 모두 있다', () => {
    const nose = KNOWN_MORPH_CODES.filter((code) => code.startsWith('nose.'))
    expect(nose).toHaveLength(19)
    expect(KNOWN_MORPH_CODES.filter((code) => !code.startsWith('nose.'))).toEqual(CONTOUR_CODES)
    expect(CONTOUR_CODES).toHaveLength(7)
    expect(CONTOUR_CODES.every((code) => code.startsWith('contour.'))).toBe(true)
  })

  it('윤곽 코드는 엔진 키 없이 _neg/_pos 쌍으로 찾는다', () => {
    const dict = { 'contour.jaw_angle_neg': 0, 'contour.jaw_angle_pos': 1 }
    expect(morphTargetCandidates('contour.jaw_angle')).toEqual(['contour.jaw_angle'])
    expect(resolveMorphBinding(dict, 'contour.jaw_angle')).toEqual({
      kind: 'split',
      positive: 1,
      negative: 0,
    })
  })
})

describe('resolveMorphBinding', () => {
  it('저장 코드 이름을 PoC 키보다 먼저 쓴다', () => {
    const dict = { dorsum_height: 0, 'nose.bridge_height': 1 }
    expect(resolveMorphBinding(dict, 'nose.bridge_height')).toEqual({ kind: 'single', index: 1 })
  })

  it('PoC 키만 있어도 찾는다', () => {
    expect(resolveMorphBinding({ alar_width: 3 }, 'nose.alar_width')).toEqual({
      kind: 'single',
      index: 3,
    })
  })

  it('_pos·_neg 쌍이 있으면 부호별 target으로 묶는다', () => {
    const dict = { tip_height_pos: 0, tip_height_neg: 1 }
    expect(resolveMorphBinding(dict, 'nose.tip_height')).toEqual({
      kind: 'split',
      positive: 0,
      negative: 1,
    })
  })

  it('없으면 null', () => {
    expect(resolveMorphBinding({ other: 0 }, 'nose.tip_height')).toBeNull()
  })
})

describe('clampWeight', () => {
  it('계약 범위 [-1, 1]로 자르고 숫자가 아니면 0', () => {
    expect(clampWeight(0.2)).toBe(0.2)
    expect(clampWeight(1.5)).toBe(1)
    expect(clampWeight(-3)).toBe(-1)
    expect(clampWeight(Number.NaN)).toBe(0)
  })
})

describe('applyMorphWeights', () => {
  it('weight를 influence에 그대로 넣는다', () => {
    const mesh = holder(['nose.bridge_height', 'nose.tip_height', 'nose.alar_width'])
    applyMorphWeights([mesh], { 'nose.bridge_height': 0.2, 'nose.alar_width': -0.35 })
    expect(mesh.morphTargetInfluences).toEqual([0.2, 0, -0.35])
  })

  it('weights에서 빠진 키는 codes에 있으면 0으로 되돌린다', () => {
    const mesh = holder(['nose.bridge_height', 'nose.tip_height'], 0.5)
    applyMorphWeights([mesh], { 'nose.tip_height': 0.1 }, ['nose.bridge_height'])
    expect(mesh.morphTargetInfluences).toEqual([0, 0.1])
  })

  it('대응표에 없는 target은 건드리지 않는다', () => {
    const mesh = holder(['blink', 'nose.tip_height'], 0.7)
    applyMorphWeights([mesh], {}, KNOWN_MORPH_CODES)
    expect(mesh.morphTargetInfluences).toEqual([0.7, 0])
  })

  it('부호별 target 쌍에는 |weight|를 한쪽에만 준다', () => {
    const mesh = holder(['tip_height_pos', 'tip_height_neg'])
    applyMorphWeights([mesh], { 'nose.tip_height': -0.4 })
    expect(mesh.morphTargetInfluences).toEqual([0, 0.4])
    applyMorphWeights([mesh], { 'nose.tip_height': 0.3 })
    expect(mesh.morphTargetInfluences).toEqual([0.3, 0])
  })

  it('여러 메시에 같이 적용하고, morph가 없는 메시는 건너뛴다', () => {
    const a = holder(['nose.alar_width'])
    const b = holder(['alar_width'])
    applyMorphWeights([a, {}, b], { 'nose.alar_width': 0.25 })
    expect(a.morphTargetInfluences).toEqual([0.25])
    expect(b.morphTargetInfluences).toEqual([0.25])
  })

  it('어느 메시에도 없는 0이 아닌 효과를 미지원으로 돌려준다', () => {
    const mesh = holder(['nose.bridge_height'])
    const missing = applyMorphWeights([mesh], {
      'nose.bridge_height': 0.1,
      'eye.open.left': 0.3,
      'eye.open.right': 0,
    })
    expect(missing).toEqual(['eye.open.left'])
  })
})

describe('supportedCodes', () => {
  it('메시가 가진 효과만 고른다', () => {
    const mesh = holder(['dorsum_height', 'nose.tip_height'])
    expect(
      supportedCodes([mesh], ['nose.bridge_height', 'nose.tip_height', 'nose.alar_width']),
    ).toEqual(['nose.bridge_height', 'nose.tip_height'])
  })
  it('얼굴형 변화는 양방향 타깃 쌍이 있을 때만 지원한다', () => {
    expect(supportedCodes([holder(['contour.weight_shape'])], CONTOUR_CODES)).not.toContain(
      'contour.weight_shape',
    )
    expect(
      supportedCodes(
        [holder(['contour.weight_shape_neg', 'contour.weight_shape_pos'])],
        CONTOUR_CODES,
      ),
    ).toContain('contour.weight_shape')
  })
})
