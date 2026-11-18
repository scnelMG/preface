import {
  changeEyes,
  FOLD_CONTROLS,
  TRIM_CONTROLS,
  type EyeControl,
  type EyeReview,
  type EyeSide,
  type EyeState,
} from '../edit/eyes/state'

/** 놓을 때마다 지금 상태 전체를 검사하는 요청. 워커와 화면이 같은 규칙으로 상태를 만든다. */
export interface ComboCheck {
  id: number
  next: EyeState
  review: EyeReview
  control: EyeControl
  sides: EyeSide[]
  /** 놓기 전 눈별 값 */
  from: Record<EyeSide, number>
}

/** 직전 확정 상태보다 커진 조절 하나를 찾는다. 줄이기·종류 변경만 있으면 검사하지 않는다. */
export function increasedControl(
  previous: EyeState,
  next: EyeState,
): Pick<ComboCheck, 'control' | 'sides' | 'from'> | null {
  for (const control of [...FOLD_CONTROLS, ...TRIM_CONTROLS] as EyeControl[]) {
    const sides = (['L', 'R'] as const).filter(
      (side) => next[side].values[control] > previous[side].values[control],
    )
    if (sides.length)
      return {
        control,
        sides,
        from: { L: previous.L.values[control], R: previous.R.values[control] },
      }
  }
  return null
}

/** 커진 눈마다 놓기 전 값 + delta로 되돌린 상태(높이는 구간 곡선도 같은 비율로 맞춘다). */
export function comboStateAt(check: Omit<ComboCheck, 'id' | 'review'>, delta: number): EyeState {
  return check.sides.reduce(
    (state, side) =>
      changeEyes(state, side, {
        type: 'control',
        control: check.control,
        value: Math.min(check.next[side].values[check.control], check.from[side] + delta),
      }),
    check.next,
  )
}

/** applyEyeState와 같은 단위(좌우가 같으면 한 번, 다르면 눈마다)로 엔진 입력을 만든다. */
export function comboSides(state: EyeState, review: EyeReview) {
  const eligible = { L: review.L === 'absent', R: review.R === 'absent' }
  const values = (side: EyeSide) => ({
    ...state[side].values,
    crease: state[side].enabled ? state[side].values.crease : 0,
    style: state[side].style,
    curves: { L: state.L.curve, R: state.R.curve },
    joinStyles: { L: state.L.style, R: state.R.style },
    eligible,
  })
  return JSON.stringify(state.L) === JSON.stringify(state.R)
    ? [{ selection: 'both', values: values('L') }]
    : (['L', 'R'] as const).map((side) => ({ selection: side, values: values(side) }))
}
