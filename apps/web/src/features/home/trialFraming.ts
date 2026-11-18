import type { FaceViewerProps } from '@/features/viewer/types'

type ViewportFrame = NonNullable<FaceViewerProps['viewportFrame']>

/** 전체 화면 체험이 휴대폰 폭으로 보이는 조건(MainStudio의 max-md와 같다) */
export const TRIAL_PHONE_QUERY = '(max-width: 767px)'
/** 메인이 데스크톱 배치(왼쪽 글 · 가운데 3D · 오른쪽 조절 카드)로 보이는 조건(MainStudio의 lg와 같다) */
export const TRIAL_DESKTOP_QUERY = '(min-width: 1024px)'

/**
 * 데스크톱 무대·조절 카드를 키운 배율(S15P31B204-840). 무대 높이는 `min(62svh, 580px)`에서
 * `min(77.5svh, 725px)`(MainStudio `lg:h-…`·`lg:max-h-…`)로 1.25배다. 1440×900·1920×1080에서 가장 긴 조절(윤곽)이
 * 카드 안에서 넘기지 않고 다 보이는 높이다. 낮은 화면은 `100svh - 196px`(머리줄·꼬리말·여백)까지만 키워 스크롤이 생기지 않게 한다(-867).
 */
export const MAIN_DESKTOP_SCALE = 1.25
/** 확장 캔버스가 얼굴을 그리는 높이의 기본 상한(useViewerFrame과 같다) */
const VIEWER_FRAME_MAX = 500

/**
 * 메인 데스크톱의 얼굴 크기(S15P31B204-840). `frame.height`가 그리는 배율이라, 예전 상한(500px)도 무대와 같은 배율로
 * 키워야 얼굴 : 조절 카드 높이 비율이 그대로 남는다. 무대가 상한보다 낮으면 예전처럼 무대 높이를 따른다.
 */
export function mainDesktopFrame(
  frame: ViewportFrame,
  area: { width: number; height: number },
): ViewportFrame {
  const height = Math.round(Math.min(area.height, VIEWER_FRAME_MAX * MAIN_DESKTOP_SCALE))
  return height > 0 ? { ...frame, height } : frame
}

/**
 * 휴대폰 전체 화면 체험의 얼굴 크기(S15P31B204-526). 확장 캔버스에서 `frame.height`가 화면에 그리는 배율이다.
 *
 * - 화면 폭의 1.65배: 기본 45° 시점에서 머리 폭이 화면 폭의 약 86%(390px 폭에서 뒤통수 오른쪽 끝이 화면 끝)라
 *   얼굴 쪽(왼쪽)과 이마·턱은 잘리지 않는다. 정면·측면은 머리 폭이 더 좁다.
 * - 화면 높이의 0.76배: 짧은 화면(375×667 등)에서 머리 높이가 접힌 시트 위 무대를 넘지 않게 막는다.
 * - 무대 높이는 쓰지 않는다. 시트를 펼치면 무대가 줄지만 얼굴 크기는 그대로 두고, 중심(offset)만 남은 무대로 옮긴다.
 *   예전에는 무대 높이(최대 500px)로 배율을 정해 시트를 펼치면 얼굴이 절반 가까이로 줄었다.
 */
export const TRIAL_FRAME_SCALE = { width: 1.65, height: 0.76 }

export function trialViewportFrame(
  frame: ViewportFrame,
  canvas: { width: number; height: number },
): ViewportFrame {
  const height = Math.round(
    Math.min(canvas.width * TRIAL_FRAME_SCALE.width, canvas.height * TRIAL_FRAME_SCALE.height),
  )
  return height > 0 ? { ...frame, height } : frame
}
