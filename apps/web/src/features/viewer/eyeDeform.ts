import {
  composeEyeDeformation,
  type EyeBasis,
  type LidSkin,
} from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import { screenEyeLabel, type EyeReview, type EyeSide, type EyeState } from '../edit/eyes/state'

/** 쌍꺼풀 말고 눈 리그가 피부를 옮기는 조절(눈 뜨임·눈꼬리 높이는 여기서 0으로 둔다) */
const OTHER_CONTROLS = ['inner', 'outer', 'lower', 'upper'] as const

/** 눈 변형 계산에 쓰는 피부 입력(화면 스레드·워커 공통). */
export interface EyeSkinInput {
  base: Float32Array
  normals: Float32Array
  indices: Uint32Array
  lid: LidSkin
  /** 좌우를 따로 계산할 때 쓰는 원본 복사본. 엔진 캐시가 원본 배열을 열쇠로 써서 눈마다 따로 둔다 */
  sideBases: { L: Float32Array; R: Float32Array }
}
export interface EyeDeformResult {
  skins: {
    eye: Float32Array
    mask: Uint8Array
    /** 눈 변형 가운데 쌍꺼풀 접힘이 만든 변위만(없으면 null). 표정이 눈을 감길 때 접힘을 펴는 데 쓴다 */
    fold: Float32Array | null
  }[]
  changed: number
  reductions: string[]
}

/**
 * 눈 상태 하나의 변형을 계산한다(메시는 건드리지 않는다). 엔진의 안전 반복 때문에 값 하나에 수백 ms가 걸려
 * 화면에서는 워커(eyeDeform.worker.ts)에서 돌린다.
 */
export function deformEyeSkins(
  eyes: EyeBasis[],
  spheres: object[],
  skins: EyeSkinInput[],
  state: EyeState,
  review: EyeReview,
): EyeDeformResult {
  let changed = 0
  const reductions: string[] = []
  const results = skins.map((skin) => {
    const target = skin.base.slice()
    // 쌍꺼풀 없이 계산한 변위. 쌍꺼풀이 있을 때만 만든다
    let plain: Float32Array | null = null
    const same = JSON.stringify(state.L) === JSON.stringify(state.R)
    for (const side of (same ? ['both'] : ['L', 'R']) as ('L' | 'R' | 'both')[]) {
      const eye = state[side === 'both' ? 'L' : side]
      const crease = eye.enabled ? eye.values.crease : 0
      const compose = (depth: number) =>
        composeEyeDeformation(
          side === 'both' ? skin.base : skin.sideBases[side],
          eyes,
          {
            ...eye.values,
            opening: 0,
            tail: 0,
            crease: depth,
            curves: { L: state.L.curve, R: state.R.curve },
            joinStyles: { L: state.L.style, R: state.R.style },
            eligible: { L: review.L === 'absent', R: review.R === 'absent' },
          },
          side,
          eye.style,
          skin.normals,
          skin.indices,
          spheres,
          skin.lid,
        )
      const result = compose(crease)
      for (let i = 0; i < target.length; i++) target[i] += result.positions[i] - skin.base[i]
      if (crease > 0) {
        // 접힘만의 변위 = 전체 - 쌍꺼풀 없이 계산한 결과. 다른 조절이 없으면 다시 계산하지 않는다(전체가 곧 접힘)
        plain ??= new Float32Array(target.length)
        if (OTHER_CONTROLS.some((key) => eye.values[key] !== 0)) {
          const without = compose(0).positions
          for (let i = 0; i < plain.length; i++) plain[i] += without[i] - skin.base[i]
        }
      } else if (plain)
        for (let i = 0; i < plain.length; i++) plain[i] += result.positions[i] - skin.base[i]
      for (const reduction of result.reductions ?? [])
        reductions.push(
          `${screenEyeLabel(reduction.side as EyeSide)} ${reduction.control} ${Math.round(reduction.retention * 100)}%`,
        )
    }
    const mask = new Uint8Array(skin.base.length / 3)
    for (let i = 0; i < target.length; i += 3)
      if (
        Math.hypot(
          target[i] - skin.base[i],
          target[i + 1] - skin.base[i + 1],
          target[i + 2] - skin.base[i + 2],
        ) >
        eyes[0].width * 1e-7
      ) {
        changed++
        mask[i / 3] = 1
      }
    // plain은 여기까지 "쌍꺼풀 없는 변위"다 → 접힘만의 변위로 바꾼다
    if (plain) for (let i = 0; i < plain.length; i++) plain[i] = target[i] - skin.base[i] - plain[i]
    return { eye: target, mask, fold: plain }
  })
  return { skins: results, changed, reductions }
}
