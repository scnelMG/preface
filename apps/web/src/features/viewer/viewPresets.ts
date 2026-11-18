/**
 * 뷰어 시점 프리셋과 카메라 위치 계산. three.js를 쓰지 않는 순수 함수라 서버·테스트에서도 불러올 수 있다.
 *
 * 좌표: glTF 기준 +Y 위, 얼굴은 +Z를 본다. 방위각 0°가 정면이다.
 * Figma(P3-64·P3-61)의 45° 그림은 코가 화면 왼쪽을 향한다. 카메라가 모델의 왼쪽(+X)으로 돈 것이라
 * 방위각을 양수로 둔다(헤드리스 Chrome 스크린샷으로 확인).
 */

export type ViewPreset = 'front' | 'threeQuarter' | 'side'

export interface ViewPresetSpec {
  value: ViewPreset
  label: string
  /** 정면 기준 방위각(도). 양수는 모델 왼쪽(+X) */
  azimuthDeg: number
}

export const VIEW_PRESETS: readonly ViewPresetSpec[] = [
  { value: 'front', label: '정면', azimuthDeg: 0 },
  { value: 'threeQuarter', label: '45°', azimuthDeg: 45 },
  { value: 'side', label: '측면', azimuthDeg: 90 },
]

/** Figma 기본 선택은 45° */
export const DEFAULT_VIEW_PRESET: ViewPreset = 'threeQuarter'

export function isViewPreset(value: string): value is ViewPreset {
  return VIEW_PRESETS.some((preset) => preset.value === value)
}

export function presetAzimuth(preset: ViewPreset): number {
  const spec = VIEW_PRESETS.find((item) => item.value === preset)
  if (!spec) throw new Error(`알 수 없는 시점: ${preset}`)
  return spec.azimuthDeg
}

/**
 * 프리셋 시점의 카메라 위치. 바라보는 점(target)에서 `distance`만큼 떨어진 곳.
 * `elevationDeg`는 수평면 위 각도(조금 위에서 내려다본다).
 */
export function presetCameraPosition(
  preset: ViewPreset,
  distance: number,
  target: readonly [number, number, number] = [0, 0, 0],
  elevationDeg = 0,
): [number, number, number] {
  const azimuth = (presetAzimuth(preset) * Math.PI) / 180
  const elevation = (elevationDeg * Math.PI) / 180
  const horizontal = distance * Math.cos(elevation)
  return [
    round(target[0] + horizontal * Math.sin(azimuth)),
    round(target[1] + distance * Math.sin(elevation)),
    round(target[2] + horizontal * Math.cos(azimuth)),
  ]
}

// 부동소수 오차(-0, 1e-17)를 없애 테스트와 비교를 쉽게 한다
function round(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9
  return rounded === 0 ? 0 : rounded
}
