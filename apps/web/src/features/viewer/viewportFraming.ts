import type { PerspectiveCamera } from 'three'
import type { FaceViewerProps } from './types'

/** 확장한 캔버스에서도 원래 조작 영역의 크기·중심을 유지한다. */
export function applyViewportFrame(
  camera: PerspectiveCamera,
  size: { width: number; height: number },
  frame?: FaceViewerProps['viewportFrame'],
) {
  if (frame && size.width > 0 && size.height > 0) {
    camera.zoom = Math.max(0.01, frame.height / size.height)
    camera.setViewOffset(
      size.width,
      size.height,
      frame.offsetX,
      frame.offsetY,
      size.width,
      size.height,
    )
  } else if (camera.view?.enabled) {
    camera.zoom = 1
    camera.clearViewOffset()
  }
  camera.updateProjectionMatrix()
}

/** 각 모델의 중심만 이동한다. 반쪽 viewport/scissor 경계는 만들지 않는다. */
export function applyComparisonFrame(
  camera: PerspectiveCamera,
  size: { width: number; height: number },
  frame: NonNullable<FaceViewerProps['viewportFrame']>,
  side: 'before' | 'after',
) {
  const separation = (frame.width ?? size.width) / 4
  applyViewportFrame(camera, size, {
    ...frame,
    offsetX: frame.offsetX + (side === 'before' ? separation : -separation),
  })
}
