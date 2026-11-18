/**
 * 휴대폰 업로드 전용 세션의 휴대폰 종류(S15P31B204-408, -619).
 *
 * 촬영은 모두 웹 녹화다(-619). 종류는 기종을 어떻게 얻을지만 정한다.
 * - `iphone`: Safari는 기종을 알려 주지 않는다. "영상 촬영하기"를 누를 때 시트(`IphoneModelSheet`)에서 사용자가 세대를 고른다(`IPHONE_GENERATIONS`, -635·-756).
 * - `android`: 브라우저 정보(`userAgentData` 고엔트로피 값 `model`)로 읽는다(`readDeviceModel`).
 *
 * 기종은 업로드 요청에 실려 추출 워커의 렌즈 표(`device_profiles.json`) 출발값이 된다. 영상 안 기록이 있으면 그쪽이 이긴다.
 * 기본값(아이폰·안드로이드)만 브라우저 정보로 짐작하고, 연결 확인 화면에서 바꿀 수 있다.
 */
export type CaptureDevice = 'iphone' | 'android'

/**
 * 브라우저 정보로 기본 선택을 짐작한다. iOS(아이폰·아이패드)면 `iphone`, 나머지는 `android`.
 * 아이패드OS Safari는 데스크톱(Macintosh)처럼 보고하므로 터치 지점 수로 가른다.
 */
export function detectCaptureDevice(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): CaptureDevice {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iphone'
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'iphone'
  return 'android'
}

/**
 * 휴대폰·태블릿 브라우저인지(S15P31B204-457). 머리 추가에서 QR 대신 이 기기로 바로 촬영할지 정한다.
 * 화면 폭이 아니라 기기 정보로 가른다 — PC 창을 좁혀도 QR이 떠야 한다. 아이패드OS는 Macintosh로 보고하므로 터치 지점 수로 가른다.
 */
export function isMobileDevice(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): boolean {
  if (/Android|iPhone|iPad|iPod|Mobi/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

/** 아이폰 세대 하나. 시트의 한 줄이다 */
export interface IphoneGeneration {
  /** 업로드 요청의 `deviceModel`로 보내는 대표 기종 이름(렌즈 표 `match`에 걸리는 이름) */
  value: string
  /** 줄 제목 */
  label: string
  /** 이 줄에 드는 기종. 시트에 작은 글씨로 보이고, 예전에 고른 기종 이름을 이 줄로 되돌릴 때도 쓴다 */
  models: readonly string[]
}

/**
 * 아이폰 기종 시트의 줄(최신 순, S15P31B204-756). 기종 28개를 세대로 묶었다.
 *
 * 추출 워커 렌즈 표 `services/gpu-worker/reconstruction/assets/device_profiles.json`에서 같은 세대의 Pro·Pro Max·Plus·mini·기본은
 * 전면 카메라 초점이 모두 같다(1080x1920 기준 18·17·Air 1018 px, 14~16·17e 1222 px, 12·13 1273 px). 그래서 세대만 고르면 렌즈
 * 출발값은 기종을 하나하나 고를 때와 같다. 17e는 이름은 17이지만 초점이 16 세대 값이라 따로 한 줄이다.
 * 워커는 `match` 포함 여부·가장 긴 일치로 프로필을 고른다. `device.test.ts`가 대표 이름과 묶음 안 기종이 모두 같은 초점인지 확인한다.
 * 나중에 한 세대 안에서 실측 초점이 갈리면 그 세대만 두 줄로 나눈다.
 */
export const IPHONE_GENERATIONS: readonly IphoneGeneration[] = [
  { value: 'iPhone 18 Pro', label: 'iPhone 18', models: ['iPhone 18 Pro', 'iPhone 18 Pro Max'] },
  {
    value: 'iPhone 17',
    label: 'iPhone 17',
    models: ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air'],
  },
  { value: 'iPhone 17e', label: 'iPhone 17e', models: ['iPhone 17e'] },
  {
    value: 'iPhone 16',
    label: 'iPhone 16',
    models: ['iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16e'],
  },
  {
    value: 'iPhone 15',
    label: 'iPhone 15',
    models: ['iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max'],
  },
  {
    value: 'iPhone 14',
    label: 'iPhone 14',
    models: ['iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max'],
  },
  {
    value: 'iPhone 13',
    label: 'iPhone 13',
    models: ['iPhone 13', 'iPhone 13 mini', 'iPhone 13 Pro', 'iPhone 13 Pro Max'],
  },
  {
    value: 'iPhone 12',
    label: 'iPhone 12',
    models: ['iPhone 12', 'iPhone 12 mini', 'iPhone 12 Pro', 'iPhone 12 Pro Max'],
  },
]

/** 기종 이름(대표 이름이나 예전 시트에서 고른 이름)이 드는 세대. 없으면 null */
export function iphoneGenerationOf(model: string | null | undefined): IphoneGeneration | null {
  if (!model) return null
  return IPHONE_GENERATIONS.find((g) => g.value === model || g.models.includes(model)) ?? null
}

/** 서버 `deviceModel` 최대 길이 */
export const DEVICE_MODEL_MAX = 100

interface UserAgentDataLike {
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>
}

/**
 * 안드로이드 기종(예: `SM-S921N`). Chrome 계열은 `userAgentData`로, 그 밖에는 UA 안의 삼성 모델명으로 읽는다.
 * 모르면 null. 아이폰은 브라우저가 알려 주지 않아 늘 null이다.
 */
export async function readDeviceModel(
  nav: Pick<Navigator, 'userAgent'> & { userAgentData?: UserAgentDataLike } = navigator,
): Promise<string | null> {
  try {
    const values = await nav.userAgentData?.getHighEntropyValues?.(['model'])
    const model = values?.model?.trim()
    if (model) return model.slice(0, DEVICE_MODEL_MAX)
  } catch {
    // 거절되면 UA로 짐작한다
  }
  return nav.userAgent.match(/;\s*(SM-[A-Z0-9]+)/)?.[1] ?? null
}
