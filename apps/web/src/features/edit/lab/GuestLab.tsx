'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/features/auth/store'
import { labHref } from '@/features/studio/heads'
import {
  DEFAULT_SAMPLE_KEY,
  isSampleKey,
  sampleFromParam,
  type SampleHead,
} from '@/features/studio/samples'
import { GUEST_LAB_TUTORIAL_STEPS, type GuestLabStepId } from '@/features/tutorial/steps'
import { GUEST_LAB_TUTORIAL_STORAGE_KEY } from '@/features/tutorial/storage'
import { TutorialCard } from '@/features/tutorial/TutorialCard'
import { useStepTutorial } from '@/features/tutorial/useStepTutorial'
import { FaceStage } from '@/features/viewer/FaceStage'
import type { ViewerStatus } from '@/features/viewer/types'
import { useLoginPrompt } from '@/shared/state/loginPrompt'
import { Button } from '@/shared/ui'
import { diffWeights, pushHistory, sameWeights, viewerWeights } from '../editLogic'
import { EyePanel } from '../eyes/EyePanel'
import { feedbackToast } from '../feedbackToast'
import { isDefaultEyes, newEyeState, type EyeState } from '../eyes/state'
import { useLabEyes } from '../eyes/useLabEyes'
import { forgetEyeHistory } from '../eyes/useEyeEditor'
import { HairPanel } from '../hair/HairPanel'
import { useLabHair } from '../hair/useLabHair'
import { useEditStore } from '../store'
import { SAMPLE_CONTOUR_PART } from '../contourControls'
import { SAMPLE_NOSE_CATALOG } from '../noseControls'
import { createSyntheticGlbUrl } from '../syntheticMesh'
import { EMPTY_MORPH_STATE } from '../types'
import { useMorphParameters } from '../useMorphParameters'
import {
  editedFaceParts,
  SAMPLE_WEIGHT_SHAPE_ITEM,
  WEIGHT_SHAPE_CODE,
} from '../weightShapeControls'
import { Inspector, LoginNudge, ManualPanel, type InspectorMode } from './Inspector'
import { ConsultPanel } from './ConsultPanel'
import { clearHomeHandoff, readHomeHandoff, type HomeHandoff } from './homeHandoff'
import { LabShell, LabToolbar, ToolbarIconButton } from './LabShell'
import { useChangeSummary } from './useChangeSummary'
import { useSampleConsult } from './useSampleConsult'
import { verifySampleMesh } from './verifySampleMesh'

/**
 * 비로그인 체험 실험실(Figma P3-61 `실험실 · 체험 · 직접 조절(기본) · AI 상담 없음`).
 *
 * - 기본 모델 + 슬라이더(EDIT-01만 인증 없이). 조절값은 **브라우저에만** 두고 서버에 저장하지 않는다(FN-REC-04).
 * - 기본 모델은 `?sample=`(남성·여성)로 고른다. 없거나 모르는 값이면 남성 기본 모델이다.
 *   `useSearchParams()`를 읽으므로 라우트에서 `<Suspense>`로 감싼다.
 * - 되돌리기·처음으로(전체 초기화)는 브라우저 안 이력(50단계)으로 한다.
 * - 로그인 회원은 기본 모델에서 상담을 체험한다. 대화·변경은 브라우저에만 두고 시안은 저장하지 않는다.
 * - 메인 체험에서 기본 모델·조절값을 바꾸고 오면 그 상태로 연다(homeHandoff.ts, S15P31B204-746).
 *   `?sample=`이 있으면 그 모델이 먼저이고, 메인에서 고른 모델과 같을 때만 값을 이어 받는다.
 * - 처음 쓰는 기기에는 3D가 준비된 뒤 4단계 안내(둘러보기 → 부위 → 조절 → 되돌리기)가 뜬다(S15P31B204-746).
 * - 헤어(S15P31B204-770, `베타` 표시는 -838에서 뗐다)는 회원 편집실과 같은 헤어 카드로 기본 모델에 씌운다. 되돌리기 이력에 넣지 않고 메인에서 이어 받지도 않는다.
 */
