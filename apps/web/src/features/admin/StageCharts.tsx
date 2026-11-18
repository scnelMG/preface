import { formatDuration, NOT_MEASURED, secToMs } from './format'
import type { QualityDiag } from './types'

/**
 * 단계 패널의 그림(S15P31B204-709). 의존성 없이 SVG·div로 그린다.
 * 색은 토큰만 쓴다: MediaPipe = text-ink-2(회색), SfM = accent(보라).
 */

const DEFAULT_COLS = ['tMs', 'mpYaw', 'mpPitch', 'face', 'sfmYaw', 'sfmPitch']

export interface AnglePoint {
  /** 영상 시각(ms). 모르면 프레임 순번 */
  x: number
  mpYaw: number | null
  sfmYaw: number | null
}

/** diag.frames → 그래프 점. 시각이 하나도 없으면 순번을 x로 쓴다 */
export function anglePoints(diag: QualityDiag | undefined): {
  points: AnglePoint[]
  byTime: boolean
} {
  const frames = Array.isArray(diag?.frames) ? diag.frames : []
  const cols = Array.isArray(diag?.cols) ? diag.cols : DEFAULT_COLS
  const at = (name: string) => cols.indexOf(name)
  const [t, mp, sfm] = [at('tMs'), at('mpYaw'), at('sfmYaw')]
  const num = (row: (number | null)[], index: number) => {
    const value = index >= 0 ? row[index] : null
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const rows = frames.filter(Array.isArray)
  const byTime = rows.some((row) => num(row, t) !== null)
  return {
    byTime,
    points: rows
      .map((row, index) => ({
        x: byTime ? (num(row, t) ?? NaN) : index,
        mpYaw: num(row, mp),
        sfmYaw: num(row, sfm),
      }))
      .filter((point) => Number.isFinite(point.x)),
  }
}

const W = 600
const H = 220
const PAD = { left: 36, right: 12, top: 12, bottom: 24 }
/** ② 각도 판정·④ 측면 등록의 옆 기준(frames_bundle.py SIDE_MIN_DEG) */
const SIDE_DEG = 35

/**
 * 시간축 고개 각도(yaw) 그래프. MediaPipe yaw(회색 선)와 SfM yaw(보라 선)를 겹쳐 그리고, SfM에 등록되지 않은 프레임은
 * 그 시각의 MediaPipe 각도 위치에 빈 점으로 둔다. 점선은 ±35°(옆 기준).
 */
export function AngleChart({ diag }: { diag: QualityDiag | undefined }) {
  const { points, byTime } = anglePoints(diag)
  if (!points.length) {
    return <p className="type-caption text-muted-soft">프레임별 각도: {NOT_MEASURED}</p>
  }
  const xs = points.map((point) => point.x)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const yawMax = Math.max(
    60,
    ...points.flatMap((point) => [Math.abs(point.mpYaw ?? 0), Math.abs(point.sfmYaw ?? 0)]),
  )
  const yMax = Math.ceil(yawMax / 30) * 30
  const sx = (x: number) =>
    PAD.left + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right)
  const sy = (yaw: number) => PAD.top + ((yMax - yaw) / (2 * yMax)) * (H - PAD.top - PAD.bottom)
  const line = (key: 'mpYaw' | 'sfmYaw') =>
    points
      .filter((point) => point[key] !== null)
      .map((point) => `${sx(point.x).toFixed(1)},${sy(point[key]!).toFixed(1)}`)
      .join(' ')
  const unregistered = points.filter((point) => point.sfmYaw === null)
  const registered = points.length - unregistered.length
  const xLabel = (x: number) => (byTime ? `${(x / 1000).toFixed(1)}s` : `#${x + 1}`)

  return (
    <figure className="flex flex-col gap-(--space-8)">
      <ul className="type-caption flex flex-wrap gap-x-(--space-16) gap-y-(--space-4) text-muted-soft">
        <li className="flex items-center gap-(--space-6)">
          <span className="h-0.5 w-4 bg-ink-2" aria-hidden="true" />
          MediaPipe yaw
        </li>
        <li className="flex items-center gap-(--space-6)">
          <span className="h-0.5 w-4 bg-accent" aria-hidden="true" />
          SfM yaw
        </li>
        <li className="flex items-center gap-(--space-6)">
          <span className="size-2 rounded-full border border-accent" aria-hidden="true" />
          SfM 미등록 {unregistered.length}장
        </li>
        <li className="flex items-center gap-(--space-6)">
          <span className="w-4 border-t border-dashed border-faint" aria-hidden="true" />±{SIDE_DEG}
          ° 옆 기준
        </li>
      </ul>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full rounded-12 border border-hairline bg-surface"
        role="img"
        aria-label={`프레임별 고개 각도: ${points.length}장 중 SfM 등록 ${registered}장`}
      >
        {[-yMax, -SIDE_DEG, 0, SIDE_DEG, yMax].map((yaw) => (
          <g key={yaw}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(yaw)}
              y2={sy(yaw)}
              className={Math.abs(yaw) === SIDE_DEG ? 'stroke-faint' : 'stroke-hairline'}
              strokeDasharray={Math.abs(yaw) === SIDE_DEG ? '4 4' : undefined}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={sy(yaw) + 3}
              textAnchor="end"
              fontSize={10}
              className="fill-muted-soft"
            >
              {yaw}°
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 6} fontSize={10} className="fill-muted-soft">
          {xLabel(x0)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          fontSize={10}
          textAnchor="end"
          className="fill-muted-soft"
        >
          {xLabel(x1)}
        </text>
        <polyline
          points={line('mpYaw')}
          fill="none"
          className="stroke-ink-2"
          strokeWidth={1.5}
          data-series="mediapipe"
        />
        <polyline
          points={line('sfmYaw')}
          fill="none"
          className="stroke-accent"
          strokeWidth={1.5}
          data-series="sfm"
        />
        {points.map((point, index) =>
          point.sfmYaw !== null ? (
            <circle
              key={`s${index}`}
              cx={sx(point.x)}
              cy={sy(point.sfmYaw)}
              r={2.5}
              className="fill-accent"
              data-point="sfm"
            />
          ) : (
            <circle
              key={`u${index}`}
              cx={sx(point.x)}
              cy={sy(point.mpYaw ?? 0)}
              r={3.5}
              fill="none"
              className="stroke-accent"
              strokeWidth={1.5}
              data-point="unregistered"
            />
          ),
        )}
      </svg>
      <figcaption className="type-caption text-muted-soft">
        고른 프레임 {points.length}장 · SfM 등록 {registered}장 · 가로축{' '}
        {byTime ? '영상 시각' : '프레임 순서'}
      </figcaption>
    </figure>
  )
}

/**
 * 하위 단계 초를 가로 막대로(modelSec·bakeSec·finalizeSec). 값이 없으면 "미측정"(11/08 이전 작업 등).
 * 막대 길이는 그 묶음의 가장 큰 값 기준이다.
 */
export function SecondsBars({
  title,
  values,
  note,
}: {
  title: string
  values: Record<string, unknown> | null | undefined
  note?: string
}) {
  const entries = Object.entries(values ?? {}).flatMap(([name, sec]) => {
    const ms = secToMs(sec)
    return ms === null ? [] : [[name, ms] as const]
  })
  const max = Math.max(1, ...entries.map(([, ms]) => ms))
  return (
    <div className="flex flex-col gap-(--space-6)" role="group" aria-label={title}>
      <p className="type-caption text-muted-soft">
        {title}
        {note && <span className="ml-(--space-6) text-faint">{note}</span>}
      </p>
      {entries.length === 0 ? (
        <p className="type-caption text-faint">{NOT_MEASURED}</p>
      ) : (
        <ul className="flex flex-col gap-(--space-4)">
          {entries.map(([name, ms]) => (
            <li key={name} className="type-caption flex items-center gap-(--space-8)">
              <span className="pf-mono w-28 shrink-0 truncate text-ink-2" title={name}>
                {name}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(ms / max) * 100}%` }}
                />
              </span>
              <span className="pf-mono w-16 shrink-0 text-right text-ink">
                {formatDuration(ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
