import { it, expect } from 'vitest'
import { changeEyes, newEyeState } from '../edit/eyes/state'
import { comboSides, comboStateAt, increasedControl } from './eyeCombo'

it('직전 확정보다 커진 조절 하나만 찾아 그 증가분만큼만 되돌린다', () => {
  const previous = changeEyes(newEyeState(), 'both', { type: 'style', style: 'inline' })
  const next = changeEyes(previous, 'both', { type: 'control', control: 'upper', value: 30 })
  const change = increasedControl(previous, next)!
  expect(change).toEqual({ control: 'upper', sides: ['L', 'R'], from: { L: 0, R: 0 } })
  const lowered = comboStateAt({ next, ...change }, 12)
  expect(lowered.L.values.upper).toBe(12)
  expect(lowered.L.style).toBe('inline')
  expect(increasedControl(next, previous)).toBeNull()
})
it('높이를 낮추면 구간 곡선도 같은 비율로 따라오고 좌우가 다르면 눈마다 검사한다', () => {
  const previous = changeEyes(newEyeState(), 'both', { type: 'style', style: 'inout' })
  const next = changeEyes(previous, 'L', { type: 'control', control: 'height', value: 60 })
  const change = increasedControl(previous, next)!
  expect(change.sides).toEqual(['L'])
  const lowered = comboStateAt({ next, ...change }, 0)
  expect(lowered.L.curve).toEqual(previous.L.curve.map((v) => expect.closeTo(v, 6)))
  const review = { L: 'absent', R: 'absent' } as const
  expect(comboSides(previous, review)).toHaveLength(1)
  expect(comboSides(next, review).map((side) => side.selection)).toEqual(['L', 'R'])
})