export function GuestLab() {
  const param = useSearchParams()?.get('sample')
  // 메인에서 넘긴 값(sessionStorage)은 브라우저에서만 읽는다. 서버 렌더·하이드레이션 때는 그리지 않아 어긋나지 않는다
  const client = useSyncExternalStore(subscribeNothing, isClient, isServer)
  return client ? <GuestLabEntry param={param} /> : null
}

const subscribeNothing = () => () => {}
const isClient = () => true
const isServer = () => false

function GuestLabEntry({ param }: { param: string | null | undefined }) {
  // 들어올 때 한 번 읽고 지운다(한 번 쓰는 표). 다른 모델로 바꾸면 더는 쓰지 않는다
  const [handoff, setHandoff] = useState<HomeHandoff | null>(readHomeHandoff)
  useEffect(() => clearHomeHandoff(), [])
  const sample = sampleFromParam(
    isSampleKey(param) ? param : (handoff?.sample ?? DEFAULT_SAMPLE_KEY),
  )
  if (handoff && handoff.sample !== sample.key) setHandoff(null)
  const initialWeights = handoff?.sample === sample.key ? handoff.weights : undefined
  return <SampleLab key={sample.key} sample={sample} initialWeights={initialWeights} />
}

/** 안내 단계마다 테두리를 두르고 카드를 붙일 곳. 앞에서부터 찾는다(조절은 첫 조절 한 줄, 없으면 조절 영역) */
const TUTORIAL_TARGETS: Record<GuestLabStepId, readonly string[]> = {
  look: [],
  part: ['.pf-lab-inspector [data-part-rail]'],
  adjust: ['.pf-lab-inspector .cc-group-body > :first-child', '.pf-lab-inspector .pp-adjustments'],
  history: ['.pf-lab-toolbar [aria-label="되돌리기"]'],
}
function getTutorialTarget(id: GuestLabStepId) {
  for (const selector of TUTORIAL_TARGETS[id]) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found) return found
  }
  return null
}
const getTutorialStage = () => document.querySelector<HTMLElement>('.pf-lab-stage')
/** 누른 자리에서 이만큼(px) 움직여야 끌기로 본다(useLookGestures와 같다) */
const DRAG_THRESHOLD = 6

/**
 * 둘러보기 단계: 3D 무대를 끌거나 휠·두 손가락으로 확대하면 해 본 것으로 본다.
 * 무대 상자(`.pf-lab-stage > section`) 모양을 바꾸지 않으려고 감싸지 않고 캡처 단계 리스너를 붙인다(3D 조작을 막지 않는다).
 */
function useStageLook(active: boolean, onLook: () => void) {
  const latest = useRef(onLook)
  useEffect(() => {
    latest.current = onLook
  })
  useEffect(() => {
    if (!active) return
    const stage = getTutorialStage()
    if (!stage) return
    const pointers = new Map<number, { x: number; y: number }>()
    const down = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }
    const move = (event: PointerEvent) => {
      const start = pointers.get(event.pointerId)
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return
      latest.current()
    }
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
    }
    const wheel = () => latest.current()
    stage.addEventListener('pointerdown', down, true)
    stage.addEventListener('pointermove', move, true)
    stage.addEventListener('pointerup', up, true)
    stage.addEventListener('pointercancel', up, true)
    stage.addEventListener('wheel', wheel, { capture: true, passive: true })
    return () => {
      stage.removeEventListener('pointerdown', down, true)
      stage.removeEventListener('pointermove', move, true)
      stage.removeEventListener('pointerup', up, true)
      stage.removeEventListener('pointercancel', up, true)
      stage.removeEventListener('wheel', wheel, true)
    }
  }, [active])
}

