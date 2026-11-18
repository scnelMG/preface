'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { useControlSheet } from '@/app/preview/use-control-sheet'
import { useViewerFrame } from '@/app/preview/use-viewer-frame'
import { ControlRail } from '@/features/edit/controls/ControlRail'
import { ContourIcon } from '@/features/edit/controls/ContourIcon'
import { NoseControlGroups } from '@/features/edit/controls/NoseControlGroups'
import {
  CONTOUR_GROUPS,
  contourControls,
  SAMPLE_CONTOUR_PART,
} from '@/features/edit/contourControls'
import { EyePanel } from '@/features/edit/eyes/EyePanel'
import { isDefaultEyes, newEyeState, type EyeState } from '@/features/edit/eyes/state'
import { useLabEyes } from '@/features/edit/eyes/useLabEyes'
import { writeHomeHandoff } from '@/features/edit/lab/homeHandoff'
import { HAIR_NONE } from '@/features/edit/hair/catalog'
import { HairPanel } from '@/features/edit/hair/HairPanel'
import { useLabHair } from '@/features/edit/hair/useLabHair'
import { EditModeSwitch } from '@/features/edit/lab/Inspector'
import {
  noseControls,
  SAMPLE_NOSE_CATALOG,
  type MorphValueChange,
} from '@/features/edit/noseControls'
import {
  editedFaceParts,
  SAMPLE_WEIGHT_SHAPE_ITEM,
  WEIGHT_SHAPE_CODE,
  weightShapeControls,
  weightShapeSliderValue,
  weightShapeStrengthLabel,
} from '@/features/edit/weightShapeControls'
import { SAMPLE_HEADS } from '@/features/studio/samples'
import { LookChips } from '@/features/tutorial/LookChips'
import { TutorialCard } from '@/features/tutorial/TutorialCard'
import { useLookGestures, useMainTutorial } from '@/features/tutorial/useMainTutorial'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import { SIMULATION_NOTICE, ViewerHints } from '@/features/viewer/ViewerHints'
import { DEFAULT_LIGHTING } from '@/features/viewer/lighting'
import type { ViewRequest, ViewerStatus } from '@/features/viewer/types'
import { cx, Icon, LightSphere, Segmented, Tooltip } from '@/shared/ui'
import {
  mainDesktopFrame,
  TRIAL_DESKTOP_QUERY,
  TRIAL_PHONE_QUERY,
  trialViewportFrame,
} from './trialFraming'
import { useMemberNavigate } from './useMemberNavigate'
import { useTrialOverlay } from './useTrialOverlay'

/**
 * 메인(`/`) 체험 무대 — 디자인 시스템 v4(shared/design/system.css) 위에서 다시 지은 화면(2026-10-30).
 *
 * - 데스크톱(≥1024): 왼쪽 글·행동 / 가운데 3D / 오른쪽 글래스 조절 패널. 3D는 화면 전체로 번져 그린다(확장 캔버스).
 * - 태블릿(768~1023): 글이 위 한 줄, 아래에 3D와 조절 패널을 나란히.
 * - 모바일(<768): 글 → 3D 미리 보기(만질 수 없음, 페이지 스크롤만). `체험하기`를 누르면 전체 화면으로 열려
 *   3D 조작과 아래 글래스 시트(접힘 = 첫 조절까지, 끌어서 펼침)가 살아난다. 뒤로 가기·`홈으로`가 닫는다(-526).
 * - 기본 모델은 체험용이라 바꾼 값은 저장하지 않는다. "내 3D 얼굴 만들기"는 회원이면 /studio/new, 아니면 로그인 창.
 * - 처음 쓰는 기기에는 모델이 준비된 뒤 4단계 튜토리얼 카드가 뜬다(REQ-F-09, 2026-11-02). 1단계는 무대 아래,
 *   나머지는 가리키는 조절 옆(TutorialCard).
 *   모바일은 미리 보기에서 3D를 만질 수 없어 `체험하기`로 연 전체 화면에서만 뜬다.
 *   미리 보기에서는 카드를 숨겨 두지 않고 아예 띄우지 않는다. 전체 화면을 열면 처음 단계부터 뜬다(S15P31B204-746).
 * - 헤어(S15P31B204-770, `베타` 표시는 -838에서 뗐다): 회원 편집실과 같은 헤어 카드(HairPanel)로 기본 모델에 헤어를 씌운다. 되돌리기 이력에 넣지 않고,
 *   체험 실험실(`/lab`)로 넘기지도 않는다(homeHandoff는 모델·조절값만).
 * - 휠 확대는 머리가 보이는 사각형 안에서만 받는다(S15P31B204-770). 캔버스가 화면 전체로 번져 있어, 빈 무대에서 굴리면
 *   페이지가 넘어가야 한다(FaceViewer `zoomOnlyOverModel`).
 */

