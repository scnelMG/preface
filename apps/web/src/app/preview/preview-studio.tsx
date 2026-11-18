'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowCounterClockwiseIcon,
  ArrowsOutSimpleIcon,
  MouseSimpleIcon,
  ArrowsOutCardinalIcon,
  MagnifyingGlassPlusIcon,
  EyeIcon,
  ScissorsIcon,
  CaretLeftIcon,
  PlusIcon,
} from '@phosphor-icons/react'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import type { ViewRequest, ViewerStatus } from '@/features/viewer/types'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { PreviewLogin } from './preview-login'
import { DEFAULT_LIGHTING } from '@/features/viewer/lighting'
import { LightingControl } from './lighting-control'
import { PreviewNav } from './preview-nav'
import { PreviewTooltip } from './preview-tooltip'
import { useViewerFrame } from './use-viewer-frame'
import { useControlSheet } from './use-control-sheet'
import { useMemberNavigate } from '@/features/home/useMemberNavigate'
import { useLocalModels } from './workspace/use-local-models'
import {
  noseControlChanges,
  noseControls,
  SAMPLE_NOSE_CATALOG,
  type MorphValueChange,
} from '@/features/edit/noseControls'
import { SliderRow } from '@/shared/ui/SliderRow'

/** 편집실(Inspector)과 같은 묶음·순서. 값은 모델별 범위의 −100~100%로 보인다 */
const NOSE_GROUPS = ['콧대', '코끝', '콧볼'] as const

