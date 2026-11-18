import { describe, expect, it } from 'vitest'
import {
  confirmableChanges,
  countAdjusted,
  describeChange,
  diffWeights,
  FALLBACK_CATALOG,
  isLockedCode,
  labelOf,
  orderByCatalog,
  originalMorphState,
  overlayPending,
  pushHistory,
  sameWeights,
  summarizeEdit,
  viewerWeights,
} from './editLogic'
import { SAMPLE_NOSE_CATALOG } from './noseControls'
import type { MorphParameterCatalog } from './types'

describe('눈 잠금(1차는 코만)', () => {
  it('eye.* 코드만 막는다', () => {
    expect(isLockedCode('eye.tail_angle.right')).toBe(true)
    expect(isLockedCode('eye.size')).toBe(true)
    expect(isLockedCode('nose.bridge_height')).toBe(false)
  })

  it('3D에 넘길 가중치에서 눈 값을 뺀다', () => {
    expect(
      viewerWeights({ 'nose.bridge_height': 0.2, 'eye.open.left': 0.3, 'eye.size': 0.1 }),
    ).toEqual({ 'nose.bridge_height': 0.2 })
  })
})

describe('countAdjusted', () => {
  it('0이 아닌 항목만 센다', () => {
    expect(countAdjusted({})).toBe(0)
    expect(countAdjusted({ 'nose.bridge_height': 0.2, 'nose.tip_height': 0 })).toBe(1)
  })

  it('1차에서 막은 눈 값은 세지 않는다', () => {
    expect(countAdjusted({ 'eye.tail_angle.right': 0.4 })).toBe(0)
    expect(countAdjusted({ 'nose.bridge_height': 0.2, 'eye.open.left': 0.3 })).toBe(1)
  })

  it('결속된 코끝 높이·회전은 한 슬라이더로 세고 옛 개별값은 따로 센다', () => {
    expect(
      countAdjusted({
        'nose.tip_height': 0.24,
        'nose.tip_rotation': 0.16,
        'nose.alar_width': -0.4,
      }),
    ).toBe(2)
    expect(countAdjusted({ 'nose.tip_height': 0.24, 'nose.tip_rotation': -0.16 })).toBe(2)
  })
})

describe('overlayPending', () => {
  it('서버 값을 쓰되 아직 안 보낸 슬라이더 값은 화면 값을 지킨다', () => {
    const merged = overlayPending(
      { 'nose.bridge_height': 0.2 },
      { 'nose.bridge_height': 0.25, 'nose.tip_height': 0.1 },
      ['nose.tip_height'],
    )
    expect(merged).toEqual({ 'nose.bridge_height': 0.2, 'nose.tip_height': 0.1 })
  })

  it('pending이 없으면 서버 값 그대로', () => {
    expect(overlayPending({ a: 1 }, { a: 2 }, [])).toEqual({ a: 1 })
  })
})

describe('labelOf', () => {
  const catalog: MorphParameterCatalog = {
    schemaVersion: 'v2',
    parts: [
      ...FALLBACK_CATALOG.parts,
      {
        part: 'EYE',
        label: '눈',
        items: [
          {
            code: 'eye.tail_angle',
            subPart: 'TAIL',
            label: '눈꼬리 각도',
            min: -1,
            max: 1,
            default: 0,
            step: 0.05,
          },
        ],
      },
    ],
  }

  it('카탈로그 label을 쓴다', () => {
    expect(labelOf(catalog, 'nose.bridge_height')).toBe('콧대 높이')
    expect(labelOf(catalog, 'nose.tip_projection')).toBe('코끝 앞뒤')
  })

  it('눈 좌우 코드는 효과 이름에 좌우를 붙인다', () => {
    expect(labelOf(catalog, 'eye.tail_angle.right')).toBe('눈꼬리 각도(오른쪽)')
  })

  it('모르는 코드는 그대로', () => {
    expect(labelOf(null, 'nose.tip_width')).toBe('nose.tip_width')
  })
})

describe('describeChange', () => {
  it('반영 전후를 %로 보인다', () => {
    expect(describeChange({ from: 0, to: 0.1 })).toBe('0% → +10%')
  })
})

