'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { cx } from '@/shared/ui'
import { formatDuration, formatNumber, NO_REPORT, NOT_MEASURED } from './format'
import { Mono, TABLE, TableScroll, TD, TH } from './parts'
import { ADMIN_PATHS } from './paths'
import { AngleChart, SecondsBars } from './StageCharts'
import {
  defaultStage,
  jobStages,
  STAGE_STATUS_LABELS,
  type JobStages,
  type StageKey,
  type StageStatus,
  type StageVerdict,
  type StageView,
  type WaitBand,
} from './stageView'
import type { AdminJobDetail, QualityReport } from './types'

/**
 * 생성 단계 6칸 진행 바와 고른 단계의 패널(판정 · 시간 · 진단값 · 산출물). S15P31B204-709.
 * 실패 단계가 있으면 그 패널을 먼저 연다. 건너뜀 칸은 점선으로 두고 패널 내용이 없다.
 */
export function StageSection({ detail }: { detail: AdminJobDetail }) {
  const view = useMemo(() => jobStages(detail), [detail])
  const [selected, setSelected] = useState<StageKey>(() => defaultStage(view.stages))
  const stage = view.stages.find((item) => item.key === selected) ?? view.stages[0]
  return (
    <div className="flex flex-col gap-(--space-16)">
      <StageBar view={view} selected={stage.key} onSelect={setSelected} />
      <StagePanel stage={stage} view={view} detail={detail} />
    </div>
  )
}

const CELL_TONE: Record<StageStatus, string> = {
  pending: 'border-hairline bg-surface text-faint',
  running: 'border-accent bg-accent-soft text-ink',
  passed: 'border-hairline bg-surface text-ink',
  passed_with_notes: 'border-accent bg-surface text-ink',
  failed: 'border-status-danger bg-surface text-status-danger',
  skipped: 'border-dashed border-hairline-strong bg-canvas text-faint',
}

const STATUS_TONE: Record<StageStatus, string> = {
  pending: 'text-faint',
  running: 'text-accent',
  passed: 'text-muted-soft',
  passed_with_notes: 'text-accent',
  failed: 'text-status-danger',
  skipped: 'text-faint',
}

function StageBar({
  view,
  selected,
  onSelect,
}: {
  view: JobStages
  selected: StageKey
  onSelect: (key: StageKey) => void
}) {
  const waitAfter = (key: StageKey) => view.waits.find((wait) => wait.after === key)
  const waitText = (wait: WaitBand) =>
    `${wait.label} ${wait.recorded ? formatDuration(wait.durationMs) : '기록 없음'}`
  return (
    <div className="flex flex-col gap-(--space-6)">
      <div className="w-full overflow-x-auto" role="group" aria-label="생성 단계" tabIndex={0}>
        <ol className="flex min-w-max items-stretch md:min-w-0">
          {view.stages.map((stage) => {
            const wait = waitAfter(stage.key)
            return (
              <li key={stage.key} className="flex min-w-28 flex-1 items-stretch">
                <button
                  type="button"
                  aria-pressed={stage.key === selected}
                  data-status={stage.status}
                  onClick={() => onSelect(stage.key)}
                  className={cx(
                    'flex w-full flex-col items-start gap-(--space-2) rounded-12 border px-(--space-10) py-(--space-8) text-left',
                    CELL_TONE[stage.status],
                    stage.key === selected && 'ring-2 ring-ink',
                  )}
                >
                  <span className="type-caption font-medium">
                    {stage.no} {stage.label}
                  </span>
                  <span className={cx('type-caption', STATUS_TONE[stage.status])}>
                    {STAGE_STATUS_LABELS[stage.status]}
                  </span>
                  <span className="type-caption pf-mono text-muted-soft">
                    {stage.status === 'skipped' || stage.status === 'pending'
                      ? '-'
                      : stage.durationMs === null
                        ? NOT_MEASURED
                        : formatDuration(stage.durationMs)}
                  </span>
                </button>
                {wait ? (
                  <span
                    className="flex w-(--space-16) shrink-0 justify-center py-(--space-8)"
                    data-wait={wait.key}
                    title={waitText(wait)}
                  >
                    <span
                      className={cx(
                        'w-(--space-2) rounded-full',
                        wait.recorded ? 'bg-hairline-strong' : 'bg-hairline',
                      )}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{waitText(wait)}</span>
                  </span>
                ) : (
                  stage.key !== 'finalize' && (
                    <span className="w-(--space-6) shrink-0" aria-hidden="true" />
                  )
                )}
              </li>
            )
          })}
        </ol>
      </div>
      <p className="type-caption text-muted-soft" aria-hidden="true">
        단계 사이 띠: {view.waits.map(waitText).join(' · ')}
      </p>
    </div>
  )
}

