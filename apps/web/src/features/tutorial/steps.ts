/** 기본 모델 체험 튜토리얼 4단계(REQ-F-09 확정 순서: 회전 → 부위 선택 → 슬라이더 → 되돌리기) */
export type TrialStepId = 'rotate' | 'part' | 'slider' | 'undo'

export interface TutorialStep<Id extends string = string> {
  id: Id
  title: string
  body: string
  /**
   * 카드를 놓을 곳(TutorialCard). 기본은 가리키는 버튼·조절 바로 옆(`target`).
   * 3D 자체를 만지는 단계는 무대 아래 가운데(`stage`)에 두어 모델을 가리지 않는다
   */
  placement?: 'stage' | 'target'
  /** 해 보면 다음 단계로 넘어가기까지 기다리는 시간(ms). 바뀐 모습을 잠깐 보게 한다 */
  advanceDelay?: number
}

export const TRIAL_TUTORIAL_STEPS: readonly TutorialStep<TrialStepId>[] = [
  {
    id: 'rotate',
    title: '돌려 보기',
    body: '모델을 드래그해 돌리고, 스크롤이나 두 손가락으로 확대해요. 오른쪽 버튼으로 끌거나 두 손가락으로 끌면 옮길 수 있어요.',
  },
  {
    id: 'part',
    title: '부위 고르기',
    body: '바꿀 부위를 골라요. 체험에서는 코를 바꿔 볼 수 있어요.',
  },
  {
    id: 'slider',
    title: '슬라이더로 조절하기',
    body: '슬라이더를 움직이면 기본 모델에 바로 반영돼요. 콧대·코끝·콧볼을 바꿔 보세요.',
  },
  {
    id: 'undo',
    title: '되돌리기',
    body: '항목 옆 ⟲로 하나씩, ‘모두 되돌리기’로 처음 모양으로 돌아가요. 체험 값은 저장되지 않아요.',
  },
]

/**
 * 메인(`/`) 체험 튜토리얼 4단계(REQ-F-09 순서 그대로, 2026-11-02). 위 4단계는 2026-10-30 메인 재구성 전 화면용이다.
 *
 * - 1단계는 회전·확대에 이동과 조명을 묶었다. 조명 구는 말풍선이 마우스를 올려야만 떠서 터치로는 찾을 수 없었다.
 * - 단계를 늘리지 않고, 해 본 조작은 1단계 안에서 하나씩 체크된다(`LOOK_GESTURES`).
 * - 2~4단계는 실제로 해 보면 저절로 넘어간다. `다음`도 언제나 누를 수 있다.
 */
export type MainStepId = 'look' | 'part' | 'adjust' | 'history'

export const MAIN_TUTORIAL_STEPS: readonly TutorialStep<MainStepId>[] = [
  {
    id: 'look',
    title: '둘러보기',
    body: '직접 해 보면 하나씩 체크돼요.',
    placement: 'stage',
    advanceDelay: 700,
  },
  { id: 'part', title: '부위 고르기', body: '코와 눈 중에서 바꿀 곳을 골라요.', advanceDelay: 600 },
  {
    id: 'adjust',
    title: '조절하기',
    body: '값을 움직이면 모델에 바로 반영돼요.',
    advanceDelay: 1200,
  },
  {
    id: 'history',
    title: '되돌리기',
    body: '한 단계씩 되돌리거나 처음으로 돌아가요. 체험 값은 저장되지 않아요.',
    advanceDelay: 700,
  },
]

/** 1단계에서 해 볼 조작. 터치는 두 손가락 한 번으로 확대·이동이 같이 체크된다 */
export type LookGesture = 'rotate' | 'zoom' | 'pan' | 'light'
export const LOOK_GESTURES: readonly LookGesture[] = ['rotate', 'zoom', 'pan', 'light']

