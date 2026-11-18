'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SurveyButton } from '@/features/survey/SurveyButton'
import { EDITOR_TUTORIAL_STEPS, type EditorStepId } from '@/features/tutorial/steps'
import { EDITOR_TUTORIAL_STORAGE_KEY } from '@/features/tutorial/storage'
import { TutorialCard } from '@/features/tutorial/TutorialCard'
import { useStepTutorial } from '@/features/tutorial/useStepTutorial'
import { CompareHoldButton, FaceStage } from '@/features/viewer/FaceStage'
import type { NosePreviewCheck, ViewerStatus, ViewRequest } from '@/features/viewer/types'
import { Button, Icon, toast } from '@/shared/ui'
import { EyePanel } from '../eyes/EyePanel'
import { matchesEyeReview, type EyeReviewEvidence } from '../eyes/review'
import { isDefaultEyes, newEyeState, TRIM_CONTROLS } from '../eyes/state'
import { contourControls } from '../contourControls'
import {
  confirmableChanges,
  countAdjusted,
  isLockedCode,
  revertedNoseMessage,
  viewerWeights,
} from '../editLogic'
import { noseControlChanges, noseControls, type MorphValueChange } from '../noseControls'
import { NOSE_POINT_EDIT_ENABLED } from '../pointEdit'
import { useEditStore } from '../store'
import { useMorphParameters } from '../useMorphParameters'
import { useSimulationEditor, type SaveStatus } from '../useSimulationEditor'
import { editedFaceParts, WEIGHT_SHAPE_CODE } from '../weightShapeControls'
import { ConsultPanel } from './ConsultPanel'
import type { FaceProfile, MeasureProfileTrial } from './faceProfile'
import { FrontPhotoView, useFrontPhoto } from './FrontPhoto'
import { Inspector, ManualPanel, type InspectorMode } from './Inspector'
import { HairPanel } from '../hair/HairPanel'
import { HAIR_ASSETS, HAIR_PROBE_ID, hairUrlOf } from '../hair/catalog'
import { useLabHair } from '../hair/useLabHair'
import { LabShell, LabToolbar, ToolbarIconButton, type TitleRename } from './LabShell'
import { ShareSheet } from '@/features/share/ShareSheet'
import { simulationHref, studioHref } from '@/features/studio/heads'
import {
  markSurveyAfterDone,
  shouldAskSurveyAfterDone,
  SurveyAfterDone,
} from '@/features/survey/SurveyAfterDone'
import { isDefaultTitle, TITLE_LIMIT_HINT, TITLE_MAX, validateTitle } from './simulationTitle'
import { useChangeSummary } from './useChangeSummary'
import { toastOnce } from './toastOnce'
import { useConsult } from './useConsult'
import { useModelTitle } from './useModelTitle'

const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '변경은 자동 저장돼요',
  saving: '저장하는 중',
  saved: '자동 저장됨',
  error: '저장하지 못했어요',
}
/** 바꾼 것이 없는 시안에서 공유(전송)를 누를 때 */
const NO_EDITS_TO_SHARE = '편집한 내용이 없어 전송할 수 없어요. 먼저 얼굴을 조절해 주세요.'
const NO_POINTS: { vertex: number; delta: [number, number, number] }[] = []
const DEFAULT_EYES = newEyeState()
/** 완료 뒤 작업실에서 보이는 알림(-844) */
const DONE_SAVED = '시안을 저장했어요'
/** 바꾼 것이 없는 시안은 작업실 `시안`에 남지 않는다(API-HIS-06 빈 시안 제외) */
const DONE_NO_EDITS = '바꾼 내용이 없어 시안에 남지 않았어요'
/** 완료 알림의 `이름 바꾸기`로 편집실에 돌아오면 제목을 입력칸으로 연다 */
const RENAME_PARAM = 'rename'

/**
 * 회원 실험실 = 내 모델 수정(Figma P3-63/64 상담 · P3-68 직접 조절). 첫 화면은 직접 조절(2026-10-30 사용자 결정, Figma P3-61의 상담 기본에서 바꿈).
 *
 * 편집은 모두 서버 시안에 바로 저장된다(FN-HIS-01·05). 다시 열면 EDIT-03·CON-02로 같은 가중치·대화·이력이 이어진다.
 *
 * 마치기(S15P31B204-844): 예전 `시안 저장`(Figma P3-91 이름 창)을 `완료`로 바꿨다. 편집은 이미 자동 저장되므로 완료는
 * 줄 선 저장이 끝나기를 기다린 뒤 작업실 `시안` 탭으로 보낸다(최근 수정 순이라 방금 고친 시안이 맨 앞). 이름은 도구 줄 제목에서만 고친다.
 * 이름이 자동으로 붙은 그대로면 알림에 `이름 바꾸기`를 붙여, 누르면 이 화면으로 돌아와 제목을 입력칸으로 연다(`?rename=1`).
 *
 * 처음 쓰는 기기에는 3D가 준비된 뒤 편집실에만 있는 기능(원본 보기·상담·완료)을 짚는 안내가 뜬다
 * (2026-11-03, steps.ts `EDITOR_TUTORIAL_STEPS`).
 */

/** 편집실 안내 단계마다 테두리를 두르고 카드를 붙일 곳 */
const TUTORIAL_TARGETS: Record<EditorStepId, string> = {
  compare: '[aria-label="누르고 있는 동안 원본 보기"]',
  consult: '[data-tutorial="modes"]',
  save: '[data-tutorial="done"]',
}
const getTutorialTarget = (id: EditorStepId) =>
  document.querySelector<HTMLElement>(TUTORIAL_TARGETS[id])