function StagePanel({
  stage,
  view,
  detail,
}: {
  stage: StageView
  view: JobStages
  detail: AdminJobDetail
}) {
  const title = `${stage.no} ${stage.label}`
  return (
    <section
      aria-label={`${title} 패널`}
      data-stage={stage.key}
      className={cx(
        'rounded-12 border p-(--space-16)',
        stage.status === 'skipped' ? 'border-dashed border-hairline-strong' : 'border-hairline',
        stage.status !== 'skipped' && 'bg-surface',
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-(--space-12) gap-y-(--space-4)">
        <h3 className="type-label text-ink">{title}</h3>
        <span className="type-caption text-muted-soft">{stage.place}</span>
        <span className={cx('type-caption font-medium', STATUS_TONE[stage.status])}>
          {STAGE_STATUS_LABELS[stage.status]}
        </span>
      </header>
      {stage.status === 'skipped' ? (
        <p className="type-caption mt-(--space-12) text-faint">
          앞 단계에서 멈춰 실행되지 않았어요.
        </p>
      ) : stage.status === 'pending' ? (
        <p className="type-caption mt-(--space-12) text-faint">아직 시작하지 않았어요.</p>
      ) : (
        <div className="mt-(--space-12) flex flex-col gap-(--space-20)">
          <Block title="판정">
            <Verdicts stage={stage} guessed={view.failed === stage.key && view.failedGuessed} />
          </Block>
          <Block title="시간">
            <TimeBlock stage={stage} quality={view.quality} />
          </Block>
          <Block title="진단값">
            <Diagnostics stage={stage} view={view} detail={detail} />
          </Block>
          <Block title="산출물">
            <Artifacts stage={stage} detail={detail} />
          </Block>
        </div>
      )}
    </section>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-(--space-8)" role="group" aria-label={title}>
      <h4 className="type-caption font-medium text-ink-2">{title}</h4>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-(--space-2)">
      <dt className="type-caption text-muted-soft">{label}</dt>
      <dd className="type-caption break-words text-ink">{children}</dd>
    </div>
  )
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-(--space-24) gap-y-(--space-8) md:grid-cols-4">
      {children}
    </dl>
  )
}

function Faint({ children }: { children: ReactNode }) {
  return <p className="type-caption text-faint">{children}</p>
}

function Verdicts({ stage, guessed }: { stage: StageView; guessed: boolean }) {
  if (!stage.verdicts.length) {
    return <Faint>{stage.status === 'running' ? '진행 중이에요.' : '판정 기록 없음 · 통과'}</Faint>
  }
  return (
    <ul className="flex flex-col gap-(--space-8)">
      {stage.verdicts.map((verdict, index) => (
        <VerdictItem key={`${verdict.code}-${index}`} verdict={verdict} />
      ))}
      {guessed && (
        <li className="type-caption text-muted-soft">
          세부 단계 기록이 없어 단계별 초(stageSec)로 실패 단계를 추정했어요.
        </li>
      )}
    </ul>
  )
}

function VerdictItem({ verdict }: { verdict: StageVerdict }) {
  const fail = verdict.kind === 'fail'
  return (
    <li
      data-verdict={verdict.kind}
      className={cx(
        'rounded-12 border p-(--space-12)',
        fail ? 'border-status-danger' : 'border-accent',
      )}
    >
      <p className="type-caption flex flex-wrap gap-x-(--space-8) gap-y-(--space-2)">
        <span className={cx('font-medium', fail ? 'text-status-danger' : 'text-accent')}>
          {fail ? '실패 판정' : '기록 판정'}
        </span>
        <Mono className="text-ink-2">{verdict.code}</Mono>
        {verdict.check && <span className="text-ink">{verdict.check}</span>}
      </p>
      <p className="type-caption mt-(--space-4) break-words text-ink-2">{verdict.message}</p>
      {(verdict.measured || verdict.threshold) && (
        <dl className="mt-(--space-8) grid grid-cols-1 gap-x-(--space-24) gap-y-(--space-4) sm:grid-cols-2">
          <Field label="측정값">{verdict.measured ?? NOT_MEASURED}</Field>
          <Field label="기준값">{verdict.threshold ?? '-'}</Field>
        </dl>
      )}
    </li>
  )
}

const GPU_STAGES: readonly StageKey[] = ['sfm', 'lens', 'model', 'finalize']

/** 3D 단계에서 qualityReport가 통째로 없으면 "기록 없음(배포 전 작업)", 일부만 없으면 "미측정" */
function missingLabel(stage: StageKey, quality: QualityReport | null): string {
  return GPU_STAGES.includes(stage) && !quality ? NO_REPORT : NOT_MEASURED
}

function TimeBlock({ stage, quality }: { stage: StageView; quality: QualityReport | null }) {
  const own = stage.parts.filter((part) => !part.shared)
  const shared = stage.parts.filter((part) => part.shared)
  return (
    <div className="flex flex-col gap-(--space-12)">
      {stage.key === 'capture' && (
        <Faint>촬영은 작업이 생기기 전(웹)이라 구간 기록이 없어요. 영상 길이만 보여요.</Faint>
      )}
      {own.length === 0 ? (
        <Faint>단계 시간: {missingLabel(stage.key, quality)}</Faint>
      ) : (
        <ul className="flex flex-col gap-(--space-4)">
          {own.map((part, index) => (
            <li
              key={`${part.label}-${index}`}
              className="type-caption flex flex-wrap justify-between gap-(--space-8)"
            >
              <span className="text-ink-2">
                {part.label}
                {part.segment?.status && part.segment.status !== 'SUCCEEDED' && (
                  <span className="ml-(--space-4) text-status-danger">{part.segment.status}</span>
                )}
                <span className="ml-(--space-4) text-faint">
                  {part.source === 'stageSec'
                    ? '워커 단계 초'
                    : part.source === 'segment'
                      ? 'BE 구간'
                      : ''}
                </span>
              </span>
              <span className="pf-mono text-ink">
                {part.durationMs === null ? NOT_MEASURED : formatDuration(part.durationMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {shared.length > 0 && (
        <div className="flex flex-col gap-(--space-4)">
          {shared.map((part, index) => (
            <p key={index} className="type-caption flex flex-wrap justify-between gap-(--space-8)">
              <span className="text-muted-soft">
                {part.label}
                {part.segment?.status && part.segment.status !== 'SUCCEEDED' && (
                  <span className="ml-(--space-4) text-status-danger">{part.segment.status}</span>
                )}
              </span>
              <span className="pf-mono text-muted-soft">
                {part.durationMs === null ? NOT_MEASURED : formatDuration(part.durationMs)}
              </span>
            </p>
          ))}
          <Faint>③–⑤는 BE 구간이 하나(RECONSTRUCT)라 워커 단계 초로만 나눠요.</Faint>
        </div>
      )}
      {stage.key === 'model' && (
        <>
          <SecondsBars
            title="형상 모델 하위 단계(modelSec)"
            values={quality?.modelSec}
            note="병렬이라 합이 단계 시간보다 클 수 있어요"
          />
          <SecondsBars
            title="gnm_fit 구간(gnmFitSec)"
            values={quality?.gnmFitSec}
            note="ears는 귀 모양·위치 맞춤, 11/11부터"
          />
          <SecondsBars title="눈 부위 맞춤(eyePartsSec)" values={quality?.eyePartsSec} />
        </>
      )}
      {stage.key === 'finalize' && (
        <>
          <SecondsBars title="텍스처 베이크(bakeSec)" values={quality?.bakeSec} />
          <SecondsBars
            title="마무리 하위 단계(finalizeSec)"
            values={quality?.finalizeSec}
            note="성공 작업만, 11/08부터"
          />
        </>
      )}
    </div>
  )
}

/** diag(실패 진단)를 보일 단계: 실패한 3D 단계, 아니면 ⑤ */
function diagHost(view: JobStages): StageKey {
  return view.failed && GPU_STAGES.includes(view.failed) ? view.failed : 'model'
}

function Diagnostics({
  stage,
  view,
  detail,
}: {
  stage: StageView
  view: JobStages
  detail: AdminJobDetail
}) {
  const quality = view.quality
  const missing = missingLabel(stage.key, quality)
  const diag = quality?.diag
  const showDiag = Boolean(diag) && diagHost(view) === stage.key
  const value = (v: unknown, digits = 1, unit = '') =>
    v === undefined || v === null ? missing : formatNumber(v, digits, unit)
  const text = (v: unknown) => (typeof v === 'string' && v ? v : missing)

  const body = (() => {
    switch (stage.key) {
      case 'capture':
        return (
          <>
            <Fields>
              <Field label="영상 길이">
                {detail.input?.videoDurationMs != null
                  ? formatDuration(detail.input.videoDurationMs)
                  : NOT_MEASURED}
              </Field>
              <Field label="촬영 방법">{detail.input?.captureMethod ?? NOT_MEASURED}</Field>
              <Field label="기기">{detail.input?.deviceModel ?? NOT_MEASURED}</Field>
            </Fields>
            <Faint>
              고개 각도 기록(captureTrace)·영상 정보(videoMeta)는 관리자 API에 아직 없어요.
            </Faint>
          </>
        )
      case 'extract':
        return (
          <Fields>
            <Field label="묶음 프레임 수">{detail.input?.frameCount ?? NOT_MEASURED}</Field>
            <Field label="추출 시도">{detail.extractAttempts ?? NOT_MEASURED}</Field>
          </Fields>
        )
      case 'sfm':
        return (
          <Fields>
            <Field label="3D 준비 프레임">{value(quality?.frames, 0, '장')}</Field>
            <Field label="버린 프레임">
              {diag?.rejected ? keyValues(diag.rejected) : NOT_MEASURED}
            </Field>
            <Field label="얼굴 없이 남긴 프레임">
              {diag?.noFaceKept === undefined ? NOT_MEASURED : String(diag.noFaceKept)}
            </Field>
          </Fields>
        )
      case 'lens':
        return (
          <>
            <Fields>
              <Field label="등록 프레임">
                {typeof quality?.registered === 'number'
                  ? `${quality.registered}${typeof quality.frames === 'number' ? `/${quality.frames}장 (${Math.round((quality.registered / Math.max(1, quality.frames)) * 100)}%)` : '장'}`
                  : missing}
              </Field>
              <Field label="등록 기준">60% 이상</Field>
              <Field label="초점">{value(quality?.focalPx, 1, 'px')}</Field>
              <Field label="초점 출처">{text(quality?.focalSource)}</Field>
            </Fields>
            {diag?.lensTrials?.length ? (
              <TableScroll label="초점 후보 시도">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        초점(px)
                      </th>
                      <th scope="col" className={TH}>
                        SfM/MediaPipe 회전 비율
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        걸린 시간
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.lensTrials.map((trial, index) => (
                      <tr key={index}>
                        <td className={cx(TD, 'pf-mono')}>{formatNumber(trial.f)}</td>
                        <td className={cx(TD, 'pf-mono')}>{formatNumber(trial.slope, 2)}</td>
                        <td className={cx(TD, 'pf-mono text-right')}>
                          {formatNumber(trial.sec, 1, '초')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            ) : null}
          </>
        )
      case 'model': {
        const holdout = quality?.holdoutPctIod ?? diag?.holdoutPctIod
        const face = quality?.face
        const head = quality?.head
        const outside = new Set(head?.outOfRange ?? [])
        return (
          <>
            <Fields>
              <Field label="선택 후보">{text(quality?.chosen)}</Field>
              <Field label="전체 판정(overall)">{text(quality?.overall)}</Field>
              <Field label="카메라 위치 검사">{text(quality?.poseCheck ?? diag?.poseCheck)}</Field>
              <Field label="홀드아웃 오차(%IOD)">
                {holdout && Object.keys(holdout).length ? keyValues(holdout, 2) : missing}
              </Field>
              <Field label="홀드아웃 랜드마크">{value(face?.holdoutLm, 3, '%')}</Field>
              <Field label="홀드아웃 선">{value(face?.holdoutLine, 3, '%')}</Field>
              <Field label="눈꼬리 거리">{value(face?.holdoutSide, 3, '%')}</Field>
              <Field label="주름 p95">{value(face?.creaseP95, 3)}</Field>
            </Fields>
            {quality?.poseNote && <Faint>{quality.poseNote}</Faint>}
            <Fields>
              <Field label="두상 비율">
                {head?.ratios && Object.keys(head.ratios).length ? (
                  <span className="flex flex-col">
                    {Object.entries(head.ratios).map(([name, ratio]) => (
                      <span
                        key={name}
                        className={cx('pf-mono', outside.has(name) && 'text-status-danger')}
                      >
                        {name} {formatNumber(ratio, 3)}
                        {outside.has(name) && ' (범위 밖)'}
                      </span>
                    ))}
                  </span>
                ) : (
                  missing
                )}
              </Field>
              {diag?.viewCoverage && (
                <Field label="시점 범위(viewCoverage)">{keyValues(diag.viewCoverage)}</Field>
              )}
            </Fields>
          </>
        )
      }
      case 'finalize':
        return <FinalizeDiagnostics quality={quality} missing={missing} />
    }
  })()

  return (
    <div className="flex flex-col gap-(--space-12)">
      {body}
      {showDiag && diag && (
        <div className="flex flex-col gap-(--space-8)" role="group" aria-label="실패 진단(diag)">
          <p className="type-caption font-medium text-ink-2">실패 진단(diag)</p>
          <AngleChart diag={diag} />
          {stage.key !== 'model' && diag.viewCoverage && (
            <Fields>
              <Field label="시점 범위(viewCoverage)">{keyValues(diag.viewCoverage)}</Field>
            </Fields>
          )}
          {diag.notes?.length ? (
            <ul className="type-caption list-disc pl-(--space-16) text-ink-2">
              {diag.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

function FinalizeDiagnostics({
  quality,
  missing,
}: {
  quality: QualityReport | null
  missing: string
}) {
  const nose = quality?.noseCheck
  const views = quality?.captureViews
  return (
    <>
      <Fields>
        <Field label="코 편집 검사">
          {nose
            ? nose.eligible
              ? '통과'
              : `잠김 · ${nose.reason ?? '이유 없음'}`
            : quality
              ? '기록 없음(코 승인됐거나 검사 전)'
              : missing}
        </Field>
      </Fields>
      {nose?.tried?.length ? (
        <TableScroll label="코 편집 검사 시도">
          <table className={TABLE}>
            <thead>
              <tr>
                {['한계', '위치', '유효', '피부', '자기 교차', '영향 정점', '오류'].map((name) => (
                  <th key={name} scope="col" className={TH}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nose.tried.map((trial, index) => (
                <tr key={index}>
                  <td className={cx(TD, 'pf-mono')}>{show(trial.limit)}</td>
                  <td className={TD}>{show(trial.at)}</td>
                  <td className={TD}>{show(trial.valid)}</td>
                  <td className={TD}>{show(trial.skinValid)}</td>
                  <td className={cx(TD, 'pf-mono')}>{show(trial.selfIntersections)}</td>
                  <td className={cx(TD, 'pf-mono')}>{show(trial.affectedVertices)}</td>
                  <td className={TD}>{show(trial.error ?? trial.canonicalReason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : null}
      {views && Object.keys(views).length ? (
        <TableScroll label="5방향 사진 각도">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  방향
                </th>
                <th scope="col" className={TH}>
                  yaw
                </th>
                <th scope="col" className={TH}>
                  pitch
                </th>
                <th scope="col" className={TH}>
                  고른 방식
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(views).map(([angle, view]) => (
                <tr key={angle}>
                  <th scope="row" className={cx(TD, 'font-normal')}>
                    {angle}
                  </th>
                  <td className={cx(TD, 'pf-mono')}>{formatNumber(view?.yaw, 1, '°')}</td>
                  <td className={cx(TD, 'pf-mono')}>{formatNumber(view?.pitch, 1, '°')}</td>
                  <td className={TD}>{view?.by ?? NOT_MEASURED}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <Faint>5방향 사진 각도(captureViews): {missing}</Faint>
      )}
    </>
  )
}

function Artifacts({ stage, detail }: { stage: StageView; detail: AdminJobDetail }) {
  if (stage.key !== 'finalize') {
    return <Faint>산출물 기록 없음</Faint>
  }
  if (!detail.faceModelId) return <Faint>3D 모델: 없음</Faint>
  return (
    <p className="type-caption flex flex-wrap gap-x-(--space-8) text-ink-2">
      <span>3D 모델</span>
      <Mono className="break-all">{detail.faceModelId}</Mono>
      <Link
        href={ADMIN_PATHS.user(detail.userId)}
        className="text-accent underline underline-offset-2"
      >
        GLB·5방향 사진은 사용자 모델 화면에서
      </Link>
    </p>
  )
}

function show(value: unknown): string {
  if (value === undefined || value === null) return '-'
  if (typeof value === 'boolean') return value ? '예' : '아니오'
  return String(value)
}

function keyValues(record: Record<string, unknown>, digits = 1): string {
  return Object.entries(record)
    .map(([name, v]) =>
      typeof v === 'number' ? `${name} ${formatNumber(v, digits)}` : `${name} ${show(v)}`,
    )
    .join(' · ')
}
