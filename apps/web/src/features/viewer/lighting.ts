import type { ViewerLighting } from './types'

export const DEFAULT_LIGHTING: ViewerLighting = { azimuth: -30, elevation: 35, intensity: 2.3 }

/** 화면 앞쪽 반구에 있는 광원의 방향. 카메라 회전은 렌더러가 적용한다. */
export function lightingPosition(azimuth: number, elevation: number): [number, number, number] {
  const horizontal = (azimuth * Math.PI) / 180
  const vertical = (elevation * Math.PI) / 180
  return [
    5 * Math.sin(horizontal) * Math.cos(vertical),
    5 * Math.sin(vertical),
    5 * Math.cos(horizontal) * Math.cos(vertical),
  ]
}