function SampleLab({
  sample,
  initialWeights,
}: {
  sample: SampleHead
  /** 메인 체험에서 이어 받은 조절값(이미 검증됨). 없으면 처음 상태 */
  initialWeights?: Readonly<Record<string, number>>
}) {
  const [startWeights] = useState<Record<string, number>>(() => ({ ...initialWeights }))
  const member = useAuthStore((s) => s.status === 'member')
  const weights = useEditStore((s) => s.morphState.weights)
  const setWeight = useEditStore((s) => s.setWeight)
  const { catalog } = useMorphParameters('v2', {
    anonymous: true,
    fallback: true,
    fallbackCatalog: SAMPLE_NOSE_CATALOG,
  })
  const sampleCatalog = useMemo(
    () =>
      catalog && {
        ...catalog,
        parts: [
          ...catalog.parts.map((part) => ({
            ...part,
            items: [
              ...part.items.map((item) =>
                item.code.startsWith('nose.') ? { ...item, min: -1, max: 1 } : item,
              ),
              ...(part.part === 'CONTOUR' &&
              !part.items.some((item) => item.code === WEIGHT_SHAPE_CODE)
                ? [SAMPLE_WEIGHT_SHAPE_ITEM]
                : []),
            ],
          })),
          // 기본 모델 GLB에 윤곽 morph target을 구워 두었다. 서버 카탈로그에 아직 없으면 같은 항목을 붙인다
          ...(catalog.parts.some((part) => part.part === 'CONTOUR')
            ? []
            : [
                {
                  ...SAMPLE_CONTOUR_PART,
                  items: [...SAMPLE_CONTOUR_PART.items, SAMPLE_WEIGHT_SHAPE_ITEM],
                },
              ]),
        ],
      },
    [catalog],
  )
  const announce = useChangeSummary(sampleCatalog)

  // 헤어 선택은 화면 안에서만 들고 있고 되돌리기 이력에 넣지 않는다(회원 편집실과 같다)
  const hair = useLabHair()
  const [mode, setMode] = useState<InspectorMode>('manual')
  // 첫 부위는 탭 순서대로 눈(-748)
  const [part, setPart] = useState('EYE')
  type Snapshot = { weights: Record<string, number>; eyes: EyeState }
  const [history, setHistory] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const committed = useRef<Snapshot>({ weights: startWeights, eyes: newEyeState() })
  const pendingEyes = useRef<EyeState>(newEyeState())
  const onEyeAdjusted = useCallback((next: EyeState) => {
    committed.current = { ...committed.current, eyes: next }
    pendingEyes.current = next
    setFuture([])
  }, [])

  // 기본 모델 GLB를 못 받으면 합성 머리 주소를 여기에 둔다
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const meshUrl = fallbackUrl ?? sample.meshUrl
  const [renderCodes, setRenderCodes] = useState<Record<string, string[]>>({})
  const onSupportedCodes = useCallback(
    (codes: string[]) =>
      setRenderCodes((previous) =>
        previous[meshUrl]?.join('|') === codes.join('|')
          ? previous
          : { ...previous, [meshUrl]: codes },
      ),
    [meshUrl],
  )
  const syntheticUrl = useRef<string | null>(null)
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>('loading')
  const [verifiedMesh, setVerifiedMesh] = useState<string | null>(null)
  useEffect(() => {
    if (!member) return
    const controller = new AbortController()
    verifySampleMesh(sample, controller.signal)
      .then((valid) => setVerifiedMesh(valid ? sample.eyeReview.sha256 : null))
      .catch(() => {
        if (!controller.signal.aborted) setVerifiedMesh(null)
      })
    return () => controller.abort()
  }, [member, sample])
  // 기본 모델의 눈 판정(무쌍)은 manifest 해시에 묶여 있다(samples.ts). 이력·안전 한계도 같은 해시로 나눈다
  const eyes = useLabEyes({
    modelKey: `sample:${sample.key}:${sample.eyeReview.sha256}`,
    fileKey: sample.eyeReview.sha256,
    review: sample.eyeReview,
    active: part === 'EYE' || mode === 'consult',
    knownLimits: sample.eyeLimits,
    onAdjusted: onEyeAdjusted,
  })
  const effectiveMode = member ? mode : 'manual'
  const weightShapeActive = (weights[WEIGHT_SHAPE_CODE] ?? 0) !== 0
  const faceEdits = editedFaceParts(weights, !isDefaultEyes(eyes.editor.state))
  useEffect(
    () => () => forgetEyeHistory(`sample:${sample.key}:${sample.eyeReview.sha256}`),
    [sample.key, sample.eyeReview.sha256],
  )

  // 체험 상태는 이 화면에서만 산다. 들어올 때 비우고(메인에서 이어 받은 값이 있으면 그 값으로) 나갈 때도 비운다
  useEffect(() => {
    useEditStore.getState().open({
      simulationId: null,
      morphState: { ...EMPTY_MORPH_STATE, weights: { ...startWeights } },
      version: 0,
      canUndo: false,
      canRedo: false,
    })
    return () => {
      useEditStore.getState().reset()
      if (syntheticUrl.current) URL.revokeObjectURL(syntheticUrl.current)
    }
  }, [startWeights])

  // 기본 모델 GLB가 아직 저장소·CDN에 없으면 합성 머리로 대신 보인다
  const onStatusChange = useCallback((status: ViewerStatus) => {
    setViewerStatus(status)
    if (status !== 'error' || syntheticUrl.current) return
    createSyntheticGlbUrl()
      .then((url) => {
        syntheticUrl.current = url
        setFallbackUrl(url)
      })
      .catch(() => {})
  }, [])

  function setAll(next: Snapshot) {
    useEditStore.setState((s) => ({ morphState: { ...s.morphState, weights: next.weights } }))
    eyes.editor.replace(next.eyes)
    pendingEyes.current = next.eyes
    committed.current = next
  }

  function commit(nextEyes = eyes.editor.state) {
    const current = {
      weights: { ...useEditStore.getState().morphState.weights },
      eyes: nextEyes,
    }
    const previous = committed.current
    if (
      sameWeights(previous.weights, current.weights) &&
      JSON.stringify(previous.eyes) === JSON.stringify(current.eyes)
    )
      return
    setHistory((stack) => pushHistory(stack, previous))
    setFuture([])
    committed.current = current
    // 슬라이더 조절은 수치를 알리지 않는다. 체험은 슬라이더가 범위 끝에서 멈춰 한계 알림도 없다(S15P31B204-852)
  }

  function undo() {
    const previous = history.at(-1)
    if (!previous) return false
    setHistory((stack) => stack.slice(0, -1))
    const current = committed.current
    setFuture((stack) => [...stack, current].slice(-50))
    setAll(previous)
    announce(diffWeights(current.weights, previous.weights), 'undo')
    return true
  }

  function redo() {
    const next = future.at(-1)
    if (!next) return false
    setFuture((stack) => stack.slice(0, -1))
    setHistory((stack) => pushHistory(stack, committed.current))
    setAll(next)
    return true
  }

  function resetAll() {
    const before = {
      weights: { ...useEditStore.getState().morphState.weights },
      eyes: eyes.editor.state,
    }
    if (sameWeights(before.weights, {}) && isDefaultEyes(before.eyes)) return false
    setHistory((stack) => pushHistory(stack, before))
    setFuture([])
    setAll({ weights: {}, eyes: newEyeState() })
    feedbackToast('처음 상태로 돌렸어요', {
      action: {
        label: '되돌리기',
        onClick: () => {
          setHistory((stack) => stack.slice(0, -1))
          setAll(before)
        },
      },
    })
    return true
  }

  // 로그인하고 돌아와도 고른 기본 모델을 그대로 보인다
  const login = () => useLoginPrompt.getState().show({ returnTo: labHref(sample.key) })
  const changed = !sameWeights(weights, {}) || !isDefaultEyes(eyes.editor.state)
  const shownWeights = useMemo(() => viewerWeights(weights), [weights])

  // 첫 사용 안내는 3D와 조절 항목이 준비된 뒤에 띄운다(직접 조절 화면에서만)
  const tutorial = useStepTutorial(GUEST_LAB_TUTORIAL_STEPS, GUEST_LAB_TUTORIAL_STORAGE_KEY)
  const tutorialShown =
    tutorial.active &&
    viewerStatus === 'ready' &&
    renderCodes[meshUrl] !== undefined &&
    effectiveMode === 'manual'
  useStageLook(tutorialShown && tutorial.current.id === 'look', () => tutorial.signal('look'))
  const consult = useSampleConsult({
    sample,
    member,
    ready:
      viewerStatus === 'ready' &&
      meshUrl === sample.meshUrl &&
      verifiedMesh === sample.eyeReview.sha256,
    meshSha256: verifiedMesh,
    supportedCodes: renderCodes[meshUrl] ?? null,
    catalog: sampleCatalog,
    state: { weights, eyes: eyes.editor.state },
    review: sample.eyeReview,
    eyeLimits: eyes.limits,
    eyeReady: eyes.geometry.ready,
    onApply: (next) => {
      useEditStore.setState((s) => ({ morphState: { ...s.morphState, weights: next.weights } }))
      if (JSON.stringify(next.eyes) !== JSON.stringify(eyes.editor.state)) {
        pendingEyes.current = next.eyes
        eyes.editor.preview(next.eyes)
        eyes.editor.commit()
      }
      commit(next.eyes)
    },
    onUndo: undo,
    onRedo: redo,
    onReset: resetAll,
  })

  return (
    <>
      <LabShell
        expandSheet={effectiveMode === 'consult'}
        toolbar={
          <LabToolbar
            backHref="/studio"
            backLabel="모델 다시 선택"
            title={sample.title}
            status={`${sample.title} 체험 중`}
            actions={
              <>
                <ToolbarIconButton
                  icon="ArrowCounterClockwise"
                  label="되돌리기"
                  onClick={() => {
                    if (undo()) tutorial.signal('history')
                  }}
                  disabled={history.length === 0}
                />
                <ToolbarIconButton
                  icon="ClockCounterClockwise"
                  label="처음으로"
                  hint
                  onClick={() => {
                    if (resetAll()) tutorial.signal('history')
                  }}
                  disabled={!changed}
                />
                {/* 회원은 체험 결과를 저장할 수 없다(샘플은 시안을 만들지 않는다). 내 작업실 안내는
                  패널과 `모델 다시 선택`이 맡으므로 저장 버튼을 숨긴다 */}
                {/* 휴대폰 폭에서 제목이 잘리지 않게 보이는 글은 `저장`만, 이름은 전체(2026-10-31) */}
                {member ? null : (
                  <Button
                    variant="violet"
                    leadingIcon="FloppyDisk"
                    trailingIcon={null}
                    onClick={login}
                    aria-label="로그인하고 저장"
                    className="min-w-0! justify-center! gap-(--space-6) md:hidden"
                  >
                    저장
                  </Button>
                )}
              </>
            }
          />
        }
        stage={
          <FaceStage
            bleed="page"
            // 캔버스가 페이지 끝까지 번져도 휠 확대는 3D 무대 칸 안에서만 받는다. 칸 밖(조절 패널 옆 여백 등)은 페이지가 넘어간다(-788)
            zoomOnlyInStage
            meshUrl={meshUrl}
            weights={shownWeights}
            compare={false}
            onStatusChange={onStatusChange}
            onSupportedCodes={onSupportedCodes}
            eyeEdit={eyes.viewer}
            hairUrl={hair.hairUrl}
            onHairStatus={hair.onHairStatus}
          />
        }
        inspector={
          <Inspector
            modes={member ? ['manual', 'consult'] : ['manual']}
            mode={effectiveMode}
            onModeChange={setMode}
          >
            {effectiveMode === 'manual' ? (
              <>
                <ManualPanel
                  catalog={sampleCatalog}
                  supportedCodes={renderCodes[meshUrl] ?? null}
                  weightShapeAvailable={
                    !!renderCodes[meshUrl]?.includes(WEIGHT_SHAPE_CODE) &&
                    !!sampleCatalog?.parts.some((group) =>
                      group.items.some((item) => item.code === WEIGHT_SHAPE_CODE),
                    )
                  }
                  modeSwitch={
                    part === 'WEIGHT_SHAPE' && faceEdits
                      ? {
                          resetLabel: faceEdits,
                          onSwitch: () => {
                            resetAll()
                          },
                        }
                      : part !== 'WEIGHT_SHAPE' && weightShapeActive
                        ? {
                            resetLabel: '체중 변화',
                            onSwitch: () => {
                              setWeight(WEIGHT_SHAPE_CODE, 0)
                              commit()
                            },
                          }
                        : undefined
                  }
                  weights={weights}
                  part={part}
                  onPartChange={(next) => {
                    if (next !== part) tutorial.signal('part')
                    setPart(next)
                  }}
                  onPreview={setWeight}
                  onPreviewBatch={(changes) =>
                    useEditStore
                      .getState()
                      .setWeights(
                        Object.fromEntries(changes.map(({ code, value }) => [code, value])),
                      )
                  }
                  onCommit={() => {
                    commit()
                    tutorial.signal('adjust')
                  }}
                  hairPanel={
                    <HairPanel
                      value={hair.hairId}
                      onChange={(id) => {
                        hair.select(id)
                        tutorial.signal('adjust')
                      }}
                      loading={hair.loading}
                      disabled={viewerStatus === 'error'}
                    />
                  }
                  eyePanel={
                    <>
                      <EyePanel
                        state={eyes.editor.state}
                        selection={eyes.selection}
                        review={sample.eyeReview}
                        limits={eyes.limits}
                        onPreview={(next) => {
                          pendingEyes.current = next
                          eyes.editor.preview(next)
                        }}
                        onCommit={() => {
                          eyes.editor.commit()
                          commit(pendingEyes.current)
                          tutorial.signal('adjust')
                        }}
                        disabled={
                          viewerStatus !== 'ready' || !eyes.geometry.ready || weightShapeActive
                        }
                      />
                      {eyes.note ? (
                        <p className="type-caption text-muted-soft" role="status">
                          {eyes.note}
                        </p>
                      ) : null}
                    </>
                  }
                />
                {/* AI 상담 안내는 조절 아래 한 줄로(조작이 먼저, 2026-10-30) */}
                {!member ? <LoginNudge onLogin={login} /> : null}
              </>
            ) : (
              <ConsultPanel
                consult={consult}
                catalog={sampleCatalog}
                supportedSliderCodes={(renderCodes[meshUrl] ?? []).filter((code) =>
                  weightShapeActive
                    ? code === WEIGHT_SHAPE_CODE
                    : !faceEdits || code !== WEIGHT_SHAPE_CODE,
                )}
                eyeSliderAvailable={eyes.geometry.ready && !weightShapeActive}
                eyeLimits={eyes.limits}
                modeSwitch={{
                  revision: `${sample.key}:${JSON.stringify([weights, eyes.editor.state])}`,
                  toWeight:
                    faceEdits && renderCodes[meshUrl]?.includes(WEIGHT_SHAPE_CODE)
                      ? { clears: faceEdits, apply: resetAll }
                      : undefined,
                  toFace: weightShapeActive
                    ? {
                        clears: '체중 변화',
                        apply: () => {
                          setWeight(WEIGHT_SHAPE_CODE, 0)
                          commit()
                          return true
                        },
                      }
                    : undefined,
                }}
                onOpenSlider={(code) => {
                  setPart(
                    code.startsWith('eye.')
                      ? 'EYE'
                      : code === WEIGHT_SHAPE_CODE
                        ? 'WEIGHT_SHAPE'
                        : code.startsWith('contour.')
                          ? 'CONTOUR'
                          : 'NOSE',
                  )
                  setMode('manual')
                }}
              />
            )}
          </Inspector>
        }
      />
      {tutorialShown ? (
        <TutorialCard
          tutorial={tutorial}
          getTarget={getTutorialTarget}
          getStage={getTutorialStage}
          measureKey={part}
        />
      ) : null}
    </>
  )
}
