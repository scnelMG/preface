/// <reference lib="webworker" />
import {
  buildEyeBasis,
  fitEyeSpheres,
  type EyeBasis,
  type LidSkin,
} from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import type { EyeReview, EyeState } from '../edit/eyes/state'
import { deformEyeSkins, type EyeDeformResult, type EyeSkinInput } from './eyeDeform'

/**
 * 눈 변형 계산. 엔진이 값 하나에 수백 ms를 써서 화면 스레드에서 돌리면 슬라이더·회전이 그동안 멈췄다(-526).
 * 화면(useEyeDeform)은 한 번에 하나만 보내고, 끝나면 그동안 쌓인 마지막 값만 다시 보낸다.
 */
export type EyeDeformRequest =
  | {
      type: 'rig'
      landmarks: number[][]
      balls: number[][]
      skins: { base: Float32Array; normals: Float32Array; indices: Uint32Array; lid: LidSkin }[]
    }
  | { type: 'apply'; id: number; state: EyeState; review: EyeReview }
export type EyeDeformResponse =
  | ({ type: 'result'; id: number } & EyeDeformResult)
  | { type: 'error'; id: number; message: string }

let eyes: EyeBasis[] = []
let spheres: object[] = []
let skins: EyeSkinInput[] = []

self.onmessage = (event: MessageEvent<EyeDeformRequest>) => {
  const message = event.data
  if (message.type === 'rig') {
    eyes = buildEyeBasis(message.landmarks)
    spheres = fitEyeSpheres(message.balls, eyes)
    skins = message.skins.map((skin) => ({
      ...skin,
      sideBases: { L: skin.base.slice(), R: skin.base.slice() },
    }))
    return
  }
  try {
    const result = deformEyeSkins(eyes, spheres, skins, message.state, message.review)
    const transfer = result.skins.flatMap((skin) => [
      skin.eye.buffer,
      skin.mask.buffer,
      ...(skin.fold ? [skin.fold.buffer] : []),
    ])
    self.postMessage(
      { type: 'result', id: message.id, ...result } satisfies EyeDeformResponse,
      transfer as Transferable[],
    )
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : '눈 변형 계산 실패',
    } satisfies EyeDeformResponse)
  }
}
