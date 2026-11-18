/**
 * 거울처럼 보여 주기: 표정·고개·시선을 얼굴의 좌우로 뒤집는다. 반사면은 얼굴의 좌우 축(rig.axes.right)에 수직이다.
 */
import type { ExpressionRig } from './rig'
import type { ExpressionFrame } from './tracker'

export function createMirror(rig: ExpressionRig) {
  const side = rig.axes.right
  const pair = rig.mirror
  const mirrored = pair ? new Float32Array(rig.nbase * 3) : null
  return {
    /** 좌우 짝 정점 표가 있어야 뒤집을 수 있다 */
    available: !!pair,
    /** 좌우를 뒤집은 프레임의 고개·시선 */
    frame(next: ExpressionFrame): ExpressionFrame {
      const [x, y, z, w] = next.head
      // 반사 M으로 감싼 회전 M R M = 축 -M a, 같은 각도
      const d = x * side[0] + y * side[1] + z * side[2]
      const head: [number, number, number, number] = [
        -(x - 2 * d * side[0]),
        -(y - 2 * d * side[1]),
        -(z - 2 * d * side[2]),
        w,
      ]
      const gaze = next.gaze && {
        L: [-next.gaze.R[0], next.gaze.R[1]] as [number, number],
        R: [-next.gaze.L[0], next.gaze.L[1]] as [number, number],
      }
      return { ...next, head, gaze }
    },
    /** 템플릿 변위를 좌우로 뒤집는다: 정점 v의 변위 = 짝 정점 변위의 반사 */
    field(field: Float32Array): Float32Array {
      if (!pair || !mirrored) return field
      for (let v = 0; v < pair.length; v++) {
        const s = 3 * pair[v]
        const d = field[s] * side[0] + field[s + 1] * side[1] + field[s + 2] * side[2]
        mirrored[3 * v] = field[s] - 2 * d * side[0]
        mirrored[3 * v + 1] = field[s + 1] - 2 * d * side[1]
        mirrored[3 * v + 2] = field[s + 2] - 2 * d * side[2]
      }
      return mirrored
    },
  }
}
