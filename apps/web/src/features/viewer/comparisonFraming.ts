/** 카메라 좌표로 투영한 경계 상자의 모든 꼭짓점을 여백과 함께 담는 최소 거리. */
export function comparisonFitDistance(
  corners: readonly (readonly [number, number, number])[],
  aspect: number,
  verticalFov: number,
): number {
  const verticalTangent = Math.tan((verticalFov * Math.PI) / 360)
  const horizontalTangent = verticalTangent * aspect
  return Math.max(
    ...corners.map(
      ([x, y, z]) =>
        z + Math.max(Math.abs(x) / horizontalTangent, Math.abs(y) / verticalTangent) * 1.08,
    ),
  )
}

/** 현재 시점의 수평 경계를 슬롯 안에 두는 최소 거리. 회전 시 다시 계산한다. */
export function comparisonSeparationDistance(
  corners: readonly (readonly [number, number, number])[],
  aspect: number,
  verticalFov: number,
): number {
  const horizontalTangent = Math.tan((verticalFov * Math.PI) / 360) * aspect
  return Math.max(...corners.map(([x, , z]) => z + (Math.abs(x) / horizontalTangent) * 1.08))
}