/** 튜토리얼 단계마다 테두리를 두를 곳. 앞에서부터 찾는다(조절하기는 첫 조절 한 줄, 헤어 탭이면 헤어 카드 묶음) */
const TUTORIAL_TARGETS: Record<string, readonly string[]> = {
  look: ['[data-tutorial="light"]'],
  part: ['[data-tutorial="parts"]'],
  adjust: ['#pf-main-controls .cc-group-body > :first-child'],
  history: ['[data-tutorial="history"]'],
}

type Part = 'nose' | 'eyes' | 'contour' | 'weight' | 'hair'
type Weights = Record<string, number>
type WeightHistory = { weights: Weights; eyes?: EyeState }
const SAMPLE_HOME_CATALOG = {
  ...SAMPLE_NOSE_CATALOG,
  parts: [
    ...SAMPLE_NOSE_CATALOG.parts,
    {
      ...SAMPLE_CONTOUR_PART,
      items: [...SAMPLE_CONTOUR_PART.items, SAMPLE_WEIGHT_SHAPE_ITEM],
    },
  ],
}
/**
 * 메인 무대에서 당길 수 있는 거리. 얼굴이 무대 밖으로 넘치거나 너무 작아지지 않는 범위.
 * `min`은 처음 거리(6.2)의 약 1/3이라 약 3배까지 확대된다. 눈 슬라이더 변화가 잘 보이게 3 → 2로 줄였다.
 */
const MAIN_ZOOM = { min: 2, max: 9 }

