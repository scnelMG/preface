/**
 * 머리 고리 칸 계산(HeadRing·HeadRingScene이 같이 쓴다).
 *
 * 머리 하나에 칸 하나다(-527: 기본 모델 둘을 넷 칸으로 반복해 셋 이상 보이던 것을 없앴다).
 * 셋 이상이면 고리처럼 돈다(끝 다음이 처음). 둘 이하면 돌지 않고 줄처럼 놓는다.
 * 둘을 고리로 돌리면 옆 머리가 왼쪽 끝(-1)과 오른쪽 끝(+1) 사이를 건너뛰어 보이기 때문이다.
 */

/** 고리처럼 끝과 처음이 이어지는가 */
export function ringLoops(count: number) {
  return count > 2
}

export function mod(value: number, n: number) {
  return ((value % n) + n) % n
}

/** 줄로 놓을 때 끝을 넘어 끌 수 있는 여유(칸 단위) */
const OVERSCROLL = 0.35

/** 끄는 중의 위치. 줄로 놓을 때는 양 끝을 조금만 넘게 한다 */
export function clampDrag(pos: number, count: number) {
  if (ringLoops(count)) return pos
  return Math.min(Math.max(pos, -OVERSCROLL), Math.max(0, count - 1) + OVERSCROLL)
}

/** 멈출 칸. 줄로 놓을 때는 처음과 끝 사이로 자른다 */
export function settleSlot(pos: number, count: number) {
  const slot = Math.round(pos)
  if (ringLoops(count)) return slot
  return Math.min(Math.max(slot, 0), Math.max(0, count - 1))
}

/** `index` 머리가 놓인 칸 중 `pos`에서 가장 가까운 칸(고리를 짧은 쪽으로 돈다) */
export function nearestSlot(pos: number, index: number, count: number) {
  if (!ringLoops(count)) return index
  const base = Math.round((pos - index) / count) * count + index
  return [base - count, base, base + count].reduce((best, slot) =>
    Math.abs(slot - pos) < Math.abs(best - pos) ? slot : best,
  )
}

/** 칸이 가운데에서 떨어진 정도(칸 단위, 음수는 왼쪽). 고리는 [-count/2, count/2)로 접는다 */
export function slotOffset(slot: number, pos: number, count: number) {
  if (count <= 1) return 0
  const offset = slot - pos
  if (!ringLoops(count)) return offset
  return ((((offset + count / 2) % count) + count) % count) - count / 2
}

/** 고리 카메라(HeadRingScene). 이어주기 그림을 자르는 계산도 같은 값을 쓴다 */
export const RING_CAMERA_Z = 7.4
export const RING_FOV = 30
/** 머리 하나의 반폭(정규화 단위). 머리는 가장 긴 변(세로)을 3으로 맞추고, 기본 모델 폭은 약 2.2다 */
const HEAD_HALF_WIDTH = 1.1
/** 여백. 고개 돌리기(±0.2rad)는 머리 단면이 둥글어 폭이 거의 그대로라 작게 둔다(휴대폰은 옆 머리가 바로 옆이다) */
const CROP_MARGIN = 1.02

/**
 * 편집하기를 누를 때 떠 갈 가운데 머리 그림의 폭(px). 가운데 머리 폭만큼만 자른다.
 * 전에는 높이의 0.86배로 잘라, 화면이 좁은 휴대폰에서는 폭의 약 93%가 잘려 옆 머리 둘까지 함께 날아갔다(-158).
 * 가운데 머리는 z=0에 있어 화면 폭(world) = 2·tan(fov/2)·z·(폭/높이)로 px를 바꾼다. 좁은 화면 축소(fit)는 HeadRingScene과 같다.
 */
export function handoffCropWidth(width: number, height: number) {
  const worldHeight = 2 * Math.tan(((RING_FOV / 2) * Math.PI) / 180) * RING_CAMERA_Z
  const worldWidth = worldHeight * (width / height)
  const fit = Math.min(1, worldWidth / 5)
  const headWidth = 2 * HEAD_HALF_WIDTH * fit * CROP_MARGIN * (width / worldWidth)
  return Math.min(width, height * 0.86, headWidth)
}
