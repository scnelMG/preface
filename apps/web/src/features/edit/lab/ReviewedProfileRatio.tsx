import { useEffect, useState } from 'react'
import { getBaselineMeasurements } from '../api'

type Result = Awaited<ReturnType<typeof getBaselineMeasurements>>
const SOURCE = 'https://www.facebase.org/resources/human/facial_norms/notes/'

function reviewedRatio(result: Result) {
  if (result.status !== 'AVAILABLE') return null
  const measurement = (code: string) =>
    result.observations.find(
      (row) =>
        row.code === code &&
        row.definition === 'alar-lateral-frontal-basal-v1' &&
        row.unit === 'model-space' &&
        row.quality === 'reviewed-pair' &&
        Number.isFinite(row.lower) &&
        Number.isFinite(row.upper) &&
        row.lower > 0 &&
        row.upper >= row.lower,
    )
  const nose = measurement('alarWidth')
  const eyes = measurement('intercanthalDistance')
  if (!nose || !eyes) return null
  const lower = (nose.lower / eyes.upper) * 100
  const upper = (nose.upper / eyes.lower) * 100
  if (lower <= 0 || !Number.isFinite(upper)) return null
  return {
    range: `${(Math.floor(lower) / 100).toFixed(2)}~${(Math.ceil(upper) / 100).toFixed(2)}배`,
    comparison:
      nose.lower > eyes.upper
        ? '검수 범위에서도 콧볼이 눈 안쪽 간격보다 넓게 측정됐어요.'
        : nose.upper < eyes.lower
          ? '검수 범위에서도 콧볼이 눈 안쪽 간격보다 좁게 측정됐어요.'
          : '두 거리의 검수 범위가 겹치거나 닿아 어느 쪽이 더 넓은지 판단하기 어려워요.',
  }
}

export function ReviewedProfileRatio({ faceModelId }: { faceModelId: string }) {
  const [result, setResult] = useState<Result | 'error' | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getBaselineMeasurements(faceModelId, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult(data)
      },
      () => {
        if (!controller.signal.aborted) setResult('error')
      },
    )
    return () => controller.abort()
  }, [faceModelId, retry])
  const ratio = result && result !== 'error' ? reviewedRatio(result) : null
  return (
    <div className="mt-4 border-t border-hairline-strong pt-3">
      <h3 className="text-sm font-medium">원본 검수 기록</h3>
      {ratio ? (
        <div className="mt-1 space-y-1">
          <p className="text-sm">
            콧볼 너비 ÷ 눈 안쪽 간격 <strong>{ratio.range}</strong>
          </p>
          <p className="type-caption text-muted-soft">{ratio.comparison}</p>
          <a
            href={SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent underline"
          >
            콧볼과 눈 안쪽 기준점 출처
          </a>
        </div>
      ) : result === 'error' ? (
        <p className="type-caption text-muted-soft">
          검수 기록을 불러오지 못했어요.{' '}
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => {
              setResult(null)
              setRetry((count) => count + 1)
            }}
          >
            다시 확인
          </button>
        </p>
      ) : (
        <p className="type-caption text-muted-soft">
          {result
            ? '이 원본에 등록된 콧볼·눈 안쪽 검수 기록이 없어요.'
            : '원본 검수 기록을 확인하고 있어요.'}
        </p>
      )}
    </div>
  )
}
