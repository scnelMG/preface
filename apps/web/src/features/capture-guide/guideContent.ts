import type { IconName } from '@/shared/ui'

/**
 * 촬영 가이드 문구·그림 데이터. 화면과 떼어 둔다.
 *
 * PC 새 모델 화면(`features/capture-link`)과 휴대폰 촬영 가이드(SCR-05, `features/capture`의 CaptureGuide)가
 * 이 파일 하나를 쓴다. 두 화면은 Figma 문구가 달라 블록을 나눠 두었다(아래 "휴대폰 SCR-05" 절).
 *
 * 원본: Figma `Wireframe v3.2 최종` › `P3-51 촬영 가이드 모달 · 정면`·`SCR-05 … ② 촬영 / Mobile`(286:2417),
 * 기능명세서 FN-CAP-01.
 * FN-CAP-01은 정면 → 좌 → 우 → 위 → 아래 순서를 말하고 와이어프레임은 왼쪽·정면·오른쪽 탭 3개였다.
 * PC 모달은 팀 결정(2026-10-27)대로 탭 대신 순서 예시 GIF를 보인다(`CAPTURE_SEQUENCE`).
 */

/**
 * PC 모달의 촬영 순서 예시(GIF). 얼굴은 정면을 보고, 팔을 뻗은 휴대폰을 정면 → 내 오른쪽 90° → 정면 → 내 왼쪽 90° → 정면으로
 * 옮긴 뒤 고개를 위 → 아래로 움직이면 끝난다(2026-10-27 결정)
 * (팀 결정 2026-10-27). Figma의 왼쪽·정면·오른쪽 탭 자리에 이 움직이는 예시를 둔다.
 *
 * 그림은 도형으로만 그린 머리다(실제 얼굴 아님). 움직임 줄이기 설정에서는 첫 장면(정면)만 보인다.
 */
export const CAPTURE_SEQUENCE = {
  gif: '/guide/capture-sequence.gif',
  still: '/guide/capture-sequence-still.png',
  /** 그림 크기(px). 레이아웃이 튀지 않게 비율을 잡는다 */
  width: 440,
  height: 330,
  steps: [
    '정면',
    '휴대폰 오른쪽 90°',
    '정면',
    '휴대폰 왼쪽 90°',
    '정면',
    '고개 위로',
    '고개 아래로',
  ],
  alt: '촬영 순서 예시: 얼굴은 정면을 보고, 휴대폰을 든 팔을 뻗어 얼굴 정면에서 내 오른쪽으로 90도, 다시 정면, 내 왼쪽으로 90도, 다시 정면으로 옮긴 뒤 고개를 위로 들었다가 아래로 숙이면 끝나요',
} as const

/**
 * 촬영 순서 시연 영상(public/guide/capture-motion.*)의 단계 이름·한 줄 안내와 구간(초). `CaptureMotionGuide`가 쓴다.
 *
 * 2026-11-12: 웹 실시간 촬영 가이드(`live-capture/guideEngine.ts`의 GUIDE_STEPS)와 같은 순서로 바꿨다.
 * 촬영 전 검사 → 오른쪽(멈추면 녹화 시작) → 정면(왼손으로 바꿔 잡기) → 왼쪽 → 정면 → 위 → 아래.
 * 이름은 한 단어, 안내는 한 문장으로 핵심만 쓴다(예전 문구와 같은 길이). 손 바꾸기는 3단계 안내에 넣는다.
 * 왼쪽·오른쪽은 **찍는 사람 기준**이다(영상 속 사람의 오른쪽 = 보는 사람 화면의 왼쪽).
 * 영상은 갤럭시 모양 휴대폰으로 그렸다. 촬영 전 검사는 휴대폰 화면에 얼굴 테두리·헤어라인·귀·완료 표시를 글자 없이
 * 보이고(영상이 작게 보여 글자는 읽히지 않는다), 검사 항목 이름은 안내 문구에 적는다(실시간 가이드 검사 항목과 같다).
 * 녹화 점은 오른쪽에서 멈춘 뒤 켜져 아래가 끝나면 꺼진다.
 * 구간은 영상과 함께 만든 capture-motion.json과 같다(바꿀 때는 영상을 다시 만든다:
 * live-mirror-poc/.run/capture-motion, HyperFrames). 영상 끝(26.6초~)은 휴대폰을 다시 오른손으로 잡는 구간이다.
 */
