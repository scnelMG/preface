import { describe, expect, it } from 'vitest'
import { newEyeState } from '../eyes/state'
import { SAMPLE_NOSE_CATALOG } from '../noseControls'
import { SAMPLE_CONTOUR_PART } from '../contourControls'
import { SAMPLE_WEIGHT_SHAPE_ITEM } from '../weightShapeControls'
import { applySampleConsult } from './applySampleConsult'

const catalog = {
  ...SAMPLE_NOSE_CATALOG,
  parts: [
    ...SAMPLE_NOSE_CATALOG.parts,
    { ...SAMPLE_CONTOUR_PART, items: [...SAMPLE_CONTOUR_PART.items, SAMPLE_WEIGHT_SHAPE_ITEM] },
  ],
}
const review = { L: 'absent', R: 'absent' } as const
const limits = { inner: 20, 'inline:height': 100, 'inout:height': 100, 'outline:height': 100 }
const action = (code: string, direction: 1 | -1 = 1) => ({
  code,
  side: 'both' as const,
  direction,
  strength: 'small' as const,
})

describe('기본 모델 채팅 3D 적용', () => {
  it('윤곽과 체중 방향은 실제 GLB 타깃과 카탈로그 안에서 반영한다', () => {
    const contour = applySampleConsult(
      [action('contour.cheekbone')],
      { weights: {}, eyes: newEyeState() },
      ['contour.cheekbone', 'contour.weight_shape'],
      catalog,
      review,
      limits,
      true,
    )
    expect(contour?.state.weights['contour.cheekbone']).toBe(0.1)
    const weight = applySampleConsult(
      [action('contour.weight_shape', -1)],
      { weights: {}, eyes: newEyeState() },
      ['contour.weight_shape'],
      catalog,
      review,
      limits,
      true,
    )
    expect(weight?.state.weights['contour.weight_shape']).toBe(-0.1)
  })

  it('코끝 위아래는 현재 슬라이더의 두 저장 코드로 함께 움직인다', () => {
    const result = applySampleConsult(
      [action('nose.tip_height')],
      { weights: {}, eyes: newEyeState() },
      ['nose.tip_height', 'nose.tip_rotation'],
      catalog,
      review,
      limits,
      true,
    )
    expect(result?.state.weights).toMatchObject({
      'nose.tip_height': 0.06,
      'nose.tip_rotation': 0.04,
    })
    expect(result?.applied).toHaveLength(2)
  })

  it('체중 변화가 켜져 있으면 상담으로 눈을 적용하거나 체중값을 지우지 않는다', () => {
    const result = applySampleConsult(
      [action('eye.inner')],
      { weights: { 'contour.weight_shape': -0.2 }, eyes: newEyeState() },
      ['contour.weight_shape'],
      catalog,
      review,
      limits,
      true,
    )
    expect(result).toBeNull()
  })

  it('다른 편집 위에 체중을 섞거나 GLB에 없는 윤곽을 적용하지 않는다', () => {
    expect(
      applySampleConsult(
        [action('contour.weight_shape', -1)],
        { weights: { 'nose.bridge_height': 0.1 }, eyes: newEyeState() },
        ['contour.weight_shape'],
        catalog,
        review,
        limits,
        true,
      ),
    ).toBeNull()
    expect(
      applySampleConsult(
        [action('contour.cheekbone')],
        { weights: {}, eyes: newEyeState() },
        [],
        catalog,
        review,
        limits,
        true,
      ),
    ).toBeNull()
  })
})
