import { SAMPLE_HEADS } from '@/features/studio/samples'

/** 계정 이력이 아닌 회전형 작업실 검토용 샘플이다. */
export const WORKSPACE_MODELS: readonly WorkspaceModel[] = [
  {
    id: 'female',
    title: '여성 기본 모델',
    sample: SAMPLE_HEADS[1],
    date: '2026.10.29',
    pose: 0.3,
    weights: {},
    href: '/preview/editor?member=1&source=workspace&sample=base-female',
    drafts: [
      {
        title: '코끝 시안',
        change: '코끝 돌출 조절',
        date: '2026-10-29',
        weights: { 'nose.tip_projection': 0.35 },
        href: '/preview/editor?member=1&source=workspace&sample=base-female&variant=tip',
      },
    ],
  },
  {
    id: 'male',
    title: '남성 기본 모델',
    sample: SAMPLE_HEADS[0],
    date: '2026.10.28',
    pose: -0.2,
    weights: {},
    href: '/preview/editor?member=1&source=workspace&sample=base-male',
    drafts: [],
  },
  {
    id: 'practice',
    title: '연습용 모델',
    sample: SAMPLE_HEADS[1],
    date: '2026.10.27',
    pose: -0.4,
    weights: { 'nose.tip_projection': 0.35 },
    href: '/preview/editor?member=1&source=workspace&sample=base-female&variant=tip',
    drafts: [],
  },
]

export interface WorkspaceModel {
  local?: boolean
  id: string
  title: string
  sample: (typeof SAMPLE_HEADS)[number]
  date: string
  pose: number
  weights: Record<string, number>
  href: string
  drafts: {
    title: string
    change: string
    date: string
    href: string
    weights: Record<string, number>
  }[]
}

export function wrapIndex(index: number, count: number) {
  return ((index % count) + count) % count
}

/** 많은 모델에서도 현재 선택 주변의 표시만 남긴다. */
export function modelPositionIndexes(count: number, selected: number, limit = 7) {
  const size = Math.min(count, limit)
  const start = Math.max(0, Math.min(count - size, selected - Math.floor(size / 2)))
  return Array.from({ length: size }, (_, i) => start + i)
}