const getTutorialStage = () => document.querySelector<HTMLElement>('.pf-lab-stage')
export function SimulationLab({ simulationId }: { simulationId: string }) {
  const nosePreviewCheck = useRef<NosePreviewCheck | null>(null)
  const checkNosePreview = useCallback<NosePreviewCheck>(
    (weights) => nosePreviewCheck.current?.(weights) ?? true,
    [],
  )
  const editor = useSimulationEditor(simulationId, checkNosePreview)
  // 도구 줄: 제목(시안 이름)을 바로 고치고, 아래에 시안을 만든 모델 이름을 보인다(-812)
  const modelTitle = useModelTitle(editor.simulation?.faceModelId)
  const { rename } = editor
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // 완료 알림의 `이름 바꾸기`로 왔다(-844). 처음 한 번만 읽고, 새로고침해도 다시 열리지 않게 주소에서 지운다
  const [renameOnOpen] = useState(() => searchParams?.get(RENAME_PARAM) === '1')
  useEffect(() => {
    if (renameOnOpen) router.replace(pathname)
  }, [renameOnOpen, router, pathname])
  const titleRename = useMemo<TitleRename>(
    () => ({
      onSave: rename,
      validate: validateTitle,
      maxLength: TITLE_MAX,
      limitHint: TITLE_LIMIT_HINT,
      startEditing: renameOnOpen,
    }),
    [rename, renameOnOpen],
  )
  const weights = useEditStore((s) => s.morphState.weights)
  const editsPending = useEditStore((s) => s.isDirty)
  const pointStrokes = useEditStore((s) => s.morphState.pointStrokes ?? NO_POINTS)
  const eyeState = useEditStore((s) => s.morphState.eyeEdit ?? DEFAULT_EYES)
  const schemaVersion = useEditStore((s) => (s.simulationId ? s.morphState.schemaVersion : null))
  const canUndo = useEditStore((s) => s.canUndo)
  const canRedo = useEditStore((s) => s.canRedo)
  const stateVersion = useEditStore((s) => s.version)
  const { catalog, failed: catalogFailed } = useMorphParameters(schemaVersion)
  const approved = editor.simulation?.capabilities
  const editRanges = editor.simulation?.editRanges
  const approvedWeights = editRanges?.weights
  const weightShapeSupported = approvedWeights
    ? WEIGHT_SHAPE_CODE in approvedWeights
    : editor.simulation?.weightShapeSupported === true
  const weightShapeActive = (weights[WEIGHT_SHAPE_CODE] ?? 0) !== 0
  const eyeReview = editor.simulation?.eyeReview
  const eyeCapabilities = editor.simulation?.eyeCapabilities
  const eyeAssetKey = `${simulationId}:${editor.meshUrl ?? ''}`
  const [assetEye, setAssetEye] = useState<{ key: string; evidence: EyeReviewEvidence } | null>(
    null,
  )
  const onEyeReview = useCallback(
    (evidence: EyeReviewEvidence) => setAssetEye({ key: eyeAssetKey, evidence }),
    [eyeAssetKey],
  )
  const eyeSupport =
    eyeReview &&
    eyeCapabilities &&
    !editor.meshFailed &&
    matchesEyeReview(assetEye, eyeAssetKey, eyeReview, editor.simulation?.eyePartsSha256)
      ? {
          review: eyeReview,
          limits: editRanges
            ? Object.fromEntries(
                Object.entries(editRanges.eyes).map(([key, range]) => [key, range.max]),
              )
            : eyeCapabilities.limits,
        }
      : null
  const eyeAvailable = !!eyeSupport
  // 서버 판정이 없거나, 3D를 못 읽었거나, 3D의 눈 판정이 서버와 다르면 이 모델은 눈을 조절할 수 없다
  const eyeUnsupported =
    !!editor.simulation &&
    (!eyeReview ||
      !eyeCapabilities ||
      editor.meshFailed ||
      (assetEye?.key === eyeAssetKey && !eyeAvailable))
  // 서버는 눈을 열었는데 3D의 눈 판정을 아직 읽지 못했다
  const eyeLoading = !!editor.simulation && !eyeUnsupported && !eyeAvailable
  const [eyeGeometry, setEyeGeometry] = useState({ key: '', ready: false, message: '' })
  const eyeReady = eyeGeometry.key === eyeAssetKey && eyeGeometry.ready
  const onEyeStatus = useCallback(
    (next: { ready: boolean; message: string }) => {
      setEyeGeometry((previous) =>
        previous.key === eyeAssetKey &&
        previous.ready === next.ready &&
        previous.message === next.message
          ? previous
          : { key: eyeAssetKey, ready: next.ready, message: next.message },
      )
    },
    [eyeAssetKey],
  )
  const approvedBounds = approvedWeights ?? approved?.supported
  const boundedCatalog = useMemo(
    () =>
      !catalog || !approvedBounds
        ? catalog
        : {
            ...catalog,
            parts: catalog.parts.map((group) => ({
              ...group,
              items: group.items.map((item) => {
                const bounds = approvedBounds[item.code]
                return bounds
                  ? {
                      ...item,
                      min: Math.max(item.min, bounds.min),
                      max: Math.min(item.max, bounds.max),
                    }
                  : item
              }),
            })),
          },
    [catalog, approvedBounds],
  )

  const [chosenMode, setMode] = useState<InspectorMode>('manual')
  const [suggested, setSuggested] = useState<{
    version: number
    assetKey: string
    changes: readonly MorphValueChange[]
  } | null>(null)
  const [selectedControl, setSelectedControl] = useState<{
    simulationId: string
    code: string
    label: string
  } | null>(null)
  const selectControl = (code: string, label: string) =>
    setSelectedControl((current) =>
      current?.simulationId === simulationId && current.code === code && current.label === label
        ? current
        : { simulationId, code, label },
    )
  // 원본 보기(도구 줄 버튼을 누르고 있는 동안)
  const [holdingOriginal, setHoldingOriginal] = useState(false)
  // 촬영한 내 정면 사진(-599). 사진이 있으면 방식 탭에 `원본 사진`을 더한다(S15P31B204-770). 처음에는 직접 조절이라
  // 갑자기 내 얼굴 사진이 크게 뜨지 않는다. 사진 주소를 잃으면(만료 뒤 재발급 실패 등) 직접 조절로 돌아간다
  const frontPhoto = useFrontPhoto(editor.simulation?.faceModelId)
  const mode: InspectorMode = chosenMode === 'photo' && !frontPhoto ? 'manual' : chosenMode
  const inspectorModes: InspectorMode[] = frontPhoto
    ? ['manual', 'consult', 'photo']
    : ['manual', 'consult']
  // 첫 부위는 눈(탭 순서와 같다, -748). 고르기 전에는 눈을 보이다가, 이 모델이 눈 조절을 못 한다고 확인되면 코를 보인다
  const [chosenPart, setPart] = useState<string | null>(null)
  const part = chosenPart ?? (eyeUnsupported ? 'NOSE' : 'EYE')
  const hair = useLabHair()
  const [focusCode, setFocusCode] = useState<string | null>(null)
  const [recommendedCode, setRecommendedCode] = useState<string | null>(null)
  // 완료를 눌러 줄 선 저장을 기다리는 중(또는 설문 창을 띄운 채 떠나기 직전). 두 번 누르지 않게 버튼을 끈다
  const [finishing, setFinishing] = useState(false)
  const [surveyOpen, setSurveyOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [unsupportedCodes, setUnsupportedCodes] = useState<string[]>([])
  const hasSavedNoseEdit =
    pointStrokes.length > 0 ||
    Object.entries(weights).some(([code, value]) => code.startsWith('nose.') && value !== 0)
  const rigUrl = approved !== null || hasSavedNoseEdit ? editor.rigUrl : null
  const assetKey = `${editor.meshUrl ?? ''}|${rigUrl ?? ''}`
  const measureEyes = Boolean(eyeSupport)
  const profileKey = useMemo(
    () => ({ simulationId, assetKey, stateVersion, weights, pointStrokes, eyeState, measureEyes }),
    [simulationId, assetKey, stateVersion, weights, pointStrokes, eyeState, measureEyes],
  )
  const [profile, setProfile] = useState<{
    key: typeof profileKey
    data: FaceProfile | null
    original: FaceProfile | null
    measureTrial?: MeasureProfileTrial
  } | null>(null)
  const onFaceProfile = useCallback(
    (data: FaceProfile | null, original: FaceProfile | null, measureTrial?: MeasureProfileTrial) =>
      setProfile({ key: profileKey, data, original, measureTrial }),
    [profileKey],
  )
  const appliedProfile =
    !editor.meshFailed && !editsPending && profile?.key === profileKey ? profile : null
  const [blockedNosePreview, setBlockedNosePreview] = useState<string | null>(null)
  const onNosePreviewCheck = useCallback((check: NosePreviewCheck | null) => {
    nosePreviewCheck.current = check
  }, [])
  const previewChanges = (changes: readonly MorphValueChange[]) => {
    setSuggested(null)
    if (changes.some(({ code }) => code.startsWith('nose.'))) {
      const candidate = { ...useEditStore.getState().morphState.weights }
      for (const { code, value } of changes) candidate[code] = value
      if (!checkNosePreview(candidate)) {
        setBlockedNosePreview(assetKey)
        return false
      }
      setBlockedNosePreview(null)
    }
    editor.previewChanges(changes)
    return true
  }
  const [renderCodes, setRenderCodes] = useState<Record<string, string[]>>({})
  const supportedCodes = useMemo(() => {
    if (editor.meshFailed) return []
    const rendered = renderCodes[assetKey] ?? null
    if (!rendered) return null
    if (approvedWeights) return rendered.filter((code) => code in approvedWeights)
    if (approved === undefined)
      return rendered.filter((code) => code !== WEIGHT_SHAPE_CODE || weightShapeSupported)
    // 코는 모델별 승인 범위가 있는 코드만. 윤곽은 코 승인과 별개로 GLB에 morph target 쌍이 있으면(rendered에 있음) 연다
    return rendered.filter(
      (code) =>
        (code.startsWith('contour.') && (code !== WEIGHT_SHAPE_CODE || weightShapeSupported)) ||
        (!!approved && code in approved.supported),
    )
  }, [approved, approvedWeights, renderCodes, assetKey, editor.meshFailed, weightShapeSupported])
  const modelLoading =
    !editor.meshFailed && (supportedCodes === null || (!catalog && !catalogFailed))
  const onSupportedCodes = useCallback(
    (codes: string[]) =>
      setRenderCodes((previous) =>
        previous[assetKey]?.join('|') === codes.join('|')
          ? previous
          : { ...previous, [assetKey]: codes },
      ),
    [assetKey],
  )

  const weightShapeAvailable =
    weightShapeSupported &&
    !!supportedCodes?.includes(WEIGHT_SHAPE_CODE) &&
    !!boundedCatalog?.parts.some((group) =>
      group.items.some((item) => item.code === WEIGHT_SHAPE_CODE),
    )
  const faceEdits = editedFaceParts(weights, !isDefaultEyes(eyeState), pointStrokes.length > 0)
  const waitingForOtherMode = editor.savingGroup === (part === 'WEIGHT_SHAPE' ? 'face' : 'weight')
  const suggestion =
    mode === 'manual' &&
    !editsPending &&
    !modelLoading &&
    !editor.meshFailed &&
    !editor.previewBlocked &&
    !editor.savingGroup &&
    suggested?.version === stateVersion &&
    suggested.assetKey === assetKey
      ? suggested
      : null
  const manualWeights = useMemo(
    () =>
      suggestion
        ? {
            ...weights,
            ...Object.fromEntries(suggestion.changes.map(({ code, value }) => [code, value])),
          }
        : weights,
    [weights, suggestion],
  )
  const shownWeights = useMemo(() => viewerWeights(manualWeights), [manualWeights])
  const handleControls = useMemo(
    () =>
      boundedCatalog &&
      approved &&
      !modelLoading &&
      !editor.meshFailed &&
      unsupportedCodes.length === 0
        ? noseControls(boundedCatalog, weights, supportedCodes)
        : [],
    [
      boundedCatalog,
      approved,
      modelLoading,
      editor.meshFailed,
      unsupportedCodes.length,
      weights,
      supportedCodes,
    ],
  )

  const openSlider = useCallback(
    (code: string, recommended = false) => {
      setSuggested(null)
      setRecommendedCode(recommended ? code : null)
      if (code.startsWith('eye.') && eyeAvailable && eyeReady) {
        setPart('EYE')
        setMode('manual')
        setFocusCode(code)
        return
      }
      if (isLockedCode(code)) return
      setPart(
        code === WEIGHT_SHAPE_CODE
          ? 'WEIGHT_SHAPE'
          : code.startsWith('contour.')
            ? 'CONTOUR'
            : 'NOSE',
      )
      setMode('manual')
      setFocusCode(code)
    },
    [eyeAvailable, eyeReady],
  )

  // 알림의 %는 슬라이더와 같은 범위(모델별 승인 범위)로 읽는다
  const announce = useChangeSummary(boundedCatalog)
  const { undo: undoEdit, redo: redoEdit, reset: resetEdit } = editor
  const undo = useCallback(
    () => undoEdit().then((changes) => announce(changes, 'undo')),
    [undoEdit, announce],
  )
  const redo = useCallback(
    () => redoEdit().then((changes) => announce(changes, 'redo')),
    [redoEdit, announce],
  )
  // 슬라이더 조절은 수치(`…로 바꿨어요`)를 알리지 않고 안전 범위(한계)에 걸렸을 때만 알린다(S15P31B204-852).
  // 코가 아닌 항목은 화면이 아는 범위로 잘렸으면 손을 뗀 순간 바로 알린다(-839). 코는 서버 검사기가 더 줄이거나 막을 수 있어
  // 응답 뒤 서버가 줄였을 때만 알린다. 응답 문구가 먼저 띄운 것과 같으면 다시 띄우지 않는다. 실패하면 저장 쪽(handleError)이 오류 알림을 띄우고, 더 새 편집이 있으면 commit이 null이라
  // 알리지 않는다(-727). 슬라이더는 응답의 저장값으로 옮겨진다(applyEditResult)
  // 코 검사기가 저장을 거절해 서버 값으로 다시 읽으면 일반 오류 대신 원래 값으로 돌린 항목을 알린다
  const describeRevert = useCallback(
    (codes: string[], errorCode: string) =>
      revertedNoseMessage(
        boundedCatalog,
        codes,
        errorCode,
        useEditStore.getState().morphState.weights,
      ),
    [boundedCatalog],
  )
  const { commit: commitEdit } = editor
  const commitAndAnnounce = useCallback(() => {
    let shown: string | null = null
    void commitEdit(
      (changes) => {
        const confirmed = confirmableChanges(boundedCatalog, changes)
        if (confirmed) shown = announce(confirmed)
      },
      false,
      describeRevert,
    ).then((changes) => {
      if (changes) announce(changes, 'change', shown)
    })
  }, [commitEdit, announce, boundedCatalog, describeRevert])
  const consult = useConsult(simulationId, editor, { onOpenSlider: openSlider })
  // 비교에서 직접 조절로 넘어가도 카메라에 기본 각도를 다시 요청하지 않는다.
  const [comparisonView, setComparisonView] = useState<ViewRequest>()
  const [comparisonDisplay, setComparisonDisplay] = useState<{
    requestId: string
    mode: 'original' | 'current'
  } | null>(null)
  const comparison =
    mode === 'consult' && consult.comparison?.result.stateVersion === stateVersion
      ? consult.comparison
      : null
  const displayedMode =
    comparison?.requestId === comparisonDisplay?.requestId ? comparisonDisplay?.mode : undefined
  const comparisonMorph = displayedMode === 'current' ? undefined : comparison?.result.morphState

  const { onMeshError } = editor
  const [viewerReady, setViewerReady] = useState(false)
  const [hairFitStatus, setHairFitStatus] = useState<{ mesh: string | null; ready: boolean }>()
  const onHairFitStatus = useCallback(
    (status: 'ready' | 'error') => {
      const ready = status === 'ready'
      setHairFitStatus((previous) =>
        previous && previous.mesh === editor.meshUrl && previous.ready === ready
          ? previous
          : { mesh: editor.meshUrl, ready },
      )
    },
    [editor.meshUrl],
  )
  const { onHairStatus } = hair
  const onHairPreviewStatus = useCallback(
    (status: 'ready' | 'error') => {
      onHairFitStatus(status)
      onHairStatus(status)
    },
    [onHairFitStatus, onHairStatus],
  )
  const onStatusChange = useCallback(
    (status: ViewerStatus) => {
      if (status === 'error') onMeshError()
      if (status === 'ready') setViewerReady(true)
    },
    [onMeshError],
  )

  // 안내는 3D와 조절 항목이 준비된 뒤에 띄운다
  const tutorialReady =
    viewerReady &&
    !!editor.simulation &&
    !editor.meshFailed &&
    supportedCodes !== null &&
    unsupportedCodes.length === 0
  const tutorial = useStepTutorial(EDITOR_TUTORIAL_STEPS, EDITOR_TUTORIAL_STORAGE_KEY)
  const onUnsupportedCodes = useCallback((codes: string[]) => {
    setUnsupportedCodes((previous) => (previous.join('|') === codes.join('|') ? previous : codes))
  }, [])

  const checkingReadiness =
    !!editor.simulation?.editRanges &&
    viewerReady &&
    !modelLoading &&
    !editor.meshFailed &&
    (!eyeSupport || eyeGeometry.key === eyeAssetKey)
  const noseReady =
    !!approved &&
    !!boundedCatalog &&
    noseControls(boundedCatalog, {}, supportedCodes).every(({ unavailable }) => !unavailable)
  const contourReady =
    !!boundedCatalog &&
    contourControls(boundedCatalog, {}, supportedCodes).every(({ unavailable }) => !unavailable)
  const allEyesReady =
    eyeReady &&
    !!eyeSupport &&
    TRIM_CONTROLS.every((code) => (eyeSupport.limits[code] ?? 0) > 0) &&
    (!Object.values(eyeSupport.review).includes('absent') ||
      ['inline', 'inout', 'outline'].every(
        (style) => (eyeSupport.limits[`${style}:height`] ?? 0) > 0,
      ))
  const hairFit = hairFitStatus?.mesh === editor.meshUrl ? hairFitStatus : undefined
  const missingEdits = [
    !allEyesReady && '눈',
    !noseReady && '코',
    !contourReady && '윤곽',
    !weightShapeAvailable && '체중 변화',
    hairFit?.ready === false && '헤어',
    !consult.loading && (!consult.historyReady || !noseReady) && '상담',
  ].filter(Boolean)
  const probeHairUrl =
    checkingReadiness &&
    allEyesReady &&
    noseReady &&
    contourReady &&
    weightShapeAvailable &&
    !hairFit
      ? (hairUrlOf(HAIR_PROBE_ID) ?? HAIR_ASSETS[0]?.url)
      : undefined

  if (editor.loadState === 'notFound' || editor.loadState === 'failed') {
    return (
      <div className="mx-auto flex max-w-page flex-col items-start gap-(--space-16) px-(--space-20) py-(--space-40) md:px-(--space-40)">
        <h1 className="type-kr-title-22-medium-ls-1-lh28p6">
          {editor.loadState === 'notFound' ? '시안을 찾을 수 없어요' : '시안을 불러오지 못했어요'}
        </h1>
        <p className="type-kr-body-12-regular-lh22p2 text-text-body">
          {editor.loadState === 'notFound'
            ? '지워졌거나 열 수 없는 시안이에요. 작업실에서 다시 골라 주세요.'
            : '잠시 후 다시 시도해 주세요.'}
        </p>
        <Button variant="ink" href="/studio">
          내 작업실로
        </Button>
      </div>
    )
  }

  const simulation = editor.simulation

  /**
   * 작업실 `시안` 탭으로 간다. 알림은 토스트 자리가 화면 밖(body)에 있어 이동한 뒤에도 남는다.
   * 이름이 자동으로 붙은 그대로면 `이름 바꾸기`로 이 화면에 돌아와 제목을 입력칸으로 연다
   */
  const leaveToRecords = (done: { hasChanges: boolean; title: string }) => {
    if (!done.hasChanges) toast(DONE_NO_EDITS)
    else if (isDefaultTitle(done.title))
      toast(DONE_SAVED, {
        duration: 6000,
        action: {
          label: '이름 바꾸기',
          onClick: () => router.push(`${simulationHref(simulationId)}?${RENAME_PARAM}=1`),
        },
      })
    else toast(DONE_SAVED)
    router.push(studioHref({ tab: 'records' }))
  }

  /** 완료: 줄 선 저장을 다 보낸 뒤 떠난다. 저장이 실패하면 머문다(실패 알림은 편집 알림이 띄운다) */
  const finish = async () => {
    if (!simulation || finishing) return
    tutorial.signal('save')
    setFinishing(true)
    const done = await editor.flush()
    if (!done) {
      setFinishing(false)
      return
    }
    // 1차 배포 설문(-434 → -844): 처음 완료할 때 한 번만, 고친 것이 있을 때 권한다. 창을 닫거나 참여하면 떠난다
    if (done.hasChanges && shouldAskSurveyAfterDone()) {
      markSurveyAfterDone()
      setSurveyOpen(true)
      return
    }
    leaveToRecords(done)
  }

  const readinessNotice = simulation?.editApprovalPending
    ? '눈·코의 조절 범위를 다시 확인하고 있어요.'
    : checkingReadiness && missingEdits.length > 0
      ? `${missingEdits.join('·')} 조절이 아직 준비되지 않았어요.`
      : null

  return (
    <>
      <LabShell
        toolbar={
          <LabToolbar
            backHref="/studio"
            backLabel="내 작업실"
            title={simulation?.title ?? '시안을 불러오는 중'}
            subtitle={modelTitle}
            rename={simulation ? titleRename : undefined}
            // 1차 배포 설문(-428): 도구 줄이 아니라 제목 옆(2026-10-31). 2차 배포 때 이 줄과 features/survey를 지운다
            titleAside={<SurveyButton />}
            status={SAVE_STATUS_LABEL[editor.saveStatus]}
            actions={
              <>
                <ToolbarIconButton
                  icon="ArrowCounterClockwise"
                  label="되돌리기"
                  onClick={undo}
                  // 처음으로가 끝나기 전에는 되돌리기·앞으로 가기를 끈다(화면은 이미 원본이라 무엇을 되돌릴지 헷갈린다).
                  // 처음으로를 되돌리려면 알림의 `되돌리기`를 쓴다. 처음으로가 끝난 뒤에 보낸다
                  disabled={!canUndo || editor.resetting}
                />
                <ToolbarIconButton
                  icon="ArrowCounterClockwise"
                  label="앞으로 가기"
                  onClick={redo}
                  disabled={!canRedo || editor.resetting}
                  mirrored
                />
                {/* 원본 비교(2026-10-31): 처음으로 자리에. 되돌리기·앞으로 가기 옆에서 '바꾸기 전'을 바로 본다.
                    처음으로는 조절 패널 위쪽 글자 버튼으로 옮겼다(자주 누르지 않고, 누르면 되돌리기 어려운 행동) */}
                <CompareHoldButton
                  active={holdingOriginal}
                  disabled={!simulation || editor.meshFailed}
                  onHoldChange={(holding) => {
                    setHoldingOriginal(holding)
                    if (holding) tutorial.signal('compare')
                  }}
                />
                {/* 시안 공유(S15P31B204-575): 빈 시안 판정·목록은 시트 안에서 한다 */}
                <ToolbarIconButton
                  icon="PaperPlaneTilt"
                  label="시안 공유"
                  onClick={() => {
                    // 바꾼 것이 없는 시안은 링크를 만들 수 없다(SHR_002). 시트를 열지 않고 이유를 바로 알린다(-748)
                    if (simulation && !simulation.hasChanges) toastOnce(NO_EDITS_TO_SHARE)
                    else setShareOpen(true)
                  }}
                  disabled={!simulation}
                />
                {/* 완료(S15P31B204-844, 예전 `시안 저장`): 도구 줄의 유일한 주 행동이라 글자 있는 잉크 알약. 편집은 이미
                    자동 저장되므로 저장이 끝나기를 기다렸다 작업실 `시안`으로 간다. 기다리는 동안은 `저장하는 중`으로 끈다.
                    좁은 화면은 잉크 원 아이콘만(-838 크기 그대로). 3D를 못 불러와도 떠날 수 있게 시안만 있으면 켠다 */}
                <button
                  type="button"
                  data-tutorial="done"
                  onClick={() => void finish()}
                  disabled={!simulation || finishing}
                  aria-busy={finishing || undefined}
                  className="ml-(--space-4) inline-flex h-9 shrink-0 items-center gap-(--space-6) rounded-full bg-ink px-(--space-14) text-[13px] font-semibold whitespace-nowrap text-on-ink transition-[background-color,transform,opacity] duration-(--pf-dur-ui) hover:bg-ink/85 enabled:active:scale-[0.96] disabled:opacity-25 max-md:w-9 max-md:justify-center max-md:px-0"
                >
                  <Icon name="Check" size={16} />
                  <span className="max-md:sr-only">{finishing ? '저장하는 중' : '완료'}</span>
                </button>
              </>
            }
          />
        }
        stage={
          editor.meshFailed ? (
            <div className="flex size-full flex-col items-center justify-center gap-(--space-12) bg-bg-stone p-(--space-24) text-center">
              <p className="type-kr-body-13-medium-lh16p9">3D를 불러오지 못했어요</p>
              <p className="type-kr-caption-11-regular-lh20p9 text-text-body">
                잠시 후 새로고침해 주세요. 조절값은 그대로 저장돼 있어요.
              </p>
            </div>
          ) : editor.meshUrl ? (
            <div className="relative size-full">
              <FaceStage
                bleed="page"
                // 캔버스가 페이지 끝까지 번져도 휠 확대는 3D 무대 칸 안에서만 받는다. 칸 밖(조절 패널 옆 여백 등)은 페이지가 넘어간다(-788)
                zoomOnlyInStage
                holding={holdingOriginal || displayedMode === 'original'}
                comparisonView={comparisonView}
                meshUrl={editor.meshUrl}
                rigUrl={rigUrl}
                expressionRigUrl={editor.expressionUrl}
                weights={comparisonMorph ? viewerWeights(comparisonMorph.weights) : shownWeights}
                onStatusChange={onStatusChange}
                onUnsupportedCodes={onUnsupportedCodes}
                onSupportedCodes={onSupportedCodes}
                onNosePreviewCheck={onNosePreviewCheck}
                onEyeReview={onEyeReview}
                onFaceProfile={onFaceProfile}
                pauseFaceProfile={editsPending || Boolean(comparisonMorph || suggestion)}
                pointStrokes={comparisonMorph?.pointStrokes ?? pointStrokes}
                eyeEdit={
                  eyeSupport
                    ? {
                        state: comparisonMorph?.eyeEdit ?? eyeState,
                        review: eyeSupport.review,
                        onStatus: comparison ? undefined : onEyeStatus,
                      }
                    : undefined
                }
                noseHandleControls={handleControls}
                hairUrl={hair.hairUrl}
                onHairStatus={onHairPreviewStatus}
                hairProbe={
                  probeHairUrl ? { url: probeHairUrl, onStatus: onHairFitStatus } : undefined
                }
                // 코 구조 조절은 스위치로 끈다(-552). 연결을 넘기지 않으면 FaceStage가 버튼을 그리지 않는다
                onNoseHandlePreview={
                  NOSE_POINT_EDIT_ENABLED &&
                  !weightShapeActive &&
                  part !== 'WEIGHT_SHAPE' &&
                  editor.savingGroup !== 'weight' &&
                  !editor.previewBlocked &&
                  handleControls.length > 0
                    ? (changes) => {
                        const values = changes.flatMap(({ id, value }) => {
                          const control = handleControls.find((item) => item.id === id)
                          return control ? noseControlChanges(control, value) : []
                        })
                        if (values.length > 0) previewChanges(values)
                      }
                    : undefined
                }
                onNoseHandleCommit={
                  NOSE_POINT_EDIT_ENABLED &&
                  !weightShapeActive &&
                  part !== 'WEIGHT_SHAPE' &&
                  editor.savingGroup !== 'weight' &&
                  !editor.previewBlocked &&
                  handleControls.length > 0
                    ? commitAndAnnounce
                    : undefined
                }
              />
              {unsupportedCodes.length > 0 ? (
                <div
                  role="alert"
                  className="absolute inset-0 flex items-center justify-center bg-bg-stone p-(--space-24) text-center"
                >
                  <p className="type-kr-body-13-medium-lh16p9">
                    이 모델에서 저장된 편집을 정확히 표시할 수 없어요. 얼굴 변경을 확인할 수
                    없습니다.
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="size-full animate-pulse bg-bg-stone" aria-busy="true" />
          )
        }
        // 휴대폰에서는 상담 입력창과 원본 사진을 시트가 펼쳐진 상태에서 보여 준다.
        expandSheet={mode === 'consult' || mode === 'photo'}
        inspector={
          <Inspector
            modes={inspectorModes}
            mode={mode}
            onModeChange={(next) => {
              setSuggested(null)
              setRecommendedCode(null)
              setMode(next)
              if (next === 'consult') tutorial.signal('consult')
            }}
            aside={
              // 처음으로: 보이는 변화(코)가 없으면 끈다. 막은 눈 값만 남은 시안에서 눌러도 화면이 바뀌지 않는다
              <button
                type="button"
                onClick={() => void resetEdit(undo)}
                disabled={
                  !simulation ||
                  editor.resetting ||
                  (countAdjusted(weights) === 0 &&
                    pointStrokes.length === 0 &&
                    (!eyeAvailable || isDefaultEyes(eyeState)))
                }
                className="type-label inline-flex min-h-9 items-center gap-(--space-4) rounded-full px-(--space-10) text-muted-soft transition-colors duration-(--pf-dur-ui) hover:bg-ink/5 hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
              >
                <Icon name="ClockCounterClockwise" size={15} />
                처음으로
              </button>
            }
          >
            {readinessNotice ? (
              // 카드 위 `직접 조절 | 상담` 줄 바로 밑은 스크롤 끝 흐림(service.css mask)이 덮어 글이 잘려 보였다(-748).
              // 부위 탭처럼 16px 띄우고, 상담 대화가 길어져도 줄지 않게 둔다
              <div
                data-lab-notices
                className="flex shrink-0 flex-col gap-(--space-8) pt-(--space-16)"
              >
                <p className="type-caption text-muted-soft" role="status">
                  {readinessNotice}
                </p>
              </div>
            ) : null}
            {mode === 'photo' && frontPhoto ? <FrontPhotoView url={frontPhoto} /> : null}
            {mode === 'consult' ? (
              <>
                <ConsultPanel
                  key={simulationId}
                  consult={consult}
                  faceRatioAvailable={Boolean(editor.simulation?.faceModelId)}
                  faceModelId={editor.simulation?.faceModelId ?? undefined}
                  savedWeights={editsPending ? undefined : weights}
                  hasAppliedEyelids={eyeState.L.enabled || eyeState.R.enabled}
                  frontPhoto={frontPhoto}
                  faceProfile={appliedProfile?.data}
                  measureTrial={appliedProfile?.measureTrial ?? null}
                  originalFaceProfile={appliedProfile?.original}
                  faceProfileState={
                    editor.meshFailed ? 'unavailable' : !appliedProfile ? 'loading' : undefined
                  }
                  onComparisonView={
                    editor.meshUrl && !editor.meshFailed
                      ? (next) => {
                          if (next === 'front' || next === 'side') {
                            setComparisonView((current) => ({
                              preset: next,
                              nonce: (current?.nonce ?? 0) + 1,
                            }))
                          } else {
                            setComparisonDisplay(
                              comparison && next !== 'proposal'
                                ? { requestId: comparison.requestId, mode: next }
                                : null,
                            )
                          }
                        }
                      : undefined
                  }
                  directControl={
                    selectedControl?.simulationId === simulationId
                      ? { code: selectedControl.code, label: selectedControl.label, stateVersion }
                      : undefined
                  }
                  onClearDirectControl={() => setSelectedControl(null)}
                  catalog={boundedCatalog}
                  supported={approved?.supported}
                  eyeSliderAvailable={eyeAvailable && eyeReady && !weightShapeActive}
                  eyeLimits={eyeSupport?.limits}
                  eyeState={eyeState}
                  modeSwitch={{
                    stateVersion,
                    revision: `${simulationId}:${stateVersion}:${JSON.stringify([weights, eyeState, pointStrokes])}`,
                    ...(!modelLoading &&
                    !editor.meshFailed &&
                    !editor.previewBlocked &&
                    !editor.savingGroup
                      ? {
                          toWeight:
                            weightShapeAvailable && faceEdits
                              ? {
                                  clears: weightShapeActive ? `${faceEdits}·체중 변화` : faceEdits,
                                  apply: async () => !!(await resetEdit(undo)),
                                }
                              : undefined,
                          toFace: weightShapeActive
                            ? {
                                clears: '체중 변화',
                                apply: async () => !!(await editor.clearWeightShape()),
                              }
                            : undefined,
                        }
                      : {}),
                  }}
                  supportedSliderCodes={
                    !editor.meshFailed && unsupportedCodes.length === 0
                      ? (supportedCodes?.filter((code) =>
                          weightShapeActive
                            ? code === WEIGHT_SHAPE_CODE
                            : !faceEdits || code !== WEIGHT_SHAPE_CODE,
                        ) ?? [])
                      : []
                  }
                  onOpenSlider={(code, recommendation) => {
                    openSlider(code, Boolean(recommendation))
                    const preview = recommendation?.preview
                    if (!preview || !appliedProfile || waitingForOtherMode || weightShapeActive)
                      return
                    setSuggested({
                      version: stateVersion,
                      assetKey,
                      changes: preview.changes,
                    })
                  }}
                />
              </>
            ) : null}
            {suggestion ? (
              <div className="type-caption mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline pb-2 text-ink">
                <p className="basis-full" role="status">
                  추천 조절을 미리 보고 있어요.
                </p>
                <button
                  type="button"
                  className="min-h-9 font-medium underline"
                  onClick={() => {
                    if (previewChanges(suggestion.changes)) {
                      void commitEdit(undefined, true, describeRevert).then((changes) => {
                        if (changes?.length) announce(changes)
                      })
                    }
                  }}
                >
                  적용하기
                </button>
                <button
                  type="button"
                  className="min-h-9 text-ink-2 underline"
                  onClick={() => setSuggested(null)}
                >
                  취소
                </button>
              </div>
            ) : null}
            {!suggestion && mode === 'manual' && editor.saveStatus !== 'idle' ? (
              <p role="status" className="type-caption mb-2 text-ink-2 md:hidden">
                {editor.saveStatus === 'saving'
                  ? '저장 중…'
                  : editor.saveStatus === 'saved'
                    ? '시안에 저장했어요.'
                    : '시안에 저장하지 못했어요.'}
              </p>
            ) : null}
            {mode === 'manual' ? (
              <ManualPanel
                catalog={boundedCatalog}
                supportedCodes={supportedCodes}
                modelLoading={modelLoading}
                eyeLoading={eyeLoading}
                weightShapeAvailable={weightShapeAvailable}
                modeSwitch={
                  part === 'WEIGHT_SHAPE' && weightShapeAvailable && faceEdits
                    ? {
                        resetLabel: weightShapeActive ? `${faceEdits}·체중 변화` : faceEdits,
                        onSwitch: () => void resetEdit(undo),
                      }
                    : part !== 'WEIGHT_SHAPE' && part !== 'HAIR' && weightShapeActive
                      ? {
                          resetLabel: '체중 변화',
                          onSwitch: () => void editor.clearWeightShape(),
                        }
                      : undefined
                }
                weights={manualWeights}
                part={part}
                onPartChange={(next) => {
                  setSuggested(null)
                  setRecommendedCode(null)
                  setPart(next)
                }}
                onSelectControl={selectControl}
                onPreview={(code, value) => previewChanges([{ code, value }])}
                onPreviewBatch={(changes) => {
                  if (!modelLoading) previewChanges(changes)
                }}
                onCommit={() => {
                  if (!modelLoading) commitAndAnnounce()
                }}
                disabled={
                  modelLoading ||
                  !simulation ||
                  editor.meshFailed ||
                  unsupportedCodes.length > 0 ||
                  editor.previewBlocked ||
                  waitingForOtherMode
                }
                hairPanel={
                  <HairPanel
                    value={hair.hairId}
                    onChange={hair.select}
                    loading={hair.loading}
                    disabled={editor.meshFailed}
                  />
                }
                eyePanel={
                  eyeSupport ? (
                    <>
                      <EyePanel
                        state={eyeState}
                        selection="both"
                        review={eyeSupport.review}
                        limits={eyeSupport.limits}
                        onPreview={(next) => {
                          setSuggested(null)
                          editor.previewEyes(next)
                        }}
                        onSelectControl={selectControl}
                        recommendedCode={recommendedCode}
                        onCommit={() => void editor.commitEyes()}
                        disabled={!eyeReady || editor.previewBlocked || waitingForOtherMode}
                      />
                      {!eyeReady && eyeGeometry.key === eyeAssetKey && eyeGeometry.message ? (
                        <p className="type-caption text-muted-soft" role="status">
                          {eyeGeometry.message}
                        </p>
                      ) : null}
                    </>
                  ) : undefined
                }
                focusCode={focusCode}
                recommendedCode={recommendedCode}
                error={
                  part === 'NOSE' && approved === null ? (
                    <p className="type-kr-caption-11-regular-lh14p3 text-text-muted">
                      이 3D는 코 편집 검사를 준비 중이에요. 얼굴은 바뀌지 않아요.
                    </p>
                  ) : part === 'NOSE' && blockedNosePreview === assetKey ? (
                    <p className="type-caption text-muted-soft" role="status">
                      여기까지 조절할 수 있어요. 안전한 마지막 값이 표시돼요.
                    </p>
                  ) : catalogFailed ? (
                    <p className="type-kr-caption-11-regular-lh14p3 text-status-danger">
                      조절 항목을 불러오지 못했어요. 새로고침해 주세요.
                    </p>
                  ) : waitingForOtherMode && !faceEdits && !weightShapeActive ? (
                    <p className="type-caption text-muted-soft" role="status">
                      이전 조절을 저장하는 중이에요. 저장이 끝나면 이 모드를 조절할 수 있어요.
                    </p>
                  ) : null
                }
              />
            ) : null}
          </Inspector>
        }
      />
      {shareOpen && simulation ? (
        <ShareSheet
          open
          onClose={() => setShareOpen(false)}
          simulationId={simulation.simulationId}
          hasChanges={simulation.hasChanges}
          // 저장 전 얼굴이 스냅숏으로 공유되지 않게 저장이 끝날 때까지 기다린다(S15P31B204-842)
          saving={editsPending || editor.saveStatus === 'saving'}
          hairId={hair.hairUrl ? hair.hairId : null}
        />
      ) : null}
      {surveyOpen && simulation ? (
        <SurveyAfterDone
          open
          onClose={() => {
            setSurveyOpen(false)
            leaveToRecords(simulation)
          }}
        />
      ) : null}
      {tutorialReady && tutorial.active ? (
        <TutorialCard
          tutorial={tutorial}
          getTarget={getTutorialTarget}
          getStage={getTutorialStage}
          measureKey={mode}
        />
      ) : null}
    </>
  )
}
