import { useState } from 'react'
import { PRIVATE_TEXT } from '@/shared/analytics'
import { labelOf } from '../editLogic'
import { toPercentLabel, type MorphParameterCatalog } from '../types'
import type { ChatItem } from './useConsult'

export function ConsultSummary({
  items,
  savedWeights,
  catalog,
}: {
  items: readonly ChatItem[]
  savedWeights?: Readonly<Record<string, number>>
  catalog?: MorphParameterCatalog | null
}) {
  const [copyStatus, setCopyStatus] = useState('')
  const latestConditions = items.findLast(
    (item) => item.role === 'user' && !item.sending && item.content.startsWith('상담 목표: '),
  )
  const [goal, keep] =
    latestConditions?.content.slice('상담 목표: '.length).split(' / 유지할 부위: ', 2) ?? []
  const concern = items.find(
    (item, index) => item.role === 'user' && items[index + 1]?.comparisonCode,
  )
  const applied = items.filter((item) => item.applyResult && item.applyResult.seq > 0)
  const latest = items.findLast((item) => item.role === 'assistant')
  const comparison = items.some((item) => item.previewed)
  const relatedCodes = [
    ...new Set(applied.flatMap((item) => item.applyResult!.applied.map((change) => change.code))),
  ].filter(
    (code) =>
      /^(nose\.|contour\.)/.test(code) &&
      code !== 'contour.weight_shape' &&
      code !== 'nose.tip_rotation' &&
      code !== 'nose.tip_height',
  )
  const current =
    savedWeights && relatedCodes.length
      ? relatedCodes
          .map(
            (code) =>
              `${labelOf(catalog ?? null, code)} ${toPercentLabel(savedWeights[code] ?? 0)}`,
          )
          .join(' · ')
      : null
  if (!goal && !concern && !applied.length && !latest?.options?.length && !comparison) return null
  // 상담 요약에는 원문 링크를 복사하지 않는다.
  const textOnly = (value: string) => value.replace(/https?:\/\/\S+/gi, '').trim()
  const summary = [
    [
      goal ? '원하는 변화' : '상담에서 말한 고민',
      textOnly(goal ?? concern?.content ?? '') || '아직 정하지 않았어요.',
    ],
    ['유지할 부위', textOnly(keep ?? '') || '아직 정하지 않았어요.'],
    ...(comparison
      ? [['비교한 시안', '3D 비교 제안을 받았어요. 저장된 변경은 아래에서 확인할 수 있어요.']]
      : []),
    [
      '상담에서 적용했던 기록',
      applied.map((item) => textOnly(item.applyResult!.summary)).join(' · ') ||
        '아직 적용한 변경이 없어요.',
    ],
    ...(applied.length
      ? [
          [
            '현재 시안',
            current
              ? `현재 저장값: ${current}. 다른 조절값은 직접 조절에서 확인할 수 있어요.`
              : '위 기록에는 되돌린 변경도 포함될 수 있어요. 현재 값은 직접 조절에서 확인해 주세요.',
          ],
        ]
      : []),
    [
      '확인이 필요한 조절',
      latest?.options
        ?.map((option) => textOnly(option.label))
        .filter(Boolean)
        .join(' · ') || '현재 대화에 남은 선택지는 없어요.',
    ],
    [
      '병원에서 물어볼 질문',
      goal || concern
        ? '이 변화를 상담할 때 어떤 각도와 기준을 비교하면 좋을까요?'
        : '원하는 변화와 유지할 부분을 어떻게 설명하면 좋을까요?',
    ],
  ]
  return (
    <details {...PRIVATE_TEXT} className="mb-3 rounded-[18px] border border-hairline-strong p-3">
      <summary className="cursor-pointer text-sm font-medium">상담 내용 정리</summary>
      <dl className="mt-2 space-y-2 text-sm">
        {summary.map(([label, content]) => (
          <div key={label}>
            <dt className="font-medium">{label}</dt>
            <dd className="break-words text-muted-soft">{content}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="mt-2 min-h-9 text-sm underline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              summary.map(([label, content]) => `${label}\n${content}`).join('\n\n'),
            )
            setCopyStatus('복사했어요.')
          } catch {
            setCopyStatus('복사하지 못했어요. 내용을 선택해 복사해 주세요.')
          }
        }}
      >
        상담 요약 복사
      </button>
      <p role="status" className="text-sm text-muted-soft">
        {copyStatus}
      </p>
    </details>
  )
}