function subscribePhone(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(TRIAL_PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const readPhone = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(TRIAL_PHONE_QUERY).matches
/** 휴대폰 폭(<768)인지. 서버 렌더에서는 넓은 화면으로 본다 */
function usePhoneLayout() {
  return useSyncExternalStore(subscribePhone, readPhone, () => false)
}
/**
 * 처음 보이는 기본 모델(남성, SAMPLE_HEADS[0]). 다른 화면에 다녀와도 이 모델로 돌아온다(S15P31B204-840)
 */
const INITIAL_SAMPLE_INDEX = 0
/** 처음 열리는 부위 탭. 다른 화면에 다녀와도 이 탭으로 돌아온다(S15P31B204-848) */
const INITIAL_PART: Part = 'nose'

export function MainStudio() {
  const memberNavigate = useMemberNavigate()
  const [sampleIndex, setSampleIndex] = useState(INITIAL_SAMPLE_INDEX)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const [supported, setSupported] = useState<string[]>([])
  const [status, setStatus] = useState<ViewerStatus>('loading')
  // 뷰어는 모델마다 새로 뜬다(key). 모델이 바뀌면 지원 항목·준비 상태를 처음부터 다시 받는다.
  // 고르기 버튼과 다른 화면에 다녀온 뒤의 되돌림(-840) 두 길 모두 여기서 맞춘다
  // 다른 화면에 다녀오면 같은 남성 모델이어도 뷰어를 새로 띄워 카메라(돌린 각도·확대)를 처음 구도로 돌린다(-848)
  const [visit, setVisit] = useState(0)
  const viewerKey = `${SAMPLE_HEADS[sampleIndex].key}:${visit}`
  const [mountedViewer, setMountedViewer] = useState(viewerKey)
  if (mountedViewer !== viewerKey) {
    setMountedViewer(viewerKey)
    setSupported([])
    setStatus('loading')
  }
  const [view] = useState<ViewRequest>({ preset: 'threeQuarter', nonce: 0 })
  const [part, setPart] = useState<Part>(INITIAL_PART)
  const [lighting, setLighting] = useState({ ...DEFAULT_LIGHTING })
  const sample = SAMPLE_HEADS[sampleIndex]
  // 헤어는 화면 안에서만 들고 있다. 기본 모델을 바꿔도 같은 헤어를 새 모델에 씌운다
  const hair = useLabHair()
  const trial = useTrialOverlay()
  // 휴대폰 전체 화면 체험은 얼굴을 화면 크기에 맞춰 크게 그리고, 시트를 여닫아도 크기를 바꾸지 않는다(-526).
  // 데스크톱은 무대를 키운 만큼 얼굴도 같은 비율로 키운다(-840)
  const { slot, canvas, frame } = useViewerFrame('.pf-main', (measured, size, area) =>
    window.matchMedia(TRIAL_PHONE_QUERY).matches
      ? trial.open
        ? trialViewportFrame(measured, size)
        : measured
      : window.matchMedia(TRIAL_DESKTOP_QUERY).matches
        ? mainDesktopFrame(measured, area)
        : measured,
  )
  const section = useRef<HTMLElement>(null)
  const tutorial = useMainTutorial()
  // 휴대폰 미리 보기(체험을 열기 전)에는 안내를 아예 띄우지 않는다. 숨긴 채 띄워 두면 미리 보기 위에서 페이지를 넘기는
  // 손가락이 1단계 조작으로 몰래 체크되고, 전체 화면을 열 때 카드가 처음부터 나타나지 않는다(S15P31B204-746)
  const phone = usePhoneLayout()
  const tutorialShown = tutorial.active && status === 'ready' && (trial.open || !phone)
  const lookGestures = useLookGestures((...gestures) => {
    if (tutorialShown) tutorial.markLook(...gestures)
  })
  const getTutorialTarget = useCallback((id: string) => {
    for (const selector of TUTORIAL_TARGETS[id]) {
      const found = section.current?.querySelector<HTMLElement>(selector)
      if (found) return found
    }
    return null
  }, [])
  const getTutorialStage = useCallback(
    () => section.current?.querySelector<HTMLElement>('.pf-main-stage') ?? null,
    [],
  )
  const {
    sheetRef,
    open: sheetOpen,
    setOpen: setSheetOpen,
    handleProps: sheetHandle,
  } = useControlSheet({
    // 접힘 = 지금 부위의 첫 조절까지(코는 첫 슬라이더, 눈은 쌍꺼풀 모양 고르기)
    peekSelector: '.cc-group-body > :first-child',
    stageSelector: '.pf-main-stage',
    mobileQuery: TRIAL_PHONE_QUERY,
  })

  // 되돌리기·다시 하기: 슬라이더를 잡는 순간의 값을 한 단계로 쌓는다(끄는 동안의 값마다 쌓지 않는다)
  const [past, setPast] = useState<WeightHistory[]>([])
  const [future, setFuture] = useState<WeightHistory[]>([])
  const [weightResetForEyes, setWeightResetForEyes] = useState(false)
  const gestureStart = useRef<Weights | null>(null)

  // 기본 모델의 눈 판정(무쌍)은 manifest 해시에 묶여 있다(samples.ts). 이력·안전 한계도 같은 해시로 나눈다
  const eyes = useLabEyes({
    modelKey: `sample:${sample.key}:${sample.eyeReview.sha256}`,
    fileKey: sample.eyeReview.sha256,
    review: sample.eyeReview,
    active: part === 'eyes',
    knownLimits: sample.eyeLimits,
  })
  const eyeTab = part === 'eyes'
  const weightActive = (weights[WEIGHT_SHAPE_CODE] ?? 0) !== 0
  const faceEdits = editedFaceParts(weights, !isDefaultEyes(eyes.editor.state))
  const available = status === 'ready' ? supported : null
  const controls =
    part === 'contour'
      ? contourControls(SAMPLE_HOME_CATALOG, weights, available)
      : part === 'weight'
        ? weightShapeControls(SAMPLE_HOME_CATALOG, weights, available)
        : noseControls(SAMPLE_NOSE_CATALOG, weights, available)
  const changed = Object.values(weights).some((value) => value !== 0)

  // 고른 기본 모델·조절값을 체험 실험실(`/lab`)로 이어 준다(S15P31B204-746). 손대지 않았으면 지워서 실험실이 처음 상태로 열린다
  const touched = changed || sampleIndex !== INITIAL_SAMPLE_INDEX
  useEffect(() => {
    writeHomeHandoff(touched ? { sample: sample.key, weights } : null)
  }, [touched, sample.key, weights])

  const applyChanges = (changes: readonly MorphValueChange[]) => {
    if (part === 'weight' ? faceEdits : weightActive) return
    tutorial.signal('adjust')
    if (gestureStart.current) {
      const start = gestureStart.current
      gestureStart.current = null
      setPast((stack) => [...stack, { weights: start }])
      setFuture([])
    }
    setWeights((current) => ({
      ...current,
      ...Object.fromEntries(changes.map(({ code, value }) => [code, value])),
    }))
  }
  const markGesture = () => {
    gestureStart.current = weights
  }
  function undo() {
    const previous = past.at(-1)
    if (!previous) return
    const previousEyes =
      previous.eyes ?? (previous.weights[WEIGHT_SHAPE_CODE] ? newEyeState() : undefined)
    setPast((stack) => stack.slice(0, -1))
    setFuture((stack) => [{ weights, eyes: previousEyes && eyes.editor.state }, ...stack])
    setWeights(previous.weights)
    if (previousEyes) eyes.editor.replace(previousEyes)
  }
  function redo() {
    const next = future[0]
    if (!next) return
    const nextEyes = next.eyes ?? (next.weights[WEIGHT_SHAPE_CODE] ? newEyeState() : undefined)
    setFuture((stack) => stack.slice(1))
    setPast((stack) => [...stack, { weights, eyes: nextEyes && eyes.editor.state }])
    setWeights(next.weights)
    if (nextEyes) eyes.editor.replace(nextEyes)
  }
  function reset() {
    if (!changed) return
    setPast((stack) => [...stack, { weights }])
    setFuture([])
    setWeights({})
  }

  function switchToFace() {
    if (!weightActive) return
    setPast((stack) => [...stack, { weights, eyes: eyes.editor.state }])
    setFuture([])
    setWeights((current) => ({ ...current, [WEIGHT_SHAPE_CODE]: 0 }))
    setWeightResetForEyes(true)
  }

  function switchToWeight() {
    setPast((stack) => [...stack, { weights, eyes: eyes.editor.state }])
    setFuture([])
    setWeights({})
    eyes.editor.replace(newEyeState())
    setWeightResetForEyes(false)
  }

  // 되돌리기·다시 하기·처음으로는 지금 부위의 기록을 쓴다(눈은 자체 이력)
  const history =
    eyeTab && !weightActive
      ? {
          undo: weightResetForEyes
            ? () => {
                undo()
                setWeightResetForEyes(false)
              }
            : eyes.editor.canUndo
              ? eyes.editor.undo
              : undo,
          redo: eyes.editor.canRedo ? eyes.editor.redo : redo,
          reset: !isDefaultEyes(eyes.editor.state) ? eyes.editor.reset : reset,
          canUndo: eyes.editor.canUndo || past.length > 0,
          canRedo: eyes.editor.canRedo || future.length > 0,
          changed: !isDefaultEyes(eyes.editor.state) || changed,
        }
      : { undo, redo, reset, canUndo: past.length > 0, canRedo: future.length > 0, changed }

  // 체험을 닫으면 시트도 접어 둔다(다음에 열 때 접힘부터)
  const [trialWasOpen, setTrialWasOpen] = useState(trial.open)
  if (trialWasOpen !== trial.open) {
    setTrialWasOpen(trial.open)
    if (!trial.open) setSheetOpen(false)
  }

  function selectSample(index: number) {
    if (index === sampleIndex) return
    setSampleIndex(index)
    setWeights({})
    setPast([])
    setFuture([])
    gestureStart.current = null
    setWeightResetForEyes(false)
  }

  // 다른 화면으로 가면 메인은 cacheComponents로 숨겨진 채 남아(<Activity hidden>) 고른 것이 그대로 남는다.
  // 규칙: 메인을 떠났다 돌아오면 처음 들어온 것과 똑같다(S15P31B204-840, -848). 숨을 때 기본 모델(남성)·조절값·
  // 되돌리기 이력·눈 이력·헤어(없음)·부위 탭(코)·조명·카메라 구도(뷰어 새로 띄움)·휴대폰 전체 화면 체험을 처음으로
  // 돌린다. 다시 보일 때 이미 처음 상태라 이전 화면이 잠깐 보였다 바뀌지 않는다(NewHeadFlow와 같은 방식).
  // 메인 안에서 고른 것은 떠나기 전까지 남고, 어두운 화면·튜토리얼 완료(기기 저장)는 건드리지 않는다.
  // 실험실 넘김(homeHandoff)은 다시 보일 때 손대지 않은 상태로 다시 써져 지워진다.
  // 콜백이 바뀌면 정리가 돌아 처음으로 돌아가 버리므로, 아래 콜백은 모두 바뀌지 않는 것(useCallback([]))이어야 한다
  const resetEyes = eyes.editor.clear
  const resetHair = hair.select
  const resetTrial = trial.reset
  useLayoutEffect(
    () => () => {
      setSampleIndex(INITIAL_SAMPLE_INDEX)
      setWeights({})
      setPast([])
      setFuture([])
      gestureStart.current = null
      setWeightResetForEyes(false)
      resetEyes()
      resetHair(HAIR_NONE)
      setPart(INITIAL_PART)
      setLighting({ ...DEFAULT_LIGHTING })
      setVisit((count) => count + 1)
      resetTrial()
    },
    [resetEyes, resetHair, resetTrial],
  )

  return (
    <section
      ref={section}
      aria-label="3D 얼굴 체험"
      className={cx(
        'pf-main relative isolate grid overflow-clip',
        'grid-cols-1 gap-y-(--space-24) px-[5%] pt-(--space-24) pb-(--space-32)',
        'md:grid-cols-[minmax(0,1fr)_340px] md:gap-x-(--space-32) md:gap-y-(--space-28) md:px-[4%] md:pt-(--space-32)',
        'lg:grid-cols-[minmax(340px,1fr)_minmax(0,1.4fr)_minmax(300px,340px)] lg:items-center lg:gap-x-(--space-32) lg:pt-(--space-16) lg:pb-(--space-40)',
        // 큰 화면: 머리줄·바닥줄을 뺀 화면 높이를 채우고 그 안에서 세로 가운데(배너가 없을 때 위로 몰리지 않게)
        'lg:min-h-[calc(100svh-150px)] lg:content-center',
        // 모바일 전체 화면 체험: 화면을 덮고(머리줄 위) 3D가 남는 높이를 채운다. 시트는 접힘 높이만 자리를 쓴다
        trial.open &&
          'max-md:fixed max-md:inset-0 max-md:z-[45] max-md:flex max-md:flex-col max-md:gap-0 max-md:bg-canvas max-md:pt-[calc(var(--space-12)+env(safe-area-inset-top))] max-md:pb-0',
      )}
    >
      {/* 3D 뒤에만 번지는 은은한 빛. 장식이라 누를 수 없다 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_52%_48%,var(--pf-stage-glow)_0%,transparent_70%)]"
      />

      {/* ── 글·행동 ───────────────────────────────────── */}
      <div
        className={cx(
          'relative z-10 flex flex-col items-start md:col-span-2 lg:col-span-1 lg:col-start-1 lg:row-start-1',
          trial.open && 'max-md:hidden',
        )}
      >
        {/* 메인은 도구 화면이라 랜딩보다 한 단계 작은 큰 제목(두 줄 유지) */}
        <h1 className="type-display text-ink lg:text-[clamp(44px,4.1vw,64px)]">
          <span className="pf-reveal-line">
            <span>촬영한 내 얼굴을</span>
          </span>
          <span className="pf-reveal-line">
            <span>3D로.</span>
          </span>
        </h1>
        <p className="type-lead mt-(--space-16) max-w-[30ch] text-ink-2 motion-safe:animate-[pf-rise_var(--pf-dur-reveal)_var(--pf-ease-out)_200ms_both]">
          휴대폰 영상 하나로 만든 내 얼굴을 돌려 보며, 작은 변화를 미리 살펴보세요.
        </p>
        {/* 두 버튼은 같은 높이·글씨(48px·15px, refine.css pf-hero-actions). 주 행동은 '가기' 화살표 */}
        <div className="pf-hero-actions mt-(--space-28) flex flex-wrap items-center gap-(--space-12) motion-safe:animate-[pf-rise_var(--pf-dur-reveal)_var(--pf-ease-out)_280ms_both]">
          <button
            type="button"
            className="btn-primary"
            onClick={() => memberNavigate('/studio/new')}
          >
            내 3D 얼굴 만들기
            <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
          </button>
          <Link href="/about" className="btn-ghost">
            만드는 과정 보기
          </Link>
        </div>
        {/* 기능명세 R-01 고지: 주 버튼 아래 문장 그대로(2026-10-30) */}
        <p className="type-caption mt-(--space-14) text-faint">{SIMULATION_NOTICE}</p>
      </div>

      {/* ── 3D 무대 ───────────────────────────────────── */}
      <div
        ref={slot}
        className={cx(
          'pf-main-stage relative z-0 h-[56svh] min-h-[340px] w-full',
          'md:col-start-1 md:row-start-2 md:h-[min(56svh,540px)]',
          // 큰 화면: 예전 min(62svh,580px)의 1.25배. 조절 카드가 넘기지 않고 다 보이는 높이(trialFraming MAIN_DESKTOP_SCALE, -840).
          // 낮은 화면(약 860px 아래)에서는 머리줄 80 + 꼬리말 57 + 체험 칸 위아래 여백 56(+여유 3) = 196px을 뺀 높이까지만 키워
          // 머리줄·체험·꼬리말이 한 화면에 들어온다. 없으면 꼬리말만큼 스크롤이 생겼다(-867). 조절 카드 최대 높이도 같은 식이다
          'lg:col-start-2 lg:row-start-1 lg:h-[min(77.5svh,725px,calc(100svh-196px))]',
          trial.open && 'max-md:h-auto max-md:min-h-0 max-md:flex-1',
        )}
        aria-label={`${sample.title} 3D 뷰어`}
      >
        {/* 3D가 준비되기 전에는 뷰어가 가운데 가는 선 하나만 보인다(system.css .pf-loader) */}
        {/* 튜토리얼 1단계: 3D 위 끌기·휠을 보고 해 본 조작을 체크한다(캡처 단계라 조작을 막지 않는다) */}
        <div ref={canvas} className="pf-main-canvas absolute inset-0" {...lookGestures}>
          <FaceViewer
            key={viewerKey}
            meshUrl={sample.meshUrl}
            weights={weights}
            view={view}
            layout="single"
            showing="after"
            enablePan
            zoomRange={MAIN_ZOOM}
            lighting={lighting}
            viewportFrame={frame}
            onSupportedCodes={setSupported}
            onStatusChange={setStatus}
            eyeEdit={eyes.viewer}
            hairUrl={hair.hairUrl}
            onHairStatus={hair.onHairStatus}
            zoomOnlyOverModel
          />
          {/* 모바일 메인에서는 미리 보기만: 번진 캔버스 전체를 덮어 터치가 3D 대신 페이지 스크롤로 간다.
              캔버스 상자는 R3F가 pointer-events를 직접 켜서 부모의 pointer-events-none이 안 먹는다 */}
          {trial.open ? null : <div aria-hidden="true" className="absolute inset-0 md:hidden" />}
        </div>

        {/* 무대 위 가운데 = 보는 모델(남성·여성, 상자 없는 글자 탭), 오른쪽 위 = 조명 구. 어느 폭에서도 3D 바로 위에 붙는다 */}
        <Segmented
          mode="toggle"
          size="sm"
          label="기본 모델 선택"
          value={String(sampleIndex)}
          onChange={(next) => selectSample(Number(next))}
          options={SAMPLE_HEADS.map((item, index) => ({
            value: String(index),
            label: item.shortTitle,
          }))}
          className={cx(
            'absolute top-0 left-1/2 z-20 -translate-x-1/2',
            !trial.open && 'max-md:hidden',
          )}
        />
        <div
          data-tutorial="light"
          className={cx(
            'absolute top-(--space-6) right-0 z-20 flex rounded-full',
            !trial.open && 'max-md:hidden',
          )}
        >
          <LightSphere
            value={lighting}
            onChange={(next) => {
              setLighting(next)
              tutorial.markLook('light')
            }}
            size={28}
          />
        </div>
        {trial.open ? (
          <button
            type="button"
            className="btn-ghost absolute top-0 left-0 z-20 md:hidden"
            onClick={trial.close}
          >
            <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
            홈으로
          </button>
        ) : (
          <div className="absolute inset-x-0 bottom-(--space-16) z-20 flex justify-center md:hidden">
            <button
              type="button"
              className="btn-primary"
              aria-controls="pf-main-controls"
              onClick={trial.show}
            >
              체험하기
            </button>
          </div>
        )}
        {/* 조작 안내: 데스크톱은 무대 아래. 휴대폰은 전체 화면 체험에서만 접힌 시트 바로 위 가운데에 보이고,
            캔버스 터치를 막지 않게 누를 수 없다(-533). 미리 보기에서는 캔버스가 터치를 받지 않아 숨긴다.
            튜토리얼이 떠 있는 동안은 같은 내용을 카드가 알려 주므로 숨긴다(-546) */}
        <ViewerHints
          className={cx(
            'pointer-events-auto absolute inset-x-0 bottom-(--space-4) z-20 max-md:pointer-events-none md:bottom-[-28px]',
            !trial.open && 'max-md:hidden',
            tutorialShown && 'invisible',
          )}
        />
      </div>

      {/* ── 조절 패널(데스크톱·태블릿은 글래스 카드, 모바일은 아래 시트) ── */}
      <aside
        ref={sheetRef}
        id="pf-main-controls"
        aria-label="형태 편집"
        data-sheet={sheetOpen ? 'open' : 'closed'}
        className={cx(
          'glass relative z-30 flex flex-col rounded-(--pf-radius-xl) p-(--space-20)',
          'md:col-start-2 md:row-start-2 md:self-center',
          // 큰 화면: 위쪽을 3D 무대 위쪽에 붙이고 높이는 무대를 넘지 않는다(넘치면 아래 조절 영역만 넘긴다).
          // 가운데 정렬·내용만큼 높이면 부위 탭을 바꿀 때마다 카드와 3D가 위아래로 움직였다(-789)
          'lg:col-start-3 lg:row-start-1 lg:max-h-[min(77.5svh,725px,calc(100svh-196px))] lg:self-start',
          // 모바일: 화면 아래에 붙는 시트. 접힘 높이는 훅이 --pp-sheet-peek으로 잰다.
          // 높이는 열림·접힘 모두 같고 조절은 안쪽 스크롤 영역에서 넘긴다(-573)
          'max-md:sticky max-md:bottom-0 max-md:mx-[-5.6%] max-md:h-[min(64svh,560px)] max-md:overflow-hidden max-md:rounded-b-none max-md:px-[5.6%] max-md:pt-0 max-md:pb-[calc(var(--space-20)+env(safe-area-inset-bottom))]',
          'max-md:translate-y-[calc(100%-var(--pp-sheet-peek,220px))] max-md:transition-transform max-md:duration-(--pf-dur-sheet) max-md:ease-(--pf-ease-drawer)',
          'max-md:data-[sheet=open]:translate-y-0',
          // 전체 화면에서 접혀 있으면 아래로 내려간 길이만큼 자리를 빼서 3D가 그만큼 더 높게 보인다(-526)
          'max-md:data-[sheet=closed]:mt-[calc(-1*var(--pp-sheet-collapse,0px))]',
          // 모바일 메인은 미리 보기만이라 시트를 숨긴다(체험하기로 연다)
          !trial.open && 'max-md:hidden',
          'motion-reduce:transition-none',
        )}
      >
        <button
          type="button"
          className="mx-auto mt-(--space-4) mb-(--space-8) flex h-7 w-full touch-none items-center justify-center md:hidden"
          aria-controls="pf-main-controls"
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? '조절 패널 접기' : '조절 패널 펼치기'}
          {...sheetHandle}
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-hairline-strong" />
        </button>

        {/* 부위가 다섯 칸이라 레일과 이력 버튼을 각각 한 줄에 둔다. 휴대폰에서도 탭 이름을 자르지 않는다.
            큰 화면은 둘을 한 줄에 놓고 세로 가운데를 맞춘다. 카드가 좁아 다 안 들어가면 이력만 다음 줄 오른쪽으로 내린다(-840) */}
        <div className="flex flex-col gap-(--space-4) lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-0">
          <div
            data-tutorial="parts"
            className="min-w-0 max-w-full overflow-x-auto rounded-(--pf-radius-sm)"
          >
            <ControlRail
              label="편집 부위"
              variant="quiet"
              value={part}
              onChange={(next) => {
                if (next !== part) tutorial.signal('part')
                gestureStart.current = null
                if (next !== 'eyes') setWeightResetForEyes(false)
                setPart(next)
              }}
              // 실험실 부위 탭(Inspector PART_TABS)과 같은 순서. 처음 선택은 코 그대로(S15P31B204-704)
              items={[
                { value: 'eyes', label: '눈' },
                { value: 'nose', label: '코' },
                { value: 'contour', label: '윤곽' },
                { value: 'weight', label: '체중' },
                // 헤어 탭 옆 `베타`는 회원 편집실과 같이 뗐다(S15P31B204-838)
                { value: 'hair', label: '헤어' },
              ]}
            />
          </div>
          <div
            data-tutorial="history"
            className="-mr-(--space-8) flex self-end items-center rounded-full lg:ml-auto lg:self-center"
            role="group"
            aria-label="편집 기록"
          >
            {(
              [
                ['되돌리기', 'ArrowCounterClockwise', history.undo, !history.canUndo, false],
                ['다시 하기', 'ArrowCounterClockwise', history.redo, !history.canRedo, true],
                ['처음으로', 'ClockCounterClockwise', history.reset, !history.changed, false],
              ] as const
            ).map(([label, icon, onClick, disabled, mirrored]) => {
              const button = (describedBy?: string) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  aria-describedby={describedBy}
                  disabled={disabled}
                  onClick={() => {
                    onClick()
                    tutorial.signal('history')
                  }}
                  className="inline-flex size-9 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-(--pf-dur-ui) ease-(--pf-ease-out) hover:bg-ink/5 active:scale-95 disabled:text-faint disabled:hover:bg-transparent"
                >
                  <Icon name={icon} size={18} className={cx(mirrored && '-scale-x-100')} />
                </button>
              )
              // 말풍선은 아이콘만으로 뜻이 안 보이는 '처음으로'에만(오른쪽 끝이라 오른쪽 맞춤)
              return label === '처음으로' ? (
                <Tooltip key={label} label={label} align="end">
                  {button}
                </Tooltip>
              ) : (
                button()
              )
            })}
          </div>
        </div>

        {/* 휴대폰: 부위 레일 아래만 넘긴다. 접힌 채로도 넘겨 코끝·콧볼까지 만진다(-573).
            접혀 화면 밖으로 내려간 길이(--pp-sheet-collapse)만큼 아래를 비워, 마지막 조절도 보이는 곳까지 올라온다 */}
        <div
          data-sheet-scroll
          className={cx(
            'max-md:-mx-(--space-8) max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-(--space-8) max-md:in-data-[sheet=closed]:pb-[var(--pp-sheet-collapse,0px)]',
            // 큰 화면: 카드 높이 상한(무대 높이) 안에서 부위 레일 아래만 넘긴다(-789)
            'lg:-mx-(--space-8) lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-(--space-8)',
          )}
        >
          {part === 'weight' && faceEdits && controls.length ? (
            <div className="mt-(--space-20)">
              <EditModeSwitch resetLabel={faceEdits} toWeight onSwitch={switchToWeight} />
            </div>
          ) : part !== 'weight' && part !== 'hair' && weightActive ? (
            <div className="mt-(--space-20)">
              <EditModeSwitch resetLabel="체중 변화" toWeight={false} onSwitch={switchToFace} />
            </div>
          ) : part === 'nose' || part === 'contour' || part === 'weight' ? (
            <div
              className="pp-adjustments mt-(--space-20)"
              onPointerDownCapture={markGesture}
              onKeyDownCapture={markGesture}
            >
              <NoseControlGroups
                controls={controls}
                onChange={applyChanges}
                rowClassName="pf-main-row"
                {...(part === 'weight'
                  ? {
                      groups: ['체중'],
                      icon: () => <ContourIcon id="cheekVolume" />,
                      formatValue: weightShapeSliderValue,
                      formatAriaValue: weightShapeStrengthLabel,
                    }
                  : part === 'contour'
                    ? { groups: CONTOUR_GROUPS, icon: (id: string) => <ContourIcon id={id} /> }
                    : {})}
              />
            </div>
          ) : eyeTab ? (
            <div className="pp-adjustments mt-(--space-20) flex flex-col gap-(--space-16)">
              <EyePanel
                state={eyes.editor.state}
                selection={eyes.selection}
                review={sample.eyeReview}
                limits={eyes.limits}
                onPreview={eyes.editor.preview}
                onCommit={() => {
                  eyes.editor.commit()
                  setWeightResetForEyes(false)
                  tutorial.signal('adjust')
                }}
                disabled={status !== 'ready' || !eyes.geometry.ready || weightActive}
              />
              {eyes.note ? (
                <p className="type-caption text-muted-soft" role="status">
                  {eyes.note}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="pp-adjustments mt-(--space-20)">
              <HairPanel
                value={hair.hairId}
                onChange={(id) => {
                  hair.select(id)
                  tutorial.signal('adjust')
                }}
                loading={hair.loading}
                disabled={status !== 'ready'}
                compact
              />
            </div>
          )}

          <p className="type-caption mt-(--space-24) text-muted-soft" role="status">
            {status === 'loading'
              ? '모델을 준비하고 있어요.'
              : status === 'error'
                ? '모델을 불러오지 못했어요. 새로고침해 주세요.'
                : '체험용 기본 모델이라 바꾼 내용은 저장되지 않아요.'}
          </p>
        </div>
      </aside>

      {tutorialShown ? (
        <TutorialCard
          tutorial={tutorial}
          getTarget={getTutorialTarget}
          getStage={getTutorialStage}
          // 1단계는 작은 조명 구를 동그랗게 가리키고, 구를 끌어 보면 테두리를 거둔다(칩이 대신 알려 준다)
          roundTarget={tutorial.current.id === 'look'}
          hideRing={tutorial.current.id === 'look' && tutorial.looked.has('light')}
          measureKey={`${part}:${sheetOpen}:${trial.open}`}
          extra={tutorial.current.id === 'look' ? <LookChips looked={tutorial.looked} /> : null}
          className={cx(!trial.open && 'max-md:hidden')}
        />
      ) : null}
    </section>
  )
}