/**
 * 편집실(`/simulations/[id]`) 첫 사용 안내(2026-11-03). 메인 4단계(돌리기·부위·슬라이더·되돌리기)는 같은 부품이라 되풀이하지 않고,
 * 편집실에만 있어 말풍선·버튼 이름만으로는 알기 어려운 것만 짚는다. 기획 범위(REQ-F-09) 밖의 추가 안내다.
 *
 * - 원본 보기: 누르고 있는 동안만 원본이다. 말풍선은 마우스를 올려야 떠서 터치로는 알 수 없었다
 * - 상담: 첫 화면이 직접 조절이라 지나치기 쉽다
 * - 완료(S15P31B204-844, 예전 `시안 저장`): 편집은 이미 자동 저장되고, 이 버튼은 저장이 끝나기를 기다렸다 작업실 `시안`으로 간다.
 *   다시 저장하라는 뜻으로 읽히지 않게 자동 저장을 먼저 말하고, 이름은 제목(✎)에서 바꾼다는 것과 원본이 남아 비교할 수 있다는 것을 덧붙인다
 *   (예전 이름 창의 '원본 3D는 그대로예요'가 어색하다는 의견, 2026-11-15). 단계 id(`save`)는 그대로 둔다
 *
 * 코 구조 조절(점 끌기)은 운영의 내 모델에서 버튼이 뜨지 않아 개발에서도 버튼을 숨기기로 해(2026-11-03) 안내에서 뺐다.
 * 버튼을 다시 열 때 이 목록에 단계를 다시 넣는다.
 */
export type EditorStepId = 'compare' | 'consult' | 'save'

export const EDITOR_TUTORIAL_STEPS: readonly TutorialStep<EditorStepId>[] = [
  {
    id: 'compare',
    title: '원본 보기',
    body: '누르고 있는 동안 바꾸기 전 모습이 보여요.',
    advanceDelay: 600,
  },
  {
    id: 'consult',
    title: 'AI 상담',
    body: '원하는 변화를 말로 고르면 3D에 반영돼요.',
    advanceDelay: 700,
  },
  {
    id: 'save',
    title: '완료',
    body: '바꾼 내용은 자동으로 저장돼요. 이름은 위 제목의 ✎로 바꿔요. 원본 얼굴은 그대로 남아 언제든 비교할 수 있어요.',
    advanceDelay: 300,
  },
]

/**
 * 체험 실험실(`/lab`) 첫 사용 안내(S15P31B204-746). 메인과 같은 순서(둘러보기 → 부위 → 조절 → 되돌리기)로,
 * 체험 실험실에 실제로 있는 조작만 짚는다.
 *
 * - 원본 보기: 체험 실험실에는 원본 보기 버튼이 없어(FaceStage `compare={false}`) 넣지 않는다.
 * - 둘러보기: 3D를 끌거나 휠·두 손가락으로 확대해 보면 넘어간다. 조명 구가 없어 메인처럼 조작 칩을 두지 않는다.
 */
export type GuestLabStepId = 'look' | 'part' | 'adjust' | 'history'

export const GUEST_LAB_TUTORIAL_STEPS: readonly TutorialStep<GuestLabStepId>[] = [
  {
    id: 'look',
    title: '둘러보기',
    body: '모델을 드래그해 돌리고, 스크롤이나 두 손가락으로 확대해요.',
    placement: 'stage',
    advanceDelay: 700,
  },
  {
    id: 'part',
    title: '부위 고르기',
    body: '눈·코·윤곽·체중 중에서 바꿀 곳을 골라요.',
    advanceDelay: 600,
  },
  {
    id: 'adjust',
    title: '슬라이더로 조절하기',
    body: '슬라이더를 움직이면 모델에 바로 반영돼요.',
    advanceDelay: 1200,
  },
  {
    id: 'history',
    title: '되돌리기',
    body: '한 단계씩 되돌리거나 ‘처음으로’ 돌아가요. 체험 값은 저장되지 않아요.',
    advanceDelay: 700,
  },
]