export const CAPTURE_MOTION_STEPS = [
  {
    label: '촬영 전 검사',
    instruction: '정면에서 거리·위치·앞머리·안경을 확인해요.',
    start: 0,
    end: 4,
  },
  {
    label: '오른쪽',
    instruction: '휴대폰만 오른쪽으로 옮기고 멈추면 녹화가 시작돼요.',
    start: 4,
    end: 7.4,
  },
  {
    label: '정면',
    instruction: '정면으로 돌아와 왼손으로 바꿔 잡아요.',
    start: 7.4,
    end: 13.4,
  },
  {
    label: '왼쪽',
    instruction: '팔을 뻗은 채 왼쪽으로 천천히 옮겨요.',
    start: 13.4,
    end: 16.8,
  },
  {
    label: '정면',
    instruction: '정면에서 잠시 멈춰요.',
    start: 16.8,
    end: 19.8,
  },
  {
    label: '위',
    instruction: '휴대폰은 그대로, 고개만 천천히 들어요.',
    start: 19.8,
    end: 23.2,
  },
  {
    label: '아래',
    instruction: '휴대폰은 그대로, 고개만 천천히 숙여요.',
    start: 23.2,
    end: 26.6,
  },
] as const

export interface CaptureTip {
  icon: IconName
  text: string
}

export const CAPTURE_GUIDE = {
  title: '나를 입체적으로 담는 방법',
  intro: '정면부터 측면까지, 얼굴의 여러 각도가 담긴 영상을 준비해 주세요.',
  previewLabel: '촬영 순서 예시',
  tips: [
    { icon: 'Lightbulb', text: '밝고 일정한 조명에서 촬영하세요.' },
    { icon: 'Scan', text: '얼굴이 프레임 중앙에 오도록 맞춰 주세요.' },
    { icon: 'CheckCircle', text: '휴대폰을 천천히 옮겨 측면도 담아 주세요.' },
    // 이마 라인이 가려지면 3D 형상에 이마가 담기지 않는다(S15P31B204-446)
    {
      icon: 'User',
      text: '이마 라인과 귀가 보이게 머리를 정리해 주세요. 여성은 묶고, 남성은 헤어밴드로 넘겨 눌러 주세요.',
    },
  ] satisfies CaptureTip[],
  /** PC에서만 보인다 */
  pcNotice: 'PC에서는 휴대폰으로 촬영해요. 다음 화면의 QR을 휴대폰으로 찍어 주세요.',
  /** PC 모달의 다음 버튼 */
  pcNext: '영상 촬영하기',
} as const

/**
 * 새 모델(PC) 준비 카드(2026-10-31). 글 목록 대신 그림 카드 넷으로 해야 할 것(✓)과 하지 말 것(✕)을 보인다.
 * 내용은 위 `tips`·휴대폰 준비 안내(FN-CAP-01 설명: 얼굴 위치·이마 노출·거리·환경)와 같다.
 */
export interface CapturePrep {
  icon: IconName
  /** 같은 선 그림체의 작은 그림(public/guide/prep-*.svg, 일러스트 모션과 같은 그림체) */
  art: string
  title: string
  text: string
  /** do = 이렇게 해요, dont = 이건 피해요 */
  kind: 'do' | 'dont'
}