export function PreviewStudio({
  mode = 'experience',
  connected = false,
}: {
  mode?: 'experience' | 'editor'
  connected?: boolean
}) {
  const router = useRouter()
  const memberNavigate = useMemberNavigate()
  const params = useSearchParams()
  const memberPreview = mode === 'editor' || params.get('member') === '1'
  const workspaceModel = mode === 'editor' && params.get('source') === 'workspace'
  const [sampleIndex, setSampleIndex] = useState(() =>
    params.get('sample') === 'base-male' ? 0 : 1,
  )
  const [weights, setWeights] = useState<Record<string, number>>((): Record<string, number> =>
    params.get('variant') === 'tip' ? { 'nose.tip_projection': 0.35 } : {},
  )
  const [supported, setSupported] = useState<string[]>([])
  const [status, setStatus] = useState<ViewerStatus>('loading')
  const [view] = useState<ViewRequest>({ preset: 'threeQuarter', nonce: 0 })
  const [compare, setCompare] = useState(false)
  const [part, setPart] = useState<'nose' | 'eyes' | 'hair'>('nose')
  const [lighting, setLighting] = useState({ ...DEFAULT_LIGHTING })
  const localId = params.get('local')
  const { models: localAssets, loaded: localLoaded } = useLocalModels(!!localId)
  const localAsset = localAssets.find((item) => item.id === localId)
  const baseSample = SAMPLE_HEADS[sampleIndex]
  const sample = localAsset
    ? {
        ...baseSample,
        title: localAsset.title,
        shortTitle: localAsset.title,
        meshUrl: localAsset.meshUrl,
      }
    : baseSample
  const {
    slot: modelSlot,
    canvas: viewerBleed,
    frame: viewportFrame,
  } = useViewerFrame('.pp-workspace')

  const controls = noseControls(SAMPLE_NOSE_CATALOG, weights, status === 'ready' ? supported : null)
  const { sheetRef, open: sheetOpen, handleProps: sheetHandle } = useControlSheet()
  const applyChanges = (changes: readonly MorphValueChange[]) =>
    setWeights((current) => ({
      ...current,
      ...Object.fromEntries(changes.map(({ code, value }) => [code, value])),
    }))

  function selectSample(index: number) {
    setSampleIndex(index)
    setWeights({})
    setSupported([])
    setStatus('loading')
  }

  return (
    <div
      className={`preface-preview pp-studio-preview${mode === 'editor' ? ' pp-dedicated-editor' : ''}${connected ? ' pp-connected' : ''}`}
    >
      {!connected && <PreviewNav member={memberPreview} />}
      <section
        className={`pp-workspace${compare ? ' is-comparing' : ''}`}
        id="explore"
        aria-label="3D 얼굴 체험 스튜디오"
      >
        {mode === 'editor' ? (
          <div className="pf-editor-topline">
            <Link className="pf-back" href="/preview/workspace">
              <CaretLeftIcon size={14} />내 작업실
            </Link>
            <div className="pf-editor-identity">
              <h1>{params.get('name')?.trim() || sample.title}</h1>
              <span>
                {localAsset
                  ? '로컬 모델 · 저장되지 않아요'
                  : workspaceModel
                    ? '샘플 작업 · 저장되지 않아요'
                    : '기본 모델 체험'}
              </span>
            </div>
          </div>
        ) : (
          <div className="pp-intro">
            {/* 랜딩과 같은 한 번의 등장 연출(두 줄이 차례로 올라온다, service.css .pf-reveal-line) */}
            <h1 className="pp-service-heading">
              <span className="pf-reveal-line">
                <span>촬영한 내 얼굴을</span>
              </span>
              <span className="pf-reveal-line">
                <span>3D로.</span>
              </span>
            </h1>
            <button
              className="pp-text-action"
              onClick={() =>
                connected ? memberNavigate('/studio/new') : router.push('/preview/new')
              }
            >
              <span>나의 3D 얼굴 만들기</span>
              <span className="pp-create-icon" aria-hidden="true">
                <PlusIcon size={17} weight="light" />
              </span>
            </button>
          </div>
        )}
        <div className="pp-model" ref={modelSlot} aria-label={`${sample.title} 3D 뷰어`}>
          {compare && (
            <div className="pp-comparison-labels">
              <span>원본</span>
              <span>변경 후</span>
            </div>
          )}
          {/* 3D가 준비되기 전에는 같은 뷰어로 렌더한 정면 그림을 먼저 보여 준다(빈 무대 대신) */}
          {status === 'loading' && !localId && (
            <span className="pp-model-poster pf-scan" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={baseSample.thumbnailUrl} alt="" />
              <span className="pf-scan-line" />
            </span>
          )}
          <div className="pp-viewer-bleed" ref={viewerBleed}>
            {!localId || localAsset ? (
              <FaceViewer
                key={sample.key}
                meshUrl={sample.meshUrl}
                weights={weights}
                view={view}
                layout={compare ? 'side' : 'single'}
                showing="after"
                enablePan
                fitComparison
                lighting={lighting}
                viewportFrame={viewportFrame}
                comparisonOverflow
                onSupportedCodes={setSupported}
                onStatusChange={setStatus}
              />
            ) : (
              <p className="pp-local-model-status" role="status">
                {localLoaded
                  ? '이 로컬 모델을 불러올 수 없어요. 작업실에서 다시 선택하세요.'
                  : '로컬 모델을 불러오고 있어요.'}
              </p>
            )}
          </div>
        </div>
        <aside
          ref={sheetRef}
          id="pp-shape-controls"
          className="pp-controls pp-shape-controls"
          aria-label="형태 편집"
          data-sheet={sheetOpen ? 'open' : 'closed'}
        >
          {/* 모바일에서만 보이는 시트 손잡이. 누르거나 끌어서 펼치고 접는다 */}
          <button
            type="button"
            className="pp-sheet-handle"
            aria-controls="pp-shape-controls"
            aria-expanded={sheetOpen}
            aria-label={sheetOpen ? '조절 패널 접기' : '조절 패널 펼치기'}
            {...sheetHandle}
          >
            <span aria-hidden="true" />
          </button>
          <div className="pp-editor-toolbar">
            <div className="pp-part-selector" role="group" aria-label="편집 부위">
              <button aria-pressed={part === 'nose'} onClick={() => setPart('nose')}>
                코
              </button>
              <button aria-pressed={part === 'eyes'} onClick={() => setPart('eyes')}>
                눈 <span>예정</span>
              </button>
              <button aria-pressed={part === 'hair'} onClick={() => setPart('hair')}>
                헤어 <span>예정</span>
              </button>
            </div>
            {!workspaceModel && (
              <div className="pp-sample-picker" role="group" aria-label="기본 모델 선택">
                {SAMPLE_HEADS.map((item, index) => (
                  <button
                    key={item.key}
                    aria-pressed={sampleIndex === index}
                    onClick={() => selectSample(index)}
                  >
                    {item.shortTitle}
                  </button>
                ))}
              </div>
            )}
          </div>
          <section className="pp-shape-section" aria-label="코 조절" hidden={part !== 'nose'}>
            <h3>코</h3>
            <div className="pp-adjustments">
              {/* 묶음 제목·나눔선 없이 이름만으로 읽히는 네 줄(간격으로 묶는다, 2026-10-30 단순화) */}
              {NOSE_GROUPS.flatMap((name) =>
                controls.filter((control) => control.group === name),
              ).map((control) => (
                <SliderRow
                  key={control.id}
                  compact
                  className="pp-adjustment-row"
                  label={control.accessibleLabel}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={control.value}
                  minLabel={control.ends[0]}
                  maxLabel={control.ends[1]}
                  disabled={control.unavailable}
                  onChange={(value) => applyChanges(noseControlChanges(control, value))}
                />
              ))}
            </div>
          </section>
          {part !== 'nose' && (
            <section
              className="pp-upcoming-panel"
              aria-label={part === 'eyes' ? '눈 편집 준비 중' : '헤어 기능 준비 중'}
            >
              {part === 'eyes' ? (
                <EyeIcon size={32} weight="light" />
              ) : (
                <ScissorsIcon size={32} weight="light" />
              )}
              <h3>{part === 'eyes' ? '눈 형태 편집' : '헤어 템플릿'}</h3>
              <p>
                {part === 'eyes'
                  ? '눈의 형태를 조절하는 기능을 준비하고 있어요.'
                  : '얼굴에 헤어를 적용해 보는 기능을 준비하고 있어요.'}
              </p>
              <span>준비 중 · 아직 모델에 반영되지 않아요.</span>
            </section>
          )}
          <div className="pp-edit-actions">
            <button
              className="pp-compare"
              aria-pressed={compare}
              onClick={() => setCompare(!compare)}
            >
              <ArrowsOutSimpleIcon size={17} />
              {compare ? '하나로 보기' : '전후 비교'}
            </button>
            <PreviewTooltip label="형태 초기화">
              {(id) => (
                <button
                  className="pp-reset"
                  aria-describedby={id}
                  aria-label="형태 초기화"
                  disabled={Object.values(weights).every((value) => value === 0)}
                  onClick={() => setWeights({})}
                >
                  <ArrowCounterClockwiseIcon size={19} />
                </button>
              )}
            </PreviewTooltip>
          </div>
          <p className="pp-local-note" role="status">
            {status === 'loading'
              ? '모델을 불러오고 있어요.'
              : status === 'error'
                ? '모델을 불러오지 못했어요. 뷰어에서 다시 시도해 주세요.'
                : localAsset
                  ? '로컬 모델의 변경 내용은 저장되지 않아요.'
                  : '기본 모델의 변경 내용은 저장되지 않아요.'}
          </p>
        </aside>
        <div className="pp-viewer-footer">
          <div className="pp-viewer-meta">
            <div className="pp-model-caption">{localAsset ? localAsset.title : sample.title}</div>
            <LightingControl value={lighting} onChange={setLighting} />
          </div>
          <div className="pp-pointer-hints" aria-label="모델 조작 방법">
            <span>
              <MouseSimpleIcon size={15} />
              왼쪽 회전
            </span>
            <span>
              <ArrowsOutCardinalIcon size={15} />
              오른쪽 이동
            </span>
            <span>
              <MagnifyingGlassPlusIcon size={15} />
              스크롤 확대
            </span>
          </div>
          <p className="pp-touch-hint">드래그로 돌리고, 두 손가락으로 확대해요</p>
        </div>
      </section>
      {!connected && <PreviewLogin />}
    </div>
  )
}
