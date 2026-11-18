/// <reference lib="webworker" />
import {
  buildEyeBasis,
  findSafeLimit,
  fitEyeSpheres,
  isEyeStateSafe,
  measureEyeSafeLimit,
  type EyeShapeRig,
  type LidSkin,
} from '../../../../../services/gpu-worker/reconstruction/engine/eye-edit.mjs'
import { comboStateAt, comboSides, type ComboCheck } from './eyeCombo'

/**
 * 모델별 안전 한계와 조합 검사. 한 번에 수 초가 걸려 화면 스레드에서 돌리지 않는다.
 * 조합 검사(놓을 때마다)를 한계 계산보다 먼저 처리하고, 하나 끝날 때마다 결과를 보낸다.
 */
export interface EyeLimitJob {
  key: string
  control: string
  style: string
}
export type EyeLimitRequest =
  | {
      type: 'rig'
      landmarks: number[][]
      balls: number[][]
      base: Float32Array
      normals: Float32Array
      indices: Uint32Array
      lid: LidSkin
      eligible: { L: boolean; R: boolean }
    }
  | { type: 'jobs'; jobs: EyeLimitJob[] }
  | ({ type: 'check' } & ComboCheck)
export type EyeLimitResult =
  | { type: 'limit'; key: string; limit: number }
  | { type: 'check'; id: number; delta: number; full: number }

let rig: EyeShapeRig | null = null
let eligible = { L: false, R: false }
let queue: EyeLimitJob[] = []
let check: ComboCheck | null = null
let running = false

function runCheck(job: ComboCheck) {
  // 놓기 전 값(from)에서 놓은 값까지의 증가분 중 조합이 깨지지 않는 최대를 찾는다.
  const full = Math.max(
    ...job.sides.map((side) => job.next[side].values[job.control] - job.from[side]),
  )
  const safe = (delta: number) =>
    isEyeStateSafe(rig!, comboSides(comboStateAt(job, delta), job.review))
  // findSafeLimit은 끝값(놓은 값)부터 확인한다.
  const delta = findSafeLimit(safe, 0, full, Math.max(1, Math.ceil(full / 8)))
  self.postMessage({ type: 'check', id: job.id, delta, full } satisfies EyeLimitResult)
}

function next() {
  if (!rig) {
    running = false
    return
  }
  if (check) {
    const job = check
    check = null
    running = true
    runCheck(job)
  } else {
    const job = queue.shift()
    if (!job) {
      running = false
      return
    }
    running = true
    const limit = measureEyeSafeLimit(rig, job.control, { style: job.style, eligible })
    self.postMessage({ type: 'limit', key: job.key, limit } satisfies EyeLimitResult)
  }
  // 다음 계산 전에 새 요청(조합 검사·종류 변경)을 받을 수 있게 한 번 양보한다.
  setTimeout(next, 0)
}

self.onmessage = (event: MessageEvent<EyeLimitRequest>) => {
  const message = event.data
  if (message.type === 'rig') {
    const basis = buildEyeBasis(message.landmarks)
    rig = {
      base: message.base,
      normals: message.normals,
      indices: message.indices,
      lid: message.lid,
      basis,
      spheres: fitEyeSpheres(message.balls, basis),
    }
    eligible = message.eligible
    queue = []
    return
  }
  if (message.type === 'check') {
    // 더 새 검사가 오면 대기 중인 이전 검사는 버린다(새 상태가 이전 변경을 포함한다).
    check = {
      id: message.id,
      next: message.next,
      review: message.review,
      control: message.control,
      sides: message.sides,
      from: message.from,
    }
  } else {
    // 새 요청을 앞에 두고 이미 대기 중인 같은 열쇠는 뺀다.
    const keys = new Set(message.jobs.map((job) => job.key))
    queue = [...message.jobs, ...queue.filter((job) => !keys.has(job.key))]
  }
  if (!running) next()
}
