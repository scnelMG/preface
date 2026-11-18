import { create } from 'zustand'
import { EMPTY_MORPH_STATE, type MorphState } from './types'

/**
 * 실험실 편집 상태.
 *
 * 드래그·슬라이더 조작은 **브라우저에서만** 계산·렌더링한다. 움직일 때마다 서버를 부르지 않는다.
 * 서버 저장은 자동 저장 모델이다(API-EDIT-04). 저장 호출은 debounce해서 features/edit의
 * 동기화 계층이 맡고, 이 스토어는 화면이 보는 현재 값만 갖는다.
 *
 * undo·redo는 서버가 이력을 갖는다(50단계, API-EDIT-06·07·08).
 * 그래서 FE는 이력 스택을 쌓지 않고 서버가 내려준 가능 여부 플래그만 들고 있는다.
 *
 * 비로그인 체험(FN-REC-04)은 `simulationId`가 null이다. 이때는 서버에 저장하지 않는다.
 */
interface EditState {
  /** 비로그인 체험이면 null */
  simulationId: string | null
  morphState: MorphState
  /** 낙관적 동시성. 서버와 어긋나면 EDIT_002가 온다 */
  version: number
  canUndo: boolean
  canRedo: boolean
  /** 자동 저장이 아직 안 끝난 변경이 있다 */
  isDirty: boolean

  open: (params: {
    simulationId: string | null
    morphState: MorphState
    version: number
    canUndo: boolean
    canRedo: boolean
  }) => void
  /** 슬라이더 한 개를 움직였다. 렌더링은 즉시, 저장은 동기화 계층이 뒤따른다 */
  setWeight: (code: string, weight: number) => void
  setWeights: (weights: Readonly<Record<string, number>>) => void
  /** 서버 응답(EDIT-04·05·06·07·08)으로 상태를 맞춘다 */
  syncFromServer: (params: {
    morphState: MorphState
    version: number
    canUndo: boolean
    canRedo: boolean
  }) => void
  reset: () => void
}

const initial = {
  simulationId: null,
  morphState: EMPTY_MORPH_STATE,
  version: 0,
  canUndo: false,
  canRedo: false,
  isDirty: false,
}

export const useEditStore = create<EditState>((set) => ({
  ...initial,

  open: ({ simulationId, morphState, version, canUndo, canRedo }) =>
    set({ simulationId, morphState, version, canUndo, canRedo, isDirty: false }),

  setWeight: (code, weight) =>
    set((state) => ({
      morphState: {
        ...state.morphState,
        weights: { ...state.morphState.weights, [code]: weight },
      },
      isDirty: true,
    })),

  setWeights: (weights) =>
    set((state) => ({
      morphState: { ...state.morphState, weights: { ...state.morphState.weights, ...weights } },
      isDirty: true,
    })),

  syncFromServer: ({ morphState, version, canUndo, canRedo }) =>
    set({ morphState, version, canUndo, canRedo, isDirty: false }),

  reset: () => set(initial),
}))
