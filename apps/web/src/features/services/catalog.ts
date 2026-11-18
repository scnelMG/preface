import type { BadgeStatus, IconName } from '@/shared/ui'

/**
 * 서비스 섹션(P3-17) 목록. 메인(`/`)과 `/services`가 같이 쓴다.
 *
 * Figma Wireframe v3.2는 "얼굴 · 스타일" 탭(5개)만 그렸다. "AI 도우미" 항목은 기능명세서 v2.7의 1차·2차 범위에서 골랐다.
 * 2026-10-31 사용자 결정: "모델 · 기록" 탭을 빼고, AI 도우미에서 변경 요청 정리·변화 수치 보기·관련 시술 예시·스타일 아이디어·상담용 공유를 빼고 AI 관상을 더했다.
 *
 * 문구는 REQ-N-06 금칙어(진단·예측·효과 보장·필요한 시술·추천·성공 가능성)를 쓰지 않는다.
 */

export type ServiceGroupId = 'face' | 'ai'

/** 보기 필터. available = 지금 쓸 수 있음(일부 체험 포함), planned = 예정 */
export type ServiceFilter = 'all' | 'available' | 'planned'

export interface ServiceAction {
  label: string
  href: string
  /** 회원만 들어갈 수 있다. 비로그인이면 로그인 모달을 연다 */
  memberOnly?: boolean
}

export interface ServiceItem {
  id: string
  group: ServiceGroupId
  icon: IconName
  title: string
  status: BadgeStatus
  /** 상세 위 보라색 한 줄 */
  kicker: string
  description: string
  /** 상세의 작은 칩(예: 코 · 이용 가능) */
  options: string[]
  /** 예정 항목은 없다 */
  action?: ServiceAction
}

export const SERVICE_GROUPS: { id: ServiceGroupId; label: string }[] = [
  { id: 'face', label: '얼굴 · 스타일' },
  { id: 'ai', label: 'AI 도우미' },
]

export const SERVICE_FILTERS: { value: ServiceFilter; label: string }[] = [
  { value: 'all', label: '전체 상태' },
  { value: 'available', label: '이용 가능' },
  { value: 'planned', label: '예정' },
]

function planned(
  group: ServiceGroupId,
  id: string,
  icon: IconName,
  title: string,
  description: string,
): ServiceItem {
  return {
    id,
    group,
    icon,
    title,
    status: 'planned',
    kicker: '준비 중인 기능이에요.',
    description,
    options: [],
  }
}

export const SERVICES: readonly ServiceItem[] = [
  // 얼굴 · 스타일 — Figma P3-17 그대로
  {
    id: 'face-custom',
    group: 'face',
    icon: 'User',
    title: '3D 얼굴 커스텀',
    status: 'available',
    kicker: '작은 변화도, 여러 각도에서.',
    description:
      '코·눈·윤곽·체중을 부위별로 살펴보고 조절하는 기능입니다. 남성·여성 기본 모델로 바로 조절해 보고 원본과 비교할 수 있어요.',
    options: ['코 · 이용 가능', '눈 · 이용 가능', '윤곽 · 이용 가능', '체중 · 이용 가능'],
    action: { label: '3D 얼굴 체험하기', href: '/lab' },
  },
  // 헤어(S15P31B204-747): 회원 편집실(실험실 헤어 탭)에서만 쓴다. 비로그인 실험실(/lab)에는 없다.
  // 2026-11-15부터 '이용 가능'(-878, 일부 체험에서 바꿈)
  {
    id: 'hair',
    group: 'face',
    icon: 'Scissors',
    title: '헤어 스타일',
    status: 'available',
    kicker: '머리 모양까지 함께.',
    description:
      '머리 모양을 바꿔 얼굴과 함께 살펴보는 기능입니다. 로그인하면 내 작업실 편집실에서 이용할 수 있어요.',
    options: ['내 작업실 편집실', '로그인 후 이용'],
    action: { label: '내 작업실에서 해 보기', href: '/studio', memberOnly: true },
  },
  // 표정 트래킹(S15P31B204-874): 회원 편집실 3D 무대 왼쪽 위 버튼. 표정 옵션이 든 리그를 가진 모델에서만 보인다.
  // 웹캠 영상은 브라우저 안에서만 처리하고 저장·전송하지 않는다(ExpressionControl). 2026-11-15 이용 가능(-878)
  {
    id: 'expression',
    group: 'face',
    icon: 'Smiley',
    title: '표정 트래킹',
    status: 'available',
    kicker: '내 표정 그대로, 3D로.',
    description:
      '웹캠으로 지은 표정을 내 모델 3D에 실시간으로 옮겨 살펴보는 기능입니다. 영상은 이 브라우저 안에서만 처리하고 저장하거나 보내지 않아요. 로그인하면 내 작업실 편집실에서 이용할 수 있어요.',
    options: ['내 작업실 편집실', '웹캠 사용', '로그인 후 이용'],
    action: { label: '내 작업실에서 해 보기', href: '/studio', memberOnly: true },
  },
  planned(
    'face',
    'eyewear',
    'Eyeglasses',
    '안경 피팅',
    '안경테를 3D 얼굴에 씌워 여러 각도에서 비교하는 기능입니다.',
  ),
  planned(
    'face',
    'makeup',
    'PaintBrush',
    '메이크업',
    '색과 질감을 얹어 분위기 변화를 살펴보는 기능입니다.',
  ),

  // AI 도우미 — Figma에 항목이 없다(기획 확인 필요)
  {
    id: 'ai-consult',
    group: 'ai',
    icon: 'ChatCircleText',
    title: 'AI 실장님 상담',
    status: 'partial',
    kicker: '말로 정리하는 나의 생각.',
    description:
      '원하는 변화를 말로 전하면 AI 실장님이 요청을 정리해 내 모델 3D에 반영해요. 로그인하면 내 작업실에서 이용할 수 있어요.',
    options: ['코 · 이용 가능', '눈 · 이용 가능', '윤곽 · 이용 가능', '체중 · 이용 가능'],
    action: { label: '내 작업실에서 상담하기', href: '/studio', memberOnly: true },
  },
  // AI 관상(S15P31B204-440): 새 3D를 만드는 대기 화면에서 본다. 동의서 v2 시행(2026-11-03 00:00 KST) 전에는 운영에서 끈다(flag.ts)
  {
    id: 'ai-face-reading',
    group: 'ai',
    icon: 'Sparkle',
    title: 'AI 관상',
    status: 'available',
    kicker: '재미로 보는 얼굴 풀이.',
    description:
      '새 3D를 만드는 동안, 촬영한 영상의 정면 사진 한 장으로 AI가 얼굴을 재미로 풀어 줘요. 의학적·과학적 근거가 없고 성형 상담이 아니에요.',
    options: ['3D 만드는 동안', '재미용 풀이'],
    action: { label: '새 모델 만들며 보기', href: '/studio/new', memberOnly: true },
  },
  planned(
    'ai',
    'ai-ratio',
    'Scan',
    '얼굴 비율 살펴보기',
    '부위별 비율을 한눈에 정리해 보여 주는 기능입니다.',
  ),
]

export function servicesOf(group: ServiceGroupId): ServiceItem[] {
  return SERVICES.filter((item) => item.group === group)
}

export function matchesFilter(item: ServiceItem, filter: ServiceFilter): boolean {
  if (filter === 'all') return true
  return filter === 'planned' ? item.status === 'planned' : item.status !== 'planned'
}
