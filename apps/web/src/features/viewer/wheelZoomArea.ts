import { Mesh, Vector3, type Camera, type Object3D } from 'three'

/**
 * 휠 확대를 머리가 보이는 사각형 안에서만 받는다(S15P31B204-770, 메인 체험).
 *
 * 메인 무대의 캔버스는 화면 전체로 번져 그려서(확장 캔버스) 빈 무대 위에서 휠을 굴려도 OrbitControls가 확대하고
 * 페이지가 넘어가지 않았다. 휠이 올 때마다 지금 보이는 모델(머리·헤어)의 정점을 화면에 투영해 경계 사각형을 구하고,
 * 포인터가 그 밖이면 이벤트를 캔버스까지 보내지 않는다. 그러면 OrbitControls가 preventDefault를 부르지 않아 페이지가
 * 그대로 넘어간다. 미리 재 두지 않고 휠마다 재는 이유: 페이지가 넘어가거나 확대·회전하면 머리가 포인터 아래에서 움직인다.
 */

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 메시 하나에서 투영할 점 수의 상한. 헤어 카드(28만 정점)처럼 정점이 많은 메시도 휠마다 가볍게 잰다 */
const MAX_POINTS_PER_MESH = 8000
/** 황금비 소수부. 점을 고르게 흩어 뽑는다 */
const GOLDEN = 0.6180339887498949

/**
 * `root` 아래 보이는 메시의 정점을 `camera`로 투영한 화면 사각형(CSS px, 뷰포트 기준).
 * `canvas`는 캔버스의 화면 위치·크기(getBoundingClientRect). 카메라 앞에 있는 점이 없으면 null.
 */
export function projectedBounds(
  root: Object3D,
  camera: Camera,
  canvas: { left: number; top: number; width: number; height: number },
  maxPointsPerMesh = MAX_POINTS_PER_MESH,
): ScreenRect | null {
  root.updateWorldMatrix(true, true)
  camera.updateMatrixWorld()
  const p = new Vector3()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  root.traverseVisible((object) => {
    if (!(object instanceof Mesh)) return
    const position = object.geometry?.getAttribute('position')
    if (!position?.count) return
    // 많으면 일정 간격이 아니라 황금비 수열로 뽑는다. 헤어 카드는 가닥마다 정점 수가 같아 일정 간격으로 뽑으면
    // 모두 뿌리 점만 걸려(앨리어싱) 머리끝이 사각형에서 빠졌다
    const count = position.count
    const samples = Math.min(count, maxPointsPerMesh)
    for (let k = 0; k < samples; k++) {
      const i = samples === count ? k : Math.floor(((k * GOLDEN) % 1) * count)
      p.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).project(camera)
      // 카메라 뒤나 먼 면 밖의 점은 화면 위치가 뒤집혀 나온다
      if (!(p.z >= -1 && p.z <= 1)) continue
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  })
  if (minX > maxX || minY > maxY) return null
  return {
    left: canvas.left + ((minX + 1) / 2) * canvas.width,
    right: canvas.left + ((maxX + 1) / 2) * canvas.width,
    // NDC는 위가 +1이다
    top: canvas.top + ((1 - maxY) / 2) * canvas.height,
    bottom: canvas.top + ((1 - minY) / 2) * canvas.height,
  }
}

/** 점이 사각형(사방 `padding`px 넓힘) 안인지 */
export function insideRect(rect: ScreenRect | null, x: number, y: number, padding = 0) {
  return (
    !!rect &&
    x >= rect.left - padding &&
    x <= rect.right + padding &&
    y >= rect.top - padding &&
    y <= rect.bottom + padding
  )
}

/**
 * `area`(캔버스를 감싼 요소) 위에서 굴린 휠을 window 캡처 단계에서 먼저 보고, 포인터가 머리 사각형 밖이면 전파를 끊는다.
 * 캔버스의 OrbitControls·React 휠 핸들러(튜토리얼 확대 체크)까지 가지 않고, 막지 않았으니 페이지가 넘어간다.
 * 터치 두 손가락 확대는 휠이 아니라 포인터 이벤트라 그대로다. 돌려준 함수로 리스너를 뗀다.
 */
export function gateWheelToModel(
  area: HTMLElement,
  bounds: () => ScreenRect | null,
  padding = WHEEL_AREA_PADDING,
) {
  const onWheel = (event: WheelEvent) => {
    if (!(event.target instanceof Node) || !area.contains(event.target)) return
    if (insideRect(bounds(), event.clientX, event.clientY, padding)) return
    event.stopPropagation()
  }
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })
  return () => window.removeEventListener('wheel', onWheel, { capture: true })
}

/** 머리 윤곽 바로 바깥에서 굴려도 확대되게 둘레를 조금 넓힌다(px) */
export const WHEEL_AREA_PADDING = 12
