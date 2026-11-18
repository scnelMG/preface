/**
 * 눈 감김. 얼굴 점 풀이를 마친 가중치에 모델 눈이 목표만큼 감기도록 눈 감기 형상을 모자란 만큼 더한다(tracker.ts).
 * 풀이 안에서 눈 감김을 얼굴 점 움직임으로 섞으면 다른 성분이 한계에 닿을 때 눈 감김도 같은 비율로 줄었다.
 */
import { landmarkMotion, lidClosure, SIDES, type ExpressionRig, type Side } from './rig'

/** 눈 감기 형상이 rig의 손 정의 눈 감김(얼굴 점 움직임)에 못 미치면 이 배율까지 키운다(rig 도구의 named_gain 상한과 같다) */
const MAX_GAIN = 2
/** 이보다 작은 눈 감김은 떨림으로 보고 버린다(무표정을 뺀 점수, 0~1) */
const BLINK_FLOOR = 0.05
/**
 * 눈 감김이 이만큼이면 다 감긴 것으로 보여 준다. 마지막 몇 할은 속눈썹·눈꺼풀 두께에 가려 점수도 얼굴 점도 끝까지
 * 오르지 않는다: 녹화(11/14)의 윙크한 눈 점수는 무표정을 빼고 편 뒤에도 중앙값 0.59에서 멈췄다
 */
const EYE_SHUT = 0.8

export interface BlinkShape {
  /** 다 감을 때의 GNM 가중치 */
  weights: Float32Array
  /** 이 형상이 그 눈의 눈 틈을 닫는 비율(1 = 다 감김) */
  closes: number
}

/**
 * 눈마다 눈 감기 형상. 직접 정의한 것(`expr.native`)이 있으면 그것을, 없으면 손 정의 눈 감김(얼굴 점 움직임)을 풀어 얻은
 * 가중치를 그 움직임이 다 나오도록 최대 MAX_GAIN배 키워 쓴다
 */
export function buildBlinkShapes(rig: ExpressionRig): Partial<Record<Side, BlinkShape>> {
  const { P } = rig.components
  const K = rig.components.names.length
  const n = rig.lid.length * 3
  const vertex = new Float32Array(rig.nbase * 3)
  const motion = new Float32Array(n)
  const shownBy = (weights: Float32Array) => landmarkMotion(rig, weights, vertex, motion)
  const shapes: Partial<Record<Side, BlinkShape>> = {}
  for (const side of SIDES) {
    const name = `eyeBlink${side}`
    const target = rig.named[name]
    let weights = rig.native[name]
    if (!weights) {
      if (!target) continue
      weights = new Float32Array(K)
      for (let k = 0; k < K; k++) {
        let w = 0
        for (let j = 0; j < n; j++) w += P[k * n + j] * target[j]
        weights[k] = w
      }
      const shown = shownBy(weights)
      let along = 0
      let size = 0
      for (let j = 0; j < n; j++) {
        along += shown[j] * target[j]
        size += target[j] * target[j]
      }
      if (along <= 0 || size <= 0) continue
      const gain = Math.min(MAX_GAIN, Math.max(1, size / along))
      for (let k = 0; k < weights.length; k++) weights[k] *= gain
    }
    shapes[side] = { weights, closes: lidClosure(rig, shownBy(weights), side) }
  }
  return shapes
}

/** 눈 감김(무표정을 뺀 점수나 얼굴 점에서 잰 값, 0~1) → 보여 줄 감김. 아주 작은 값은 버리고 EYE_SHUT에서 다 감긴다 */
export function blinkAmount(closed: number): number {
  return Math.min(1, Math.max(0, (closed - BLINK_FLOOR) / (EYE_SHUT - BLINK_FLOOR)))
}
