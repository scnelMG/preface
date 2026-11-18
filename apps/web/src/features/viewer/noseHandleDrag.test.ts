import { describe, expect, it } from 'vitest'
import {
  controlsForHandle,
  dragNoseHandle,
  nearestNoseHandle,
  noseHandleDirectionHints,
  noseHandleDragChanges,
} from './noseHandleDrag'
import type { NoseHandleControl } from './types'

const controls: NoseHandleControl[] = [
  { id: 'bridge', value: 0, unavailable: false },
  { id: 'projection', value: 0, unavailable: false },
  { id: 'lower', value: 0, unavailable: false },
  { id: 'alar', value: 0, unavailable: false },
]

describe('코 구조 손잡이', () => {
  it('클릭 영역이 겹치면 DOM 순서와 무관하게 포인터에 가까운 점을 고른다', () => {
    const handles = [
      { id: 'pronasale', x: 283, y: 342 },
      { id: 'alar_crease_subject_right', x: 275, y: 340 },
    ]
    expect(nearestNoseHandle(handles, 277, 339)).toBe('alar_crease_subject_right')
    expect(nearestNoseHandle(handles, 282, 341)).toBe('pronasale')
    expect(nearestNoseHandle([], 277, 339)).toBeNull()
  })

  it('이미 고른 코끝은 겹친 영역에서 드래그해도 콧볼로 바뀌지 않는다', () => {
    const handles = [
      { id: 'pronasale', x: 343, y: 421, width: 16, height: 16 },
      { id: 'alar_crease_subject_right', x: 348, y: 424, width: 16, height: 16 },
    ]
    expect(nearestNoseHandle(handles, 347, 422)).toBe('alar_crease_subject_right')
    expect(dragNoseHandle(handles, 'pronasale', 347, 422)).toBe('pronasale')
    expect(dragNoseHandle(handles, null, 347, 422)).toBe('alar_crease_subject_right')
    expect(dragNoseHandle(handles, 'pronasale', 357, 424)).toBe('alar_crease_subject_right')
  })

  it('측면 코끝의 앞쪽·아래쪽 이동을 두 기존 조절값으로 나눈다', () => {
    expect(noseHandleDragChanges('pronasale', controls, -90, 45, 0, -1)).toEqual([
      { id: 'projection', value: 0.5 },
      { id: 'lower', value: 0.25 },
    ])
    expect(controlsForHandle('alar_crease_subject_left', controls, 0, -1)).toEqual([])
  })

  it('정면 콧볼 두 손잡이는 바깥으로 이동할 때 같은 대칭 너비가 된다', () => {
    expect(noseHandleDragChanges('alar_crease_subject_left', controls, 36, 0, 1, 0)).toEqual([
      { id: 'alar', value: 0.2 },
    ])
    expect(noseHandleDragChanges('alar_crease_subject_right', controls, -36, 0, 1, 0)).toEqual([
      { id: 'alar', value: 0.2 },
    ])
  })

  it('승인되지 않은 조절은 숨기고 표시 범위를 넘지 않는다', () => {
    const unavailable = controls.map((control) =>
      control.id === 'lower' ? { ...control, unavailable: true } : control,
    )
    expect(noseHandleDragChanges('pronasale', unavailable, -1000, 1000, 0, -1)).toEqual([
      { id: 'projection', value: 1 },
    ])
  })

  it('누른 손잡이에서 현재 시점에 실제로 움직일 수 있는 방향만 안내한다', () => {
    expect(noseHandleDirectionHints('nasion', controls, 0, -1)).toEqual([
      { key: 'up', arrow: '↑', label: '높게' },
      { key: 'down', arrow: '↓', label: '낮게' },
    ])
    expect(noseHandleDirectionHints('pronasale', controls, 0, -1)).toEqual([
      { key: 'up', arrow: '↑', label: '올리기' },
      { key: 'right', arrow: '→', label: '뒤로' },
      { key: 'down', arrow: '↓', label: '내리기' },
      { key: 'left', arrow: '←', label: '앞으로' },
    ])
    expect(noseHandleDirectionHints('alar_crease_subject_left', controls, 1, 0)).toEqual([
      { key: 'right', arrow: '→', label: '넓게' },
      { key: 'left', arrow: '←', label: '좁게' },
    ])
    expect(noseHandleDirectionHints('alar_crease_subject_right', controls, 1, 0)).toEqual([
      { key: 'right', arrow: '→', label: '좁게' },
      { key: 'left', arrow: '←', label: '넓게' },
    ])
    expect(
      noseHandleDirectionHints(
        'pronasale',
        controls.map((control) =>
          control.id === 'projection' ? { ...control, value: 1 } : control,
        ),
        0,
        -1,
      ).some((hint) => hint.label === '앞으로'),
    ).toBe(false)
  })

  it('저장된 소수 오차가 다른 축의 이동 방향으로 표시되지 않는다', () => {
    const saved = controls.map((control) =>
      control.id === 'projection' ? { ...control, value: 0.009999999776482582 } : control,
    )
    expect(noseHandleDirectionHints('pronasale', saved, 0, -1)).toEqual([
      { key: 'up', arrow: '↑', label: '올리기' },
      { key: 'right', arrow: '→', label: '뒤로' },
      { key: 'down', arrow: '↓', label: '내리기' },
      { key: 'left', arrow: '←', label: '앞으로' },
    ])
    expect(noseHandleDragChanges('pronasale', saved, 0, -18, 0, -1)[0].value).toBe(saved[1].value)
  })
})
