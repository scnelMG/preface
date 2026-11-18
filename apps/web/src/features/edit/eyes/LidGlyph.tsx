'use client'
import { useId } from 'react'
import type { EyeStyle } from './state'

export type LidMark = 'height' | 'depth' | 'inner' | 'outer' | 'upper' | 'lower'

// 모든 그림이 같은 방향을 쓴다: 앞머리(눈머리) = 왼쪽, 꼬리 = 오른쪽. 선 굵기는 크기와 관계없이 1.4px(non-scaling-stroke).
const LASH: [number, number][] = [
  [8, 22],
  [20, 10],
  [42, 8],
  [56, 19],
]
const LASH_PATH = 'M8 22 C20 10 42 8 56 19'
const LOWER = 'M8 22 C22 31 42 31 56 19'
// 모양별 쌍꺼풀 선이 눈꺼풀에서 떨어진 정도(앞머리 → 꼬리). 인라인은 앞머리에서 합류, 아웃라인은 처음부터 나란하다.
const LIFT: Record<EyeStyle, [number, number, number, number]> = {
  inline: [0.05, 0.7, 1, 1.15],
  inout: [0.45, 0.9, 1, 1.15],
  outline: [0.95, 1, 1.05, 1.15],
}
const START_SHIFT: Record<EyeStyle, number> = { inline: 3, inout: 0, outline: -2 }
// 바뀌는 곳·방향 표시(트임 방향 화살표, 높이는 위아래 화살표)
const MARKS: Partial<Record<LidMark, string>> = {
  height: 'M62 -2V10M59.5 0.5L62 -2L64.5 0.5M59.5 7.5L62 10L64.5 7.5',
  inner: 'M6 22H0M2.5 19.5L0 22L2.5 24.5',
  outer: 'M58 19H64M61.5 16.5L64 19L61.5 21.5',
  upper: 'M13 13L9 8M9 11.5V8H12.5',
  lower: 'M48 27L52 32M48.5 32H52V28.5',
}

const fmt = (n: number) => Math.round(n * 10) / 10

function creasePath(style: EyeStyle) {
  const gap = 5
  const lift = LIFT[style]
  const p = LASH.map(([x, y], i) => [
    x + (i === 0 ? START_SHIFT[style] : i === 3 ? 3 : 0),
    y - gap * lift[i],
  ])
  return `M${fmt(p[0][0])} ${fmt(p[0][1])} C${p
    .slice(1)
    .map(([x, y]) => `${fmt(x)} ${fmt(y)}`)
    .join(' ')}`
}

/**
 * 선으로만 그린 작은 눈. 쌍꺼풀 모양 고르기 칸과 눈 슬라이더 줄 앞 아이콘에 같은 말투로 쓴다.
 * `mark`는 그 줄이 바꾸는 곳(높이 화살표·깊이 굵은 선·트임 방향 화살표). 결과 예측 그림은 아니다.
 */
export function LidGlyph({ style, mark }: { style?: EyeStyle; mark?: LidMark }) {
  const clip = useId()
  const crease = style ?? (mark === 'height' || mark === 'depth' ? 'inout' : undefined)
  const line = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1.4 }
  return (
    <svg
      viewBox="-2 -4 68 40"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        <clipPath id={clip}>
          <path d={`${LASH_PATH} C42 31 22 31 8 22Z`} />
        </clipPath>
      </defs>
      <circle
        cx="31"
        cy="20"
        r="3.4"
        fill="currentColor"
        stroke="none"
        clipPath={`url(#${clip})`}
      />
      <path d={LOWER} {...line} opacity="0.45" />
      <path d={LASH_PATH} {...line} />
      {crease ? (
        <path d={creasePath(crease)} {...line} strokeWidth={mark === 'depth' ? 2.4 : 1.4} />
      ) : null}
      {mark && MARKS[mark] ? <path d={MARKS[mark]} {...line} /> : null}
    </svg>
  )
}