export const CAPTURE_PREP: readonly CapturePrep[] = [
  {
    icon: 'Lightbulb',
    art: '/guide/prep-light.svg',
    title: '밝은 곳에서',
    text: '빛은 얼굴 앞에서, 등 뒤 창문은 피해요',
    kind: 'do',
  },
  // 이마 라인이 가려지면 3D 형상에 이마가 담기지 않는다(S15P31B204-446)
  {
    icon: 'User',
    art: '/guide/prep-forehead.svg',
    title: '이마와 귀가 보이게',
    text: '긴 머리는 묶고, 앞머리는 넘겨요',
    kind: 'do',
  },
  {
    icon: 'Scan',
    art: '/guide/prep-center.svg',
    title: '얼굴은 화면 가운데',
    text: '팔을 쭉 뻗은 거리를 끝까지 지켜요',
    kind: 'do',
  },
  {
    icon: 'Eyeglasses',
    art: '/guide/prep-no-glasses.svg',
    title: '안경과 모자는 벗고',
    text: '얼굴 윤곽이 가려지지 않게',
    kind: 'dont',
  },
]

/** 준비 그림 아래 한 줄: 찍는 방법과 올릴 파일(원본 그대로, FN-CAP-01 · 휴대폰 안내 `original`과 같은 뜻) */
export const CAPTURE_PREP_NOTE =
  '멈추지 말고 한 번에 이어서 찍고, 편집하지 않은 원본 영상을 그대로 올려요.'

// ─── 휴대폰 SCR-05 (업로드 전용 세션 ② 촬영) ──────────────────────────────────
//
// Figma SCR-05에는 체크 안내 3줄만 있다. FN-CAP-01 수용 기준(얼굴 위치·권장 예시·이동 순서)과
// 설명(이마 노출·거리·환경)을 채우려고 이동 순서와 준비 안내를 더했다.
// 촬영 순서는 PC 모달과 같다(`CAPTURE_SEQUENCE`, 팀 결정 2026-10-27). 얼굴은 정면을 보고 휴대폰을 옮기며, 위·아래만 고개를 움직인다.

/** 찍기 전에 준비할 것(FN-CAP-01 설명: 얼굴 위치·이마 노출·거리·환경) */
export const MOBILE_CAPTURE_PREPARATION: readonly string[] = [
  '얼굴이 화면 가운데에 꽉 차게, 팔을 편하게 뻗은 거리에서 찍어요',
  // 이마 라인이 보여야 3D에 이마가 담긴다(S15P31B204-446)
  '남성은 헤어밴드로 머리를 넘겨 눌러, 이마 라인과 귀가 보이게 해요',
  '여성은 머리를 단정히 묶어, 이마와 귀가 보이게 해요',
  '안경·모자는 벗어요',
  '얼굴과 대비되는 배경 앞에 서요',
  '휴대폰을 오른쪽·왼쪽으로 옮긴 뒤, 고개를 위·아래로 움직여요',
]

export const MOBILE_CAPTURE_GUIDE = {
  eyebrow: '촬영 1/2단계',
  title: '휴대폰을 천천히 옮겨 담아요',
  /**
   * 제목 아래 한 줄(PC 새 모델 화면과 같은 말, 2026-10-31).
   * 권장 길이("약 N초면 충분해요")는 뺐다(S15P31B204-882). 실제로는 사람마다 걸리는 시간이 달라 안내와 어긋났다
   */
  intro: '얼굴은 그대로, 휴대폰만 반원을 그리며 옮겨요.',
  preparationLabel: '찍기 전에',
  /** 들어오자마자 뜨는 "찍기 전에" 팝업(S15P31B204-566). 닫는 버튼은 이것 하나다 */
  preparationTitle: '찍기 전에 확인해요',
  preparationConfirm: '확인했어요',
  preparationReopen: '찍기 전 확인 다시 보기',
  original: '원본 영상 그대로 올려요. 편집하거나 다른 앱으로 압축하지 마세요.',
  /** FN-CAP-01 예외: 카메라를 열 수 없음 [제안] */
  cameraHelp: '카메라가 열리지 않으면 휴대폰 설정에서 브라우저의 카메라 권한을 확인해 주세요.',
  capture: '영상 촬영하기',
} as const