describe('pushHistory', () => {
  it('최대 개수를 넘으면 오래된 것부터 버린다', () => {
    expect(pushHistory([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    expect(pushHistory([], 1)).toEqual([1])
  })
})

describe('sameWeights', () => {
  it('누락 키는 0으로 본다', () => {
    expect(sameWeights({ a: 0 }, {})).toBe(true)
    expect(sameWeights({ a: 0.1 }, {})).toBe(false)
  })
})

describe('슬라이더 순서 정렬', () => {
  const codes = (list: string[]) => orderByCatalog(FALLBACK_CATALOG, list, (code) => code)

  it('서버 키 순서와 상관없이 직접 조절 슬라이더 순서로 둔다', () => {
    expect(codes(['nose.alar_width', 'nose.bridge_height', 'nose.tip_height'])).toEqual([
      'nose.bridge_height',
      'nose.tip_height',
      'nose.alar_width',
    ])
  })

  it('카탈로그에 없는 코드는 맨 뒤에 원래 순서대로, 좌우 코드는 기본 항목 자리에 왼쪽·오른쪽 순', () => {
    const catalog: MorphParameterCatalog = {
      schemaVersion: 'v2',
      parts: [
        { ...FALLBACK_CATALOG.parts[0] },
        {
          part: 'EYE',
          label: '눈',
          items: [{ ...FALLBACK_CATALOG.parts[0].items[0], code: 'eye.open', label: '눈 뜨기' }],
        },
      ],
    }
    expect(
      orderByCatalog(
        catalog,
        ['zz.unknown', 'eye.open.right', 'aa.unknown', 'eye.open.left', 'nose.tip_height'],
        (code) => code,
      ),
    ).toEqual(['nose.tip_height', 'eye.open.left', 'eye.open.right', 'zz.unknown', 'aa.unknown'])
  })

  it('카탈로그가 없으면 원래 순서', () => {
    expect(orderByCatalog(null, ['b', 'a'], (code) => code)).toEqual(['b', 'a'])
  })
})

describe('편집 알림 요약(슬라이더는 한계만, 되돌리기·앞으로 가기는 값)', () => {
  const summarize = (code: string, from: number, to: number) =>
    summarizeEdit(FALLBACK_CATALOG, [{ code, from, to }], 'undo')

  it('슬라이더 조절이 범위 안이면 수치를 알리지 않는다(-852)', () => {
    expect(
      summarizeEdit(FALLBACK_CATALOG, [{ code: 'nose.bridge_height', from: 0, to: 0.16 }]),
    ).toBeNull()
    expect(
      summarizeEdit(FALLBACK_CATALOG, [
        { code: 'nose.alar_width', from: 0, to: 0.1 },
        { code: 'nose.bridge_height', from: 0, to: 0.16, requested: 0.16 },
      ]),
    ).toBeNull()
  })

  it('한 항목은 `{부위} {값}로 되돌렸어요`. 값은 슬라이더 %(승인 범위 끝 = ±100%)', () => {
    // 콧대 높이 범위 -0.5~0.8: 0.16은 +20%
    expect(summarize('nose.bridge_height', 0, 0.16)).toBe('콧대 높이 +20%로 되돌렸어요')
    expect(summarize('nose.alar_width', 0.3, 0.05)).toBe('콧볼 너비 +10%로 되돌렸어요')
    expect(summarize('nose.bridge_height', 0.2, 0)).toBe('콧대 높이 0%로 되돌렸어요')
  })

  it('되돌리기·앞으로 가기는 끝말만 다르다', () => {
    const change = [{ code: 'nose.bridge_height', from: 0.16, to: 0.08 }]
    expect(summarizeEdit(FALLBACK_CATALOG, change, 'undo')).toBe('콧대 높이 +10%로 되돌렸어요')
    expect(summarizeEdit(FALLBACK_CATALOG, change, 'redo')).toBe('콧대 높이 +10%로 다시 바꿨어요')
  })

  it('바뀐 값이 없으면 슬라이더는 알리지 않고, 되돌리기·앞으로 가기는 일반 문구', () => {
    expect(summarizeEdit(FALLBACK_CATALOG, [])).toBeNull()
    expect(summarizeEdit(FALLBACK_CATALOG, [], 'undo')).toBe('이전 상태로 되돌렸어요')
    expect(summarizeEdit(FALLBACK_CATALOG, [], 'redo')).toBe('다음 상태로 다시 바꿨어요')
  })

  it('여러 항목은 슬라이더 순서 첫 항목 값 + 외 N개', () => {
    const changes = [
      { code: 'nose.alar_width', from: 0, to: 0.1 },
      { code: 'nose.bridge_height', from: 0, to: 0.16 },
    ]
    expect(summarizeEdit(FALLBACK_CATALOG, changes, 'redo')).toBe(
      '콧대 높이 +20% 외 1개를 다시 바꿨어요',
    )
    expect(summarizeEdit(FALLBACK_CATALOG, changes, 'undo')).toBe(
      '콧대 높이 +20% 외 1개를 되돌렸어요',
    )
  })

  it('코끝 위아래의 높이·회전 두 저장값은 한 항목, 슬라이더 값으로 말한다', () => {
    const pair = [
      { code: 'nose.tip_height', from: 0, to: -0.3 },
      { code: 'nose.tip_rotation', from: 0, to: -0.2 },
    ]
    expect(summarizeEdit(SAMPLE_NOSE_CATALOG, pair, 'undo')).toBe('코끝 위아래 +50%로 되돌렸어요')
    expect(summarizeEdit(SAMPLE_NOSE_CATALOG, pair, 'redo')).toBe(
      '코끝 위아래 +50%로 다시 바꿨어요',
    )
    // 다른 항목과 함께면 한 항목으로 센다
    expect(
      summarizeEdit(
        SAMPLE_NOSE_CATALOG,
        [...pair, { code: 'nose.bridge_height', from: 0, to: 0.2 }],
        'undo',
      ),
    ).toBe('콧대 높이 +20% 외 1개를 되돌렸어요')
  })

  it('두 값 중 하나만 바뀌어도 바뀐 뒤 전체 가중치로 코끝 위아래 값을 읽는다', () => {
    expect(
      summarizeEdit(
        SAMPLE_NOSE_CATALOG,
        [{ code: 'nose.tip_height', from: -0.299, to: -0.3 }],
        'undo',
        {
          'nose.tip_height': -0.3,
          'nose.tip_rotation': -0.2,
        },
      ),
    ).toBe('코끝 위아래 +50%로 되돌렸어요')
  })

  it('코끝 위아래가 개별 값이 되면 값 없이 말한다', () => {
    expect(
      summarizeEdit(
        SAMPLE_NOSE_CATALOG,
        [
          { code: 'nose.tip_height', from: 0, to: 0.6 },
          { code: 'nose.tip_rotation', from: 0, to: 0.1 },
        ],
        'undo',
      ),
    ).toBe('코끝 위아래를 되돌렸어요')
  })

  it('서버가 이 얼굴의 한계로 줄였으면 그 값까지만 바꿀 수 있다고 알린다', () => {
    expect(
      summarizeEdit(FALLBACK_CATALOG, [
        { code: 'nose.bridge_height', from: 0, to: 0.32, requested: 0.64 },
      ]),
    ).toBe('콧대 높이는 +40%까지만 바꿀 수 있어요')
    expect(
      summarizeEdit(null, [{ code: 'contour.cheek_volume', from: 0, to: 0.12, requested: 0.5 }]),
    ).toBe('contour.cheek_volume은(는) +12%까지만 바꿀 수 있어요')
    // 화면 %가 같으면(반올림 차이) 줄였다고 하지 않는다(알림 없음)
    expect(
      summarizeEdit(FALLBACK_CATALOG, [
        { code: 'nose.bridge_height', from: 0, to: 0.16, requested: 0.1601 },
      ]),
    ).toBeNull()
    // 코끝 위아래는 두 값을 함께 본다
    expect(
      summarizeEdit(SAMPLE_NOSE_CATALOG, [
        { code: 'nose.tip_height', from: 0, to: -0.3, requested: -0.6 },
        { code: 'nose.tip_rotation', from: 0, to: -0.2, requested: -0.4 },
      ]),
    ).toBe('코끝 위아래는 +50%까지만 바꿀 수 있어요')
  })

  it('손을 뗀 순간 확정할 수 있는 변경: 코는 서버 응답 전에는 모르고, 나머지는 화면이 아는 범위로 자른다(-852)', () => {
    const catalog: MorphParameterCatalog = {
      schemaVersion: 'v1',
      parts: [
        {
          part: 'CONTOUR',
          label: '윤곽',
          items: [
            {
              code: 'contour.cheek_volume',
              subPart: 'CHEEK_VOLUME',
              label: '볼살',
              min: -0.5,
              max: 0.12,
              default: 0,
              step: 0.01,
            },
          ],
        },
      ],
    }
    // 코가 섞이면 확정하지 못한다
    expect(
      confirmableChanges(catalog, [
        { code: 'nose.bridge_height', from: 0, to: 0.2 },
        { code: 'contour.cheek_volume', from: 0, to: 0.1 },
      ]),
    ).toBeNull()
    // 범위 안이면 그대로(알리지 않는다)
    const inside = confirmableChanges(catalog, [{ code: 'contour.cheek_volume', from: 0, to: 0.1 }])
    expect(inside).toEqual([{ code: 'contour.cheek_volume', from: 0, to: 0.1 }])
    expect(summarizeEdit(catalog, inside!)).toBeNull()
    // 범위를 넘으면 끝으로 잘라 바로 한계 문구가 된다
    const over = confirmableChanges(catalog, [{ code: 'contour.cheek_volume', from: 0, to: 0.3 }])
    expect(over).toEqual([{ code: 'contour.cheek_volume', from: 0, to: 0.12, requested: 0.3 }])
    expect(summarizeEdit(catalog, over!)).toBe('볼살은 +12%까지만 바꿀 수 있어요')
    // 서버도 같은 범위로 잘라 응답 뒤 문구가 같다. 화면은 같은 문구를 다시 띄우지 않는다(useChangeSummary `shown`)
    expect(
      summarizeEdit(catalog, [{ code: 'contour.cheek_volume', from: 0, to: 0.12, requested: 0.3 }]),
    ).toBe(summarizeEdit(catalog, over!))
    // 이미 끝에서 더 밀면 더 바꿀 수 없다고 알린다
    const atEnd = confirmableChanges(catalog, [
      { code: 'contour.cheek_volume', from: 0.12, to: 0.3 },
    ])
    expect(summarizeEdit(catalog, atEnd!)).toBe('볼살은 이 얼굴에서 더 바꿀 수 없어요')
  })

  it('서버가 하나도 바꾸지 않았으면(받은 값 = 움직이기 전 값) 이 얼굴에서 더 바꿀 수 없다고 알린다', () => {
    const catalog: MorphParameterCatalog = {
      schemaVersion: 'v1',
      parts: [
        {
          part: 'CONTOUR',
          label: '윤곽',
          items: [
            {
              code: 'contour.cheek_volume',
              subPart: 'CHEEK_VOLUME',
              label: '볼살',
              min: -1,
              max: 1,
              default: 0,
              step: 0.01,
            },
          ],
        },
      ],
    }
    // 원본에서 움직였는데 원본(0%) 그대로
    expect(
      summarizeEdit(catalog, [{ code: 'contour.cheek_volume', from: 0, to: 0, requested: -0.3 }]),
    ).toBe('볼살은 이 얼굴에서 더 바꿀 수 없어요')
    // 이미 바꾼 값에서 더 움직였는데 그 값 그대로
    expect(
      summarizeEdit(FALLBACK_CATALOG, [
        { code: 'nose.bridge_height', from: 0.32, to: 0.32, requested: 0.64 },
      ]),
    ).toBe('콧대 높이는 이 얼굴에서 더 바꿀 수 없어요')
  })

  it('슬라이더가 없는 항목은 카탈로그 이름(없으면 코드)과 저장값 %', () => {
    expect(summarizeEdit(null, [{ code: 'nose.x', from: 0, to: 0.3 }], 'undo')).toBe(
      'nose.x +30%로 되돌렸어요',
    )
  })

  it('두 가중치에서 달라진 항목만 뽑는다(누락 = 0)', () => {
    expect(
      diffWeights({ 'nose.tip_height': 0.1, 'nose.alar_width': 0.2 }, { 'nose.tip_height': 0.1 }),
    ).toEqual([{ code: 'nose.alar_width', from: 0.2, to: 0 }])
  })
})

describe('처음으로 원본 상태(BE originalMorphState와 같은 규칙)', () => {
  it('코·윤곽(체중 변화 포함) 가중치와 점·눈 편집을 지우고 나머지 값은 남긴다', () => {
    expect(
      originalMorphState({
        schemaVersion: 'v1',
        weights: {
          'nose.bridge_height': 0.2,
          'contour.cheek_volume': 0.3,
          'contour.weight_shape': -0.5,
          'eye.size': 0.1,
        },
        pointStrokes: [{ vertex: 1, delta: [0, 0.001, 0] }],
        eyeEdit: null,
      }),
    ).toEqual({
      schemaVersion: 'v1',
      weights: { 'eye.size': 0.1 },
      pointStrokes: [],
      eyeEdit: null,
    })
  })
})
