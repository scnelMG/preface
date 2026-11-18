'use client'

import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { CONTACT } from '@/features/legal/facts'
import { cx, Icon } from '@/shared/ui'
import {
  controlLimit,
  screenEyeLabel,
  TRIM_CONTROLS,
  type EyeControl,
  type EyeLimits,
  type EyeSide,
  type EyeState,
} from '../eyes/state'
import { describeChange, labelOf, orderByCatalog } from '../editLogic'
import {
  displayWeight,
  isTipLowerPair,
  noseControlChanges,
  noseControls,
  type MorphValueChange,
  TIP_HEIGHT_CODE,
  TIP_ROTATION_CODE,
} from '../noseControls'
import type { ApplyResult, MorphParameterCatalog, SendMessageBody } from '../types'
import { CONTENT_MAX, consultRecovery, type ChatItem, type Consult } from './useConsult'
import { PRIVATE_TEXT } from '@/shared/analytics'
import {
  PROFILE_SECTIONS,
  profileQuestion,
  type FaceProfile,
  type MeasureProfileTrial,
  type ProfileSection,
} from './faceProfile'
import { PhotoProfileEvidence } from './PhotoProfileEvidence'
import {
  adjustmentChoices,
  RECOMMENDATION_STEP,
  measuredRecommendationCopy,
  measuredRecommendationDetails,
  formatTrialChange,
  measuredRecommendationInputs,
  faceAdjustmentEvidence,
  nextAdjustmentQuestion,
  nextFaceAdjustments,
  recommendationMeasurements,
  recommendationGuidance,
} from './faceAdjustmentAdvice'
import { ReviewedProfileRatio } from './ReviewedProfileRatio'
import { ConsultSummary } from './ConsultSummary'
import { contourControls } from '../contourControls'
import {
  WEIGHT_SHAPE_CODE,
  weightShapeControls,
  weightShapeStrengthLabel,
} from '../weightShapeControls'

const SLIDER_EXAMPLES = [
  { id: 'ex-01', control: 'bridge', up: '콧대를 좀 올려줘', down: '콧대를 좀 내려줘' },
  { id: 'ex-02', control: 'lower', up: '코끝을 살짝 내려줘', down: '코끝을 살짝 올려줘' },
  {
    id: 'tip-projection',
    control: 'projection',
    up: '코끝을 살짝 앞으로 보내줘',
    down: '코끝을 살짝 뒤로 넣어줘',
  },
  { id: 'alar-width', control: 'alar', up: '콧볼을 조금 넓혀줘', down: '콧볼을 조금 좁혀줘' },
  { id: 'cheekbone', control: 'cheekbone', up: '광대를 조금 키워줘', down: '광대를 조금 줄여줘' },
  {
    id: 'cheek-volume',
    control: 'cheekVolume',
    up: '볼살을 조금 채워줘',
    down: '볼살을 조금 줄여줘',
  },
  {
    id: 'chin-projection',
    control: 'chinProjection',
    up: '턱끝을 조금 앞으로 보내줘',
    down: '턱끝을 조금 뒤로 넣어줘',
  },
  {
    id: 'chin-length',
    control: 'chinLength',
    up: '턱끝을 조금 길게 해줘',
    down: '턱끝을 조금 짧게 해줘',
  },
  {
    id: 'chin-width',
    control: 'chinWidth',
    up: '턱끝 폭을 조금 넓혀줘',
    down: '턱끝 폭을 조금 좁혀줘',
  },
  {
    id: 'jaw-angle',
    control: 'jawAngle',
    up: '사각턱을 조금 넓혀줘',
    down: '사각턱을 조금 줄여줘',
  },
  {
    id: 'weight-shape',
    control: 'weightShape',
    up: '살짝 증량한 모습을 보여줘',
    down: '살짝 감량한 모습을 보여줘',
  },
] as const

const NEXT_ADJUSTMENT_PROMPT = '어디부터 바꿔보면 좋을까요?'

const STARTER_BUTTON_CLASS =
  'inline-flex h-11 w-36 max-w-full items-center justify-center rounded-full border border-hairline-strong px-2 py-1 text-[13px] leading-tight break-keep text-ink-2 transition-[border-color,color,transform] duration-(--pf-dur-ui) hover:border-ink hover:text-ink active:scale-[0.97] disabled:opacity-40'

const EYE_EXAMPLES = [
  { id: 'inner', text: '앞트임을 조금 넓혀줘' },
  { id: 'outer', text: '뒤트임을 조금 넓혀줘' },
  { id: 'upper', text: '윗트임을 조금 넓혀줘' },
  { id: 'lower', text: '밑트임을 조금 넓혀줘' },
] as const

function availableSliders(
  catalog: MorphParameterCatalog | null,
  supportedCodes?: readonly string[],
  weights: Readonly<Record<string, number>> = {},
) {
  return catalog
    ? [
        ...noseControls(catalog, weights, supportedCodes),
        ...contourControls(catalog, weights, supportedCodes),
        ...weightShapeControls(catalog, weights, supportedCodes),
      ].filter((control) => !control.unavailable)
    : []
}

function consultExamples(
  sliders: ReturnType<typeof availableSliders>,
  eyeAvailable: boolean | undefined,
  eyeLimits: EyeLimits | undefined,
) {
  const sliderExamples = SLIDER_EXAMPLES.flatMap(({ id, control, up, down }) => {
    const slider = sliders.find((item) => item.id === control)
    if (!slider) return []
    const canLower = slider.rawMin < 0
    const canRaise = slider.rawMax > 0
    const text = control === 'lower' && canLower ? down : canRaise ? up : down
    return [{ id, text }]
  })
  const eyeExamples = eyeAvailable
    ? EYE_EXAMPLES.filter(({ id }) => (controlLimit(eyeLimits, id, 'inline') ?? 0) > 0)
    : []
  return [...sliderExamples, ...eyeExamples].slice(0, 2)
}

const FEEDBACK_HREF = `mailto:${CONTACT}?subject=${encodeURIComponent('Preface 상담 결과 제보')}&body=${encodeURIComponent('기대한 변화:\n실제로 보인 결과:\n재현 단계:\n\n얼굴 사진·3D 모델·실명·개인 측정값은 보내지 마세요.')}`

interface ConsultModeSwitch {
  revision: string
  stateVersion?: number
  toWeight?: { clears: string; apply: () => Promise<boolean> | boolean }
  toFace?: { clears: string; apply: () => Promise<boolean> | boolean }
}

function parseModeSwitch(text: string) {
  const command = text.trim()
  if (/^체중\s*변화로\s*(?:전환해|바꿔)\s*(?:줘|주세요)?[.!]*$/.test(command))
    return { target: 'toWeight' as const, followUp: '' }
  const afterWeight = command.match(/^체중\s*변화로\s*(?:전환하고|바꾸고)\s+(.+)$/)
  if (afterWeight) {
    const followUp = afterWeight[1].replace(/^강도(?=\s*(?:를|는)?\s*[+-]?\d)/, '체중 변화 강도')
    return { target: 'toWeight' as const, followUp }
  }
  const faceSwitch = command.match(
    /^(?:눈\s*[·,]\s*코\s*[·,]\s*윤곽|얼굴\s*조절)(?:\s*모드)?(?:으로|로)\s*(?:(?:전환해|바꿔)\s*(?:줘|주세요)?[.!]*|(?:전환하고|바꾸고)\s+(.+))$/,
  )
  if (faceSwitch) return { target: 'toFace' as const, followUp: faceSwitch[1] ?? '' }
  const afterReset = command.match(
    /^체중\s*변화(?:를|는)?\s*(?:원본으로\s*돌리고|초기화하고)\s+(.+)$/,
  )
  return afterReset ? { target: 'toFace' as const, followUp: afterReset[1] } : null
}

/**
 * 다음 조절을 안내할 때 현재 시안에서 열린 항목만 알려 준다.
 */
export function sliderPartsNotice(
  catalog: MorphParameterCatalog | null,
  supportedSliderCodes?: readonly string[],
  eyeSliderAvailable = false,
): string {
  const parts = availableSliders(catalog, supportedSliderCodes).map((control) => control.group)
  const names = [...new Set(parts), ...(eyeSliderAvailable ? ['눈'] : [])]
  return names.length
    ? `이 모델에서 채팅으로 조절할 수 있는 항목은 ${names.join('·')}입니다.`
    : '이 모델에서 열린 조절 항목을 채팅으로 안내해 드릴게요.'
}

/** Figma `consult`(P3-61 상담 기본 · P3-63/64). 입력 → AI 실장님 → 3D 반영 카드 */
export function ConsultPanel({
  consult,
  catalog,
  supported,
  eyeSliderAvailable,
  eyeLimits,
  eyeState,
  supportedSliderCodes,
  onOpenSlider,
  modeSwitch,
  directControl,
  onClearDirectControl,
  faceRatioAvailable = false,
  faceModelId,
  faceProfile,
  originalFaceProfile,
  measureTrial,
  frontPhoto,
  faceProfileState,
  savedWeights,
  hasAppliedEyelids,
  onComparisonView,
}: {
  consult: Consult
  catalog: MorphParameterCatalog | null
  supported?: Record<string, { min: number; max: number }>
  eyeSliderAvailable?: boolean
  eyeLimits?: EyeLimits
  eyeState?: EyeState
  supportedSliderCodes?: readonly string[]
  onOpenSlider?: (
    code: string,
    recommendation?: { preview?: { changes: readonly MorphValueChange[] } },
  ) => void
  modeSwitch?: ConsultModeSwitch
  directControl?: { code: string; label: string; stateVersion: number }
  onClearDirectControl?: () => void
  faceRatioAvailable?: boolean
  faceModelId?: string
  faceProfile?: FaceProfile | null
  originalFaceProfile?: FaceProfile | null
  measureTrial?: MeasureProfileTrial | null
  frontPhoto?: string | null
  faceProfileState?: 'loading' | 'unavailable'
  savedWeights?: Readonly<Record<string, number>>
  hasAppliedEyelids?: boolean
  onComparisonView?: (view: 'original' | 'current' | 'proposal' | 'front' | 'side') => void
}) {
  const inputId = useId()
  const input = useRef<HTMLTextAreaElement>(null)
  const focusNewConversation = useRef(false)
  const [text, setText] = useState('')
  const [profileSection, setProfileSection] = useState<ProfileSection | null>(null)
  const [exploring, setExploring] = useState(false)
  const [showConditions, setShowConditions] = useState(false)
  const [goal, setGoal] = useState('')
  const [keep, setKeep] = useState('')
  const [previewRequest, setPreviewRequest] = useState(false)
  const comparisonCard = useRef<HTMLElement>(null)
  const showGuidedComparison = useRef(false)
  const chatScroll = useRef<HTMLDivElement>(null)
  const latestAnalysis = useRef<HTMLLIElement>(null)
  const { items, loading, history, busy, error, send } = consult
  const [quickTurns, setQuickTurns] = useState<
    { after?: string; messages: [ChatItem, ChatItem] }[]
  >([])
  const latestItemId = items.at(-1)?.id
  const savedConditions = items.findLast(
    (item) => item.role === 'user' && !item.sending && item.content.startsWith('상담 목표: '),
  )
  const [savedGoal = '', savedKeep = ''] =
    savedConditions?.content.slice('상담 목표: '.length).split(' / 유지할 부위: ', 2) ?? []
  const chatItems = history?.archived
    ? items
    : [
        ...quickTurns.filter((turn) => !turn.after).flatMap((turn) => turn.messages),
        ...items.flatMap((item) => [
          item,
          ...quickTurns.filter((turn) => turn.after === item.id).flatMap((turn) => turn.messages),
        ]),
      ]

  function replyToQuickAction(request: string, response: string) {
    setQuickTurns((turns) => [
      ...turns,
      {
        after: latestItemId,
        messages: [
          { id: `quick-${turns.length}-user`, role: 'user', content: request },
          {
            id: `quick-${turns.length}-assistant`,
            role: 'assistant',
            content: response,
          },
        ],
      },
    ])
  }
  function showProfileReply(topic: ProfileSection, request: string) {
    setTransition(null)
    setSwitchNotice('')
    if (faceProfileState === 'loading') {
      setSwitchNotice('현재 시안의 3D를 확인하고 있어요. 잠시 후 다시 요청해 주세요.')
      return Promise.resolve(false)
    }
    if (
      isJawObservation(topic, request) ||
      /(?:설명|분석|비율|측정값)\s*만|(?:변경|적용)하지\s*말/.test(request)
    )
      return send(request, { exampleId: 'face-ratio', profileSection: topic })
    const recommendations = nextFaceAdjustments(
      faceProfile,
      sliders,
      savedWeights,
      request,
      savedKeep,
      eyeInnerOpen,
    ).filter(
      ({ id }) =>
        topic === 'overall' ||
        (topic === 'eyes' && id === 'eyeInner') ||
        (topic === 'lower' && (id === 'jawAngle' || id === 'chinLength')) ||
        (topic === 'side' && (id === 'chinProjection' || id === 'projection')),
    )
    const candidates = recommendations.map(({ id }) => id)
    return send(request, {
      exampleId: 'face-ratio',
      profileSection: candidates.length ? 'analysis:' + topic + ':' + candidates.join(',') : topic,
      ...recommendationMeasurements(recommendations),
    })
  }

  const latestProfileReply = items.findLast((item) => item.role === 'assistant')
  const [seenProfileReply, setSeenProfileReply] = useState<string>()
  if (latestProfileReply?.profileSection && latestProfileReply.id !== seenProfileReply) {
    setSeenProfileReply(latestProfileReply.id)
    const topic = profileReplyTopic(latestProfileReply.profileSection)
    if (topic) setProfileSection(topic)
  }
  const historyBusy = busy || loading || history?.loadingOlder || history?.starting
  const [measuringRecommendation, setMeasuringRecommendation] = useState(false)
  const activeMeasurement = useRef<AbortController | null>(null)
  const waiting = historyBusy || history?.archived || measuringRecommendation
  useEffect(() => () => activeMeasurement.current?.abort(), [])
  const sliders = availableSliders(catalog, supportedSliderCodes, savedWeights)
  const eyeInnerLimit = controlLimit(eyeLimits, 'inner', 'inline') ?? 0
  const eyeInnerOpen = Boolean(eyeSliderAvailable && eyeInnerLimit > 0)
  const eyeInnerValues = [eyeState?.L.values.inner ?? 0, eyeState?.R.values.inner ?? 0]
  const eyeDirections =
    eyeInnerOpen && !history?.archived
      ? [-1, 1].filter((direction) =>
          eyeInnerValues.some((value) => (direction < 0 ? value > 0 : value < eyeInnerLimit)),
        )
      : []
  const showNextAdjustment = faceRatioAvailable && !directControl && !consult.comparison
  const starterProfileNotice =
    faceRatioAvailable && !directControl
      ? faceProfileState === 'loading'
        ? '현재 시안의 3D를 불러오는 중이에요.'
        : faceProfileState === 'unavailable'
          ? '3D를 불러오지 못했어요. 얼굴 분석과 추천은 새로고침 후 다시 시도해 주세요.'
          : null
      : null
  const examples = consultExamples(sliders, eyeSliderAvailable, eyeLimits).slice(
    0,
    showNextAdjustment ? 1 : 2,
  )
  const askNextAdjustment = () =>
    void submit(undefined, { exampleId: 'next-adjustment' }, NEXT_ADJUSTMENT_PROMPT)
  const [transition, setTransition] = useState<{
    command: NonNullable<ReturnType<typeof parseModeSwitch>>
    revision: string
    clears: string
    source: string
  } | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchNotice, setSwitchNotice] = useState('')
  const [pendingRecommendation, setPendingRecommendation] = useState<{
    content: string
    fromInput: boolean
  } | null>(null)
  const afterSwitch = useRef('')
  const inputLocked = history?.archived || history?.starting || loading

  useEffect(() => {
    if (!inputLocked && focusNewConversation.current) {
      focusNewConversation.current = false
      input.current?.focus()
    }
  }, [inputLocked])

  useEffect(() => {
    if (switching || busy || !afterSwitch.current) return
    const request = afterSwitch.current
    afterSwitch.current = ''
    void send(request).then((ok) => {
      if (!ok) setText((current) => current || request)
    })
  }, [switching, busy, send])

  async function confirmTransition() {
    if (!transition || switching || busy) return
    const operation = modeSwitch?.[transition.command.target]
    if (!operation || modeSwitch?.revision !== transition.revision) {
      setTransition(null)
      setSwitchNotice('조절값이 바뀌었어요. 전환하려면 다시 말씀해 주세요.')
      return
    }
    setSwitching(true)
    try {
      const { target, followUp } = transition.command
      const stateVersion = modeSwitch?.stateVersion
      if (followUp && stateVersion !== undefined) {
        setTransition(null)
        if (!(await send(followUp, { modeSwitch: { target, stateVersion } }))) {
          setText((current) => current || transition.source)
        }
        return
      }
      if (await operation.apply()) {
        setTransition(null)
        setSwitchNotice(`${transition.clears} 조절값을 원본으로 돌렸어요.`)
        afterSwitch.current = transition.command.followUp
      } else {
        setTransition(null)
        setSwitchNotice('전환하지 못했어요. 현재 조절값을 확인한 뒤 다시 시도해 주세요.')
      }
    } catch {
      setTransition(null)
      setSwitchNotice('전환하지 못했어요. 현재 조절값을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setSwitching(false)
    }
  }

  const latestChatItemId = chatItems.at(-1)?.id
  useLayoutEffect(() => {
    if (!loading && latestChatItemId && chatScroll.current) {
      const scroll = chatScroll.current
      const analysis = latestAnalysis.current
      if (analysis && !consult.comparison) {
        scroll.scrollTop +=
          analysis.getBoundingClientRect().top - scroll.getBoundingClientRect().top
      } else {
        scroll.scrollTop = scroll.scrollHeight
      }
    }
    if (consult.comparison && showGuidedComparison.current && comparisonCard.current) {
      showGuidedComparison.current = false
      comparisonCard.current.focus({ preventScroll: true })
      comparisonCard.current.scrollIntoView?.({ block: 'nearest' })
    }
  }, [loading, latestChatItemId, busy, transition, switchNotice, consult.comparison])

  async function sendNextAdjustment(content: string, fromInput: boolean) {
    if (activeMeasurement.current) return false
    const recommendations = nextFaceAdjustments(
      faceProfile,
      sliders,
      savedWeights,
      content,
      savedKeep,
      eyeInnerOpen,
    )
    const section = 'next:' + (recommendations.map(({ id }) => id).join(',') || 'none')
    let measurements =
      measureTrial === undefined
        ? recommendationMeasurements(recommendations)
        : measuredRecommendationInputs(
            recommendations,
            sliders,
            savedWeights,
            measureTrial,
            modeSwitch?.stateVersion,
            eyeState && eyeInnerOpen
              ? { state: eyeState, limits: eyeLimits, limit: eyeInnerLimit }
              : undefined,
          )
    if (measurements instanceof Promise) {
      const controller = new AbortController()
      activeMeasurement.current = controller
      setMeasuringRecommendation(true)
      try {
        measurements = await measurements
      } finally {
        activeMeasurement.current = null
        if (!controller.signal.aborted) setMeasuringRecommendation(false)
      }
      if (controller.signal.aborted) return false
    }
    const ok = await send(content, {
      exampleId: 'next-adjustment',
      profileSection: hasAppliedEyelids ? section + ':fold' : section,
      ...measurements,
    })
    if (!ok && fromInput) setText((current) => current || content)
    return ok
  }

  const sendPendingRecommendation = useEffectEvent(
    (request: NonNullable<typeof pendingRecommendation>) => {
      setPendingRecommendation(null)
      if (faceProfileState === 'unavailable') {
        setSwitchNotice('현재 시안의 3D를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.')
        if (request.fromInput) setText((current) => current || request.content)
        return
      }
      setSwitchNotice('')
      void sendNextAdjustment(request.content, request.fromInput)
    },
  )
  useEffect(() => {
    if (!pendingRecommendation || waiting || switching || faceProfileState === 'loading') return
    const timer = setTimeout(() => sendPendingRecommendation(pendingRecommendation), 0)
    return () => clearTimeout(timer)
  }, [pendingRecommendation, waiting, switching, faceProfileState])

  async function submit(
    event?: FormEvent,
    extra?: Pick<SendMessageBody, 'exampleId' | 'comparisonTarget'> & {
      comparisonAnchorId?: string
    },
    content = text,
  ) {
    event?.preventDefault()
    if (waiting || switching || !content.trim()) return
    const fromInput = !extra?.exampleId && content === text
    if (fromInput) setText('')
    if (fromInput && !directControl && /^고민\s*상담[.!]*$/.test(content.trim())) {
      replyToQuickAction(
        '고민 상담',
        '어떤 부분이 신경 쓰이세요? 그대로 두고 싶은 부위가 있다면 함께 말씀해 주세요.',
      )
      setExploring(true)
      setPreviewRequest(false)
      consult.cancelComparison?.()
      input.current?.focus()
      return
    }
    if (
      faceRatioAvailable &&
      (extra?.exampleId === 'next-adjustment' ||
        (fromInput &&
          (nextAdjustmentQuestion(content, Boolean(directControl)) ||
            (!directControl &&
              onComparisonView &&
              !/비율/.test(content) &&
              profileQuestion(content) === 'overall'))))
    ) {
      setProfileSection(null)
      setTransition(null)
      setSwitchNotice('')
      setExploring(false)
      setPreviewRequest(false)
      consult.cancelComparison?.()
      if (faceProfileState === 'loading') {
        setPendingRecommendation({ content, fromInput })
        setSwitchNotice('현재 시안의 3D가 준비되면 이어서 추천해 드릴게요.')
        return
      }
      return sendNextAdjustment(content, fromInput)
    }
    const profileTopic =
      extra?.exampleId === 'face-ratio'
        ? 'overall'
        : exploring || !fromInput
          ? null
          : profileQuestion(content, profileSection)
    if (
      faceRatioAvailable &&
      !directControl &&
      profileTopic &&
      (faceModelId || faceProfile || profileTopic !== 'overall')
    ) {
      const ok = await showProfileReply(profileTopic, content)
      if (!ok && fromInput) setText((current) => current || content)
      return ok
    }
    if (
      fromInput &&
      !directControl &&
      /^(?:여기|이\s*부분|이\s*항목)(?:만|을|를)?\s*/.test(content.trim())
    ) {
      setText(content)
      setSwitchNotice('직접 조절에서 상담할 항목을 먼저 골라 주세요.')
      return
    }
    const preview =
      extra?.exampleId === 'consult-preview' || (previewRequest && fromInput && !directControl)
    const advice =
      extra?.exampleId === 'consult-advice' ||
      ((exploring || Boolean(faceModelId && profileSection)) &&
        fromInput &&
        !directControl &&
        !preview)
    const canSwitchMode = !advice && !preview && !(directControl && fromInput)
    const command = canSwitchMode ? parseModeSwitch(content) : null
    if (command && modeSwitch) {
      const operation = modeSwitch[command.target]
      setSwitchNotice(
        operation ? '' : '지금은 이 모드로 전환할 수 없어요. 조절값이나 모델 상태를 확인해 주세요.',
      )
      setTransition(
        operation
          ? { command, revision: modeSwitch.revision, clears: operation.clears, source: content }
          : null,
      )
      return
    }
    setTransition(null)
    setSwitchNotice('')
    let ok = false
    try {
      ok = await send(
        content,
        advice
          ? { exampleId: 'consult-advice', ...(profileSection ? { profileSection } : {}) }
          : directControl && fromInput
            ? {
                directControl: {
                  code: directControl.code,
                  stateVersion: directControl.stateVersion,
                },
              }
            : preview
              ? {
                  exampleId: 'consult-preview',
                  ...(extra?.comparisonTarget ? { comparisonTarget: extra.comparisonTarget } : {}),
                  ...(extra?.comparisonAnchorId
                    ? { comparisonAnchorId: extra.comparisonAnchorId }
                    : {}),
                }
              : extra,
      )
    } finally {
      if (!ok && fromInput) setText((current) => current || content)
    }
    return ok
  }

  function comparisonButtons(
    controlId: string,
    anchorId: string,
    view?: 'front' | 'side',
    firstDirection?: number,
  ) {
    const control = sliders.find(
      ({ id, effects }) => id === controlId || effects[0]?.code === controlId,
    )
    const wording = SLIDER_EXAMPLES.find((example) => example.control === control?.id)
    if (!control || !wording || control.id === 'weightShape' || !onComparisonView || !savedWeights)
      return null
    const choices = adjustmentChoices(control, savedWeights).filter(
      ({ direction }) => firstDirection === undefined || direction === firstDirection,
    )
    if (!choices.length) return null
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map(({ direction, target }) => (
          <button
            type="button"
            key={direction}
            disabled={waiting || switching}
            className={cx(
              'type-caption min-h-11 rounded-full px-3 disabled:opacity-40',
              direction === firstDirection
                ? 'border border-ink bg-ink text-on-ink'
                : 'border border-hairline-strong text-ink',
            )}
            onClick={() => {
              onComparisonView(
                view ??
                  (control.id === 'projection' ||
                  control.id === 'chinProjection' ||
                  control.id === 'lower' ||
                  control.id === 'bridge'
                    ? 'side'
                    : 'front'),
              )
              setProfileSection(null)
              setExploring(false)
              setPreviewRequest(false)
              showGuidedComparison.current = true
              void submit(
                undefined,
                {
                  exampleId: 'consult-preview',
                  comparisonAnchorId: anchorId,
                  comparisonTarget: { code: control.effects[0].code, value: target / 100 },
                },
                (direction < 0 ? wording.down : wording.up).replace(/줘$/, '서 보여줘'),
              ).then((ok) => {
                if (!ok) showGuidedComparison.current = false
              })
            }}
          >
            {control.id === 'chinProjection' || control.id === 'projection'
              ? control.group
              : control.accessibleLabel}{' '}
            {control.ends[direction < 0 ? 0 : 1]} 비교
          </button>
        ))}
      </div>
    )
  }

  const lastAssistant = [...items].reverse().find((item) => item.role === 'assistant')
  const recovery = error ? 'retry' : consultRecovery(lastAssistant)
  const recoveryText =
    recovery === 'limit'
      ? '직접 조절에서 현재 값을 확인해 보세요. 계속 바꾸려면 반대 방향이나 더 작은 변화를 요청할 수 있어요.'
      : recovery === 'mode'
        ? '직접 조절에서 원하는 탭을 열면 어떤 값이 원래대로 돌아가는지 확인할 수 있어요.'
        : recovery === 'retry'
          ? '현재 얼굴과 변경 내역을 먼저 확인해 주세요. 반영되지 않았다면 잠시 후 다시 요청할 수 있어요.'
          : '직접 조절에 열린 항목과 원하는 방향을 말씀해 주세요.'

  const comparison = consult.comparison
  const resultSlider: ResultSlider | undefined =
    !waiting && !switching && onOpenSlider
      ? {
          codeFor: (codes) => {
            const [part, detail] = codes[0]?.split('.') ?? []
            if (part === 'eye') {
              if (!eyeSliderAvailable) return undefined
              const trim = TRIM_CONTROLS.find((control) => detail === control)
              if (trim && (controlLimit(eyeLimits, trim, 'inline') ?? 0) > 0) return `eye.${trim}`
              if (hasAppliedEyelids && detail === 'height') return 'eye.height'
              return undefined
            }
            return sliders.find((slider) => slider.effects.some(({ code }) => codes.includes(code)))
              ?.effects[0].code
          },
          open: (code) => {
            if (comparison) consult.cancelComparison?.()
            onOpenSlider(code)
          },
        }
      : undefined
  const comparisonCardContent =
    consult.comparison &&
    consult.comparison.result.stateVersion === modeSwitch?.stateVersion &&
    onComparisonView ? (
      <section
        ref={comparisonCard}
        tabIndex={-1}
        className="mb-4 space-y-2 rounded-[18px] border border-hairline-strong p-3"
        aria-label="3D 비교"
      >
        <h2 className="text-sm font-medium">3D 시안 비교</h2>
        <p className="text-sm">{consult.comparison.result.summary}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => onComparisonView('front')}
          >
            정면
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => onComparisonView('side')}
          >
            옆모습
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => onComparisonView('original')}
          >
            원본 보기
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => onComparisonView('current')}
          >
            현재 시안 보기
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => onComparisonView('proposal')}
          >
            제안 보기
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            disabled={waiting}
            onClick={() => void consult.applyComparison?.()}
          >
            시안에 적용
          </button>
          <button
            type="button"
            className="min-h-9 underline"
            onClick={() => {
              consult.cancelComparison?.()
              input.current?.focus()
            }}
          >
            비교 닫기
          </button>
        </div>
      </section>
    ) : consult.comparison ? (
      <p className="type-caption text-muted-soft">시안이 바뀌었어요. 새 비교를 요청해 주세요.</p>
    ) : null

  function profileEvidence(profileSection: ProfileSection, jawOnly: boolean) {
    return (
      <div {...PRIVATE_TEXT}>
        <details className="type-caption text-muted-soft">
          <summary className="min-h-9 cursor-pointer underline">측정 근거 보기</summary>
          {faceProfile ? <p>현재 시안의 3D에서 잰 값이에요.</p> : null}
          {!faceProfileState &&
            (profileSection === 'overall'
              ? (['overall', 'eyes', 'lips', 'lower', 'side'] as const)
              : [profileSection]
            ).map((section) => {
              const metrics = (faceProfile?.[section] ?? []).filter(
                (metric) => !jawOnly || metric.id === 'jaw-width-face-width',
              )
              if (!metrics.length) return null
              return (
                <div key={section} className="mt-3">
                  <h3 className="mb-1 text-sm font-medium">{PROFILE_SECTIONS[section]}</h3>
                  <ul className="space-y-2">
                    {metrics.map((metric) => (
                      <li key={metric.id ?? metric.label}>
                        <p className="flex justify-between gap-3 text-sm">
                          <span>{metric.label}</span>
                          <strong className="shrink-0">{metric.value}</strong>
                        </p>
                        {originalFaceProfile?.[section]
                          .filter(
                            (original) =>
                              metric.id &&
                              original.id === metric.id &&
                              original.value !== metric.value,
                          )
                          .map((original) => (
                            <p key={original.id ?? original.label}>원본 {original.value}</p>
                          ))}
                        <p className="type-caption text-muted-soft">{metric.method}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          {faceModelId && (profileSection === 'overall' || profileSection === 'eyes') ? (
            <ReviewedProfileRatio key={faceModelId} faceModelId={faceModelId} />
          ) : null}
          {profileSection === 'lower' || profileSection === 'lips' || profileSection === 'side' ? (
            <p className="mt-3 type-caption text-muted-soft">
              촬영할 때의 표정이나 원본 3D에서 입술과 턱의 경계가 잡힌 위치에 따라 값이 달라질 수
              있어요.
            </p>
          ) : null}
          {profileSection === 'lips' ? (
            <p className="mt-3 text-sm text-muted-soft">
              ‘트렌디 볼륨’과 ‘클래식 황금비율’은 개인 판정에 쓰지 않아요.{' '}
              <a
                href="https://pubmed.ncbi.nlm.nih.gov/28318919/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                1:1 선호 연구
              </a>
              와{' '}
              <a
                href="https://pubmed.ncbi.nlm.nih.gov/35666164/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                1:1.6 선호 연구
              </a>
              는 서로 다른 결과를 보고했어요.
            </p>
          ) : null}
          <a
            className="mt-3 inline-block text-sm text-accent underline"
            href="https://www.facebase.org/resources/human/facial_norms/notes/"
            target="_blank"
            rel="noopener noreferrer"
          >
            해부학 기준점 참고 자료
          </a>
          {frontPhoto && !faceProfileState && (originalFaceProfile ?? faceProfile) ? (
            <PhotoProfileEvidence
              key={faceModelId}
              url={frontPhoto}
              profile={originalFaceProfile ?? faceProfile}
              section={profileSection}
            />
          ) : null}
        </details>
      </div>
    )
  }

  return (
    // 휴대폰 시트·PC 카드(-602) 높이를 채우고 입력창은 바닥에 붙는다. 대화·안내만 안에서 스크롤한다
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {history?.newConversation ? (
        <div className="type-caption flex shrink-0 flex-wrap items-center justify-end gap-x-(--space-12)">
          {history.archived ? (
            <span className="mr-auto font-medium text-ink">보관 대화</span>
          ) : null}
          {faceRatioAvailable && items.length > 0 && !history.archived && !directControl ? (
            <button
              type="button"
              disabled={waiting || switching}
              className="min-h-11 text-ink disabled:opacity-40"
              onClick={() =>
                void submit(undefined, { exampleId: 'face-ratio' }, '내 얼굴 비율 분석')
              }
            >
              내 얼굴 비율 분석
            </button>
          ) : null}
          {history.hasArchived ? (
            <button
              type="button"
              disabled={historyBusy || measuringRecommendation}
              onClick={() => {
                setPendingRecommendation(null)
                setSwitchNotice('')
                history.viewConversation?.(!history.archived)
              }}
              className="min-h-11 text-ink-2 disabled:opacity-40"
            >
              {history.archived ? '현재 대화' : '보관 대화'}
            </button>
          ) : null}
          {!history.archived ? (
            <button
              type="button"
              disabled={
                loading || history.loadingOlder || history.starting || measuringRecommendation
              }
              onClick={async () => {
                if (await history.newConversation?.()) {
                  focusNewConversation.current = true
                  setText('')
                  setProfileSection(null)
                  setQuickTurns([])
                  setExploring(false)
                  setShowConditions(false)
                  setGoal('')
                  setKeep('')
                  setPreviewRequest(false)
                  setPendingRecommendation(null)
                  setTransition(null)
                  setSwitchNotice('')
                  onClearDirectControl?.()
                }
              }}
              className="min-h-11 text-ink disabled:opacity-40"
            >
              새 대화
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={chatScroll}
        role="region"
        aria-label="상담 대화"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-(--space-16)"
      >
        {!loading && !history?.archived && !history?.error && items.length ? (
          <ConsultSummary
            key={items[0].id}
            items={items}
            savedWeights={savedWeights}
            catalog={catalog}
          />
        ) : null}
        {/* 대화 전: 빈 칸 가운데에 실장님 인사 한 줄과 예시 칩(메신저 첫 화면 방식, 2026-10-30) */}
        {!loading &&
        !history?.archived &&
        !history?.error &&
        chatItems.length === 0 &&
        !profileSection &&
        !transition &&
        !switchNotice ? (
          <div className="my-auto flex flex-col items-center gap-(--space-8) py-(--space-8) text-center md:gap-(--space-12) md:py-(--space-24)">
            <span className="type-caption inline-flex items-center gap-(--space-6) text-muted-soft">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              AI 실장님
            </span>
            <p className="text-[16px] leading-snug font-medium tracking-[-0.01em] text-ink">
              {directControl ? '어떻게 바꿔 볼까요?' : '어떤 모습이 신경 쓰이세요?'}
            </p>
            {starterProfileNotice ? (
              <p role="status" className="type-caption text-ink-2">
                {starterProfileNotice}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-(--space-6)">
              {faceRatioAvailable && !directControl && !starterProfileNotice ? (
                <button
                  type="button"
                  disabled={waiting || switching}
                  onClick={() =>
                    submit(undefined, { exampleId: 'face-ratio' }, '내 얼굴 비율 분석')
                  }
                  className={STARTER_BUTTON_CLASS}
                >
                  내 얼굴 비율 분석
                </button>
              ) : null}
              {showNextAdjustment && !starterProfileNotice ? (
                <button
                  type="button"
                  disabled={waiting || switching}
                  onClick={askNextAdjustment}
                  className={STARTER_BUTTON_CLASS}
                >
                  {NEXT_ADJUSTMENT_PROMPT}
                </button>
              ) : null}
              {!directControl &&
                examples.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    disabled={waiting || switching}
                    onClick={() =>
                      submit(
                        undefined,
                        {
                          exampleId: previewRequest
                            ? 'consult-preview'
                            : exploring
                              ? 'consult-advice'
                              : example.id,
                        },
                        example.text,
                      )
                    }
                    className={STARTER_BUTTON_CLASS}
                  >
                    {example.text}
                  </button>
                ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <p role="status" className="type-caption pb-(--space-16) text-ink-2">
            대화를 불러오는 중이에요
          </p>
        ) : null}

        {!loading && history?.archived && !history.error && chatItems.length === 0 ? (
          <p className="text-sm text-ink-2">보관된 메시지가 없어요.</p>
        ) : null}

        {history && (history.hasOlder || history.error) ? (
          <div className="type-caption flex flex-col items-center gap-(--space-4) pb-(--space-16)">
            {history.error ? <p role="alert">대화를 불러오지 못했어요.</p> : null}
            <button
              type="button"
              className="min-h-11 rounded-full border border-hairline-strong px-(--space-12) text-ink-2 disabled:opacity-40"
              disabled={historyBusy || switching}
              onClick={history.hasOlder ? history.loadOlder : history.retry}
            >
              {history.loadingOlder
                ? '이전 메시지를 불러오는 중이에요'
                : history.error
                  ? '대화 다시 불러오기'
                  : '이전 메시지 더 보기'}
            </button>
          </div>
        ) : null}

        {chatItems.length ? (
          <ol
            aria-label="상담 내역"
            {...PRIVATE_TEXT}
            className="flex flex-col gap-(--space-16) pb-(--space-20)"
          >
            {chatItems.map((item, index) => {
              const section = item.role === 'assistant' ? item.profileSection : null
              const profileTopic = profileReplyTopic(section)
              const previous = chatItems[index - 1]
              const jawOnly =
                profileTopic !== null &&
                previous?.role === 'user' &&
                isJawObservation(profileTopic, previous.content)
              const next = section?.startsWith('next:') ? section.split(':') : null
              const candidateIds = section?.startsWith('analysis:')
                ? section.split(':')[2]
                : next?.[1]
              const recommendations = [...new Set(candidateIds?.split(',') ?? [])].flatMap((id) => {
                if (jawOnly) return []
                const evidence = faceAdjustmentEvidence(faceProfile, id)
                if (!evidence) return []
                if (profileTopic && !history?.archived && id === 'eyeInner') {
                  if (!eyeInnerOpen) return []
                } else if (profileTopic && !history?.archived) {
                  const control = sliders.find((slider) => slider.id === id)
                  if (
                    !control ||
                    !savedWeights ||
                    !adjustmentChoices(control, savedWeights).length
                  ) {
                    return []
                  }
                }
                return [evidence]
              })
              const content = profileTopic
                ? [
                    item.content.startsWith('원본 3D에서 확인할 수 있는 비율과 측정 기준') ||
                    item.content.startsWith('원본 3D 측정 항목과 참고 자료를 함께 확인해') ||
                    item.content.startsWith('현재 시안에서 확인할 수 있는 비율과 측정 기준') ||
                    item.content.startsWith('현재 시안의 3D 측정 항목과 참고 자료를 함께 확인해')
                      ? ''
                      : item.content,
                    profileReply(
                      profileTopic,
                      faceProfile,
                      faceProfileState,
                      recommendations.length > 0,
                      originalFaceProfile,
                      jawOnly,
                    ),
                  ]
                    .filter(Boolean)
                    .join('\n\n')
                : recommendations.length
                  ? next?.includes('fold')
                    ? '적용한 쌍꺼풀을 유지하면서 비교해 볼 조절이에요.'
                    : ''
                  : next && faceProfileState === 'loading' && next[1] !== 'none'
                    ? '현재 시안의 3D를 확인하고 있어요.'
                    : next?.includes('measured')
                      ? '이 추천의 측정 근거를 지금 확인할 수 없어요.'
                      : item.content
              return (
                <li
                  key={item.id}
                  ref={
                    (next || profileTopic) && item.id === latestChatItemId ? latestAnalysis : null
                  }
                >
                  <ChatBubble
                    item={{ ...item, content }}
                    catalog={catalog}
                    supported={supported}
                    resultSlider={resultSlider}
                    showOptions={
                      item === lastAssistant &&
                      !previewRequest &&
                      !waiting &&
                      !transition &&
                      !switching
                    }
                    onOption={(option) => {
                      const adviceChoice = option.id.startsWith('advice-')
                      const openComparison =
                        adviceChoice && profileSection && onComparisonView && !directControl
                      void send(
                        option.label,
                        {
                          selectedOptionId: option.id,
                          ...(adviceChoice ? { exampleId: 'consult-advice' } : {}),
                        },
                        openComparison
                          ? () => {
                              setExploring(false)
                              setPreviewRequest(true)
                              input.current?.focus()
                            }
                          : undefined,
                      )
                    }}
                  >
                    {next && recommendations.length ? (
                      <p className="text-sm leading-relaxed text-ink">
                        지금 시안을 보니, 아래 조절부터 살펴보시는 걸 추천해요.
                      </p>
                    ) : null}
                    {recommendations.length ? (
                      <ul
                        className={cx(
                          'divide-y divide-hairline',
                          next && 'overflow-hidden rounded-xl border border-hairline',
                        )}
                        aria-label={next ? '다음 조절 후보' : undefined}
                      >
                        {recommendations.map((recommendation) => {
                          const control = sliders.find(({ id }) => id === recommendation.id)
                          const measured = next
                            ? measuredRecommendationDetails(next, recommendation.id)
                            : null
                          const modelCopy = measured
                            ? item.content.split('\n')[measured.index]
                            : undefined
                          const narrative = next?.includes('narrative') ? modelCopy : null
                          const measuredCopy = measured
                            ? measuredRecommendationCopy(recommendation, measured, modelCopy)
                            : null
                          const narrativeSentences = narrative?.split(/(?<=[.!?。！？])\s+/)
                          const observation =
                            narrativeSentences && narrativeSentences.length > 1
                              ? narrativeSentences[0]
                              : null
                          const anchorId = item.id + ':' + recommendation.id
                          const choices =
                            !history?.archived && control && savedWeights
                              ? adjustmentChoices(control, savedWeights)
                              : []
                          const first =
                            onComparisonView &&
                            !profileTopic &&
                            !measured &&
                            choices.find(
                              ({ direction }) => direction === recommendation.firstDirection,
                            )
                          const sliderCode =
                            recommendation.id === 'eyeInner'
                              ? eyeInnerOpen
                                ? 'eye.inner'
                                : undefined
                              : control?.effects[0]?.code
                          const openRecommendation = () => {
                            if (!onOpenSlider || !sliderCode) return
                            if (comparison) consult.cancelComparison?.()
                            const direction = measured?.direction ?? (first || undefined)?.direction
                            if (direction && control && measureTrial && savedWeights) {
                              const before =
                                recommendation.evidence.rawRatio ?? recommendation.ratio
                              // 예전 추천을 열 때는 저장된 계측과 같은 미리보기만 연다.
                              const steps = measured
                                ? [RECOMMENDATION_STEP, 10]
                                : [RECOMMENDATION_STEP]
                              for (const step of steps) {
                                const choice = adjustmentChoices(control, savedWeights, step).find(
                                  (candidate) => candidate.direction === direction,
                                )
                                if (!choice) continue
                                const changes = noseControlChanges(control, choice.target / 100)
                                const trial = faceAdjustmentEvidence(
                                  measureTrial(changes),
                                  recommendation.id,
                                )
                                const after = trial?.evidence.rawRatio ?? trial?.ratio
                                if (
                                  after !== undefined &&
                                  Math.abs(after - before) >= 0.00001 &&
                                  (!measured ||
                                    (Math.abs(measured.before - before) < 0.00001 &&
                                      Math.abs(measured.after - after) < 0.00001))
                                ) {
                                  onOpenSlider(sliderCode, {
                                    preview: { changes },
                                  })
                                  return
                                }
                              }
                            }
                            onOpenSlider(sliderCode, {})
                          }
                          const angle = recommendation.view === 'side' ? '옆모습' : '정면'
                          const guidance = recommendationGuidance(
                            recommendation,
                            recommendation.id === 'eyeInner'
                              ? eyeDirections
                              : first
                                ? [first.direction]
                                : choices.map(({ direction }) => direction),
                          )
                          const suggestion = observation
                            ? narrativeSentences?.slice(1).join(' ')
                            : (narrative ??
                              measuredCopy?.suggestion ??
                              guidance.direction ??
                              guidance.goal)
                          const action = measuredCopy?.action ?? guidance.direction
                          const actionStart = action ? (suggestion?.indexOf(action) ?? -1) : -1
                          const actions = (
                            <>
                              {choices.length &&
                              !comparison &&
                              !measured &&
                              (!next || recommendation.id !== 'projection') &&
                              (!next || first)
                                ? comparisonButtons(
                                    recommendation.id,
                                    anchorId,
                                    recommendation.view,
                                    first ? first.direction : undefined,
                                  )
                                : null}
                              <div className="flex flex-wrap items-start gap-x-4">
                                {!history?.archived ? (
                                  <button
                                    type="button"
                                    aria-label={
                                      measured ? undefined : recommendation.label + ' 직접 조절하기'
                                    }
                                    className="type-caption min-h-11 font-medium text-ink underline underline-offset-2 disabled:opacity-40"
                                    disabled={waiting || switching || !sliderCode || !onOpenSlider}
                                    onClick={openRecommendation}
                                  >
                                    {measured
                                      ? `${control?.group ?? recommendation.label} 직접 조절하기`
                                      : '직접 조절하기'}{' '}
                                    <span aria-hidden>→</span>
                                  </button>
                                ) : null}
                                <details className="type-caption text-muted-soft open:basis-full">
                                  <summary
                                    className="min-h-11 cursor-pointer content-center underline underline-offset-2"
                                    aria-label={recommendation.label + ' 근거 보기'}
                                  >
                                    근거 보기
                                  </summary>
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-baseline gap-x-2">
                                      <span>{recommendation.evidence.label}</span>
                                      <strong className="text-ink">
                                        {measured
                                          ? formatTrialChange(
                                              measured.before,
                                              measured.after,
                                              recommendation.view === 'side',
                                            )
                                          : recommendation.evidence.value}
                                      </strong>
                                    </div>
                                    <p>{recommendation.evidence.method}</p>
                                    <p>{recommendation.source.note}</p>
                                    <a
                                      href={recommendation.source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline"
                                    >
                                      {recommendation.source.label}
                                    </a>
                                  </div>
                                </details>
                              </div>
                            </>
                          )
                          return (
                            <li
                              key={recommendation.id}
                              className={next ? undefined : 'space-y-(--space-6) py-(--space-12)'}
                            >
                              {next ? (
                                <details
                                  name={item.id + ':recommendations'}
                                  className="group"
                                  onToggle={({ currentTarget: candidate, target }) => {
                                    const scroll = chatScroll.current
                                    if (!scroll || target !== candidate || !candidate.open) return

                                    const bounds = scroll.getBoundingClientRect()
                                    const title = candidate.getBoundingClientRect()
                                    const action = candidate.lastElementChild
                                      ?.querySelector('button, summary')
                                      ?.getBoundingClientRect()
                                    if (title.top < bounds.top) {
                                      scroll.scrollTop += Math.floor(title.top - bounds.top)
                                    } else if (action && action.bottom > bounds.bottom) {
                                      scroll.scrollTop += Math.ceil(action.bottom - bounds.bottom)
                                    }
                                  }}
                                >
                                  <summary
                                    aria-label={recommendation.label + ' 비교 옵션'}
                                    aria-describedby={anchorId + ':summary'}
                                    className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-1 text-ink hover:bg-ink/5 focus-visible:outline focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden"
                                  >
                                    <span className="min-w-0">
                                      <span className="block text-sm font-semibold">
                                        {recommendation.part}-
                                        {first && control
                                          ? `${control.group} ${control.ends[first.direction < 0 ? 0 : 1]}`
                                          : recommendation.label}
                                      </span>
                                      <span
                                        id={anchorId + ':summary'}
                                        className="type-caption block text-ink-2"
                                      >
                                        {angle} - {recommendation.summary}
                                      </span>
                                    </span>
                                    <Icon
                                      name="CaretRight"
                                      size={14}
                                      className="shrink-0 group-open:rotate-90"
                                    />
                                  </summary>
                                  <div className="space-y-2 border-t border-hairline px-3 pt-2 pb-1">
                                    <dl className="space-y-2 text-sm leading-relaxed text-ink">
                                      {observation || !measuredCopy ? (
                                        <div>
                                          <dt className="type-caption mb-1 font-semibold text-ink-2">
                                            현재 모습
                                          </dt>
                                          <dd>{observation ?? guidance.analysis}</dd>
                                        </div>
                                      ) : null}
                                      <div>
                                        <dt className="type-caption mb-1 w-fit rounded-4 bg-brand-lavender-tint px-2 py-0.5 font-semibold text-brand-violet-text">
                                          추천 조절
                                        </dt>
                                        <dd>
                                          {suggestion && action && actionStart >= 0 ? (
                                            <>
                                              {suggestion.slice(0, actionStart)}
                                              <strong>{action}</strong>
                                              {suggestion.slice(actionStart + action.length)}
                                            </>
                                          ) : (
                                            suggestion
                                          )}
                                        </dd>
                                        {!narrative && measuredCopy ? (
                                          <dd>{measuredCopy.effect}</dd>
                                        ) : null}
                                      </div>
                                    </dl>
                                    {actions}
                                  </div>
                                </details>
                              ) : (
                                <>
                                  <h3 className="text-sm font-semibold text-ink">
                                    {recommendation.label}
                                  </h3>
                                  {actions}
                                </>
                              )}
                              {comparison?.anchorId === anchorId ? comparisonCardContent : null}
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                    {profileTopic ? profileEvidence(profileTopic, jawOnly) : null}
                    {(comparison?.anchorId ?? comparison?.messageId) === item.id
                      ? comparisonCardContent
                      : null}
                  </ChatBubble>
                  {item === lastAssistant &&
                  item.intent === 'REPLY' &&
                  item.comparisonCode &&
                  !history?.archived &&
                  (exploring || Boolean(profileSection)) &&
                  !consult.comparison &&
                  !recovery &&
                  !directControl &&
                  onComparisonView
                    ? (comparisonButtons(item.comparisonCode, item.id) ??
                      (!previewRequest ? (
                        <button
                          type="button"
                          disabled={waiting || switching}
                          className="type-caption mt-2 min-h-11 rounded-full border border-hairline-strong px-3 text-ink disabled:opacity-40"
                          onClick={() => {
                            setExploring(false)
                            setPreviewRequest(true)
                            input.current?.focus()
                          }}
                        >
                          비교할 변화 입력하기
                        </button>
                      ) : null))
                    : null}
                </li>
              )
            })}
            {busy ? (
              // 입력 중 점 세 개(메신저 방식). 문구는 읽기 프로그램에만
              <li className="flex items-center gap-(--space-4) py-(--space-6)" aria-live="polite">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    aria-hidden
                    className="size-1.5 rounded-full bg-muted-soft motion-safe:animate-bounce"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
                <span className="sr-only">AI 실장님이 살펴보는 중이에요</span>
              </li>
            ) : null}
          </ol>
        ) : null}

        {recovery && !busy && !transition && !switching ? (
          <details
            key={`${lastAssistant?.id ?? ''}:${recovery}`}
            className="type-caption mb-(--space-12) text-muted-soft"
          >
            <summary className="w-fit cursor-pointer rounded-full border border-hairline-strong px-(--space-12) py-(--space-6) text-ink">
              {recovery === 'retry' ? '요청 상태 확인 방법' : '가능한 다음 조절 보기'}
            </summary>
            <p className="mt-(--space-6)">{recoveryText}</p>
            {recovery !== 'retry' ? (
              <p className="mt-(--space-2)">
                {sliderPartsNotice(catalog, supportedSliderCodes, eyeSliderAvailable)}
              </p>
            ) : null}
          </details>
        ) : null}
        {transition ? (
          <div
            role="group"
            aria-label="조절 모드 전환 확인"
            className="mb-(--space-12) rounded-(--pf-radius-lg) border border-hairline bg-surface p-(--space-12)"
          >
            <p className="type-caption text-ink">
              전환하면 {transition.clears} 조절값이 원본으로 돌아가요.
              {transition.command.followUp ? ' 전환한 뒤 요청한 조절을 적용할게요.' : ''}
            </p>
            <div className="mt-(--space-8) flex flex-wrap gap-(--space-8)">
              <button
                type="button"
                disabled={busy || switching}
                onClick={() => void confirmTransition()}
                className="min-h-[34px] rounded-full border border-hairline-strong px-(--space-12) text-[13px] text-ink disabled:opacity-40"
              >
                {switching ? '전환 중' : '전환하기'}
              </button>
              <button
                type="button"
                disabled={switching}
                onClick={() => {
                  setTransition(null)
                  setSwitchNotice('전환을 취소했어요. 조절값은 그대로예요.')
                }}
                className="min-h-[34px] rounded-full px-(--space-12) text-[13px] text-muted-soft disabled:opacity-40"
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
        {switchNotice || measuringRecommendation ? (
          <p role="status" className="type-caption pb-(--space-12) text-muted-soft">
            {switchNotice || '현재 시안에서 조절 전후를 확인하고 있어요.'}
          </p>
        ) : null}
      </div>

      {/* 입력창(2026-10-30): 메신저처럼 둥근 칸 하나 안에 글과 보내기 아이콘 */}
      {exploring && !directControl && !history?.archived ? (
        <div className="type-caption mb-2 flex shrink-0 flex-col gap-2">
          <button
            type="button"
            className="min-h-8 self-start underline"
            aria-expanded={showConditions}
            onClick={() => {
              if (!showConditions) {
                setGoal(savedGoal)
                setKeep(savedKeep)
              }
              setShowConditions(!showConditions)
            }}
          >
            상담 목표와 유지할 부위
          </button>
          {showConditions ? (
            <form
              className="grid gap-2"
              onSubmit={async (event) => {
                event.preventDefault()
                if (waiting || switching || !goal.trim()) return
                const message = `상담 목표: ${goal.trim()}${keep.trim() ? ` / 유지할 부위: ${keep.trim()}` : ''}`
                if (await send(message, { exampleId: 'consult-advice' })) setShowConditions(false)
              }}
            >
              <label className="grid gap-1">
                상담에서 원하는 변화
                <input
                  className="min-h-8 rounded border border-hairline px-2"
                  {...PRIVATE_TEXT}
                  value={goal}
                  maxLength={120}
                  onChange={(event) => setGoal(event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                유지할 부위
                <input
                  className="min-h-8 rounded border border-hairline px-2"
                  {...PRIVATE_TEXT}
                  value={keep}
                  maxLength={120}
                  onChange={(event) => setKeep(event.target.value)}
                />
              </label>
              <button
                type="submit"
                className="min-h-8 self-start underline disabled:opacity-40"
                disabled={waiting || switching || !goal.trim()}
              >
                이 조건으로 상담하기
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
      <form
        hidden={history?.archived}
        onSubmit={(event) => submit(event)}
        className={`shrink-0 flex-col pt-(--space-8) ${history?.archived ? '' : 'flex'}`}
      >
        <div className="mb-(--space-6) flex flex-wrap items-center gap-x-(--space-8) gap-y-(--space-2) empty:hidden">
          {exploring && !directControl && !history?.archived ? (
            <button
              type="button"
              disabled={waiting || switching}
              className="type-caption min-h-9 rounded-full border border-hairline px-(--space-12) text-ink"
              onClick={() => {
                setExploring(false)
                input.current?.focus()
              }}
            >
              고민 상담 끝내기
            </button>
          ) : null}
          {!directControl && !history?.archived && previewRequest ? (
            <button
              type="button"
              aria-pressed={previewRequest}
              disabled={waiting || switching}
              className="type-caption min-h-9 rounded-full border border-hairline px-(--space-12) text-ink disabled:opacity-40"
              onClick={() => {
                setPreviewRequest(false)
                consult.cancelComparison?.()
                input.current?.focus()
              }}
            >
              저장 없이 비교 중 · 끝내기
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="type-caption pb-(--space-10) text-(--pf-danger)">
            {error}
          </p>
        ) : null}

        {directControl ? (
          <div className="type-caption mb-(--space-6) flex items-center gap-(--space-6)">
            <span>선택한 조절 · {directControl.label}</span>
            <button
              type="button"
              aria-label="선택한 조절 지우기"
              className="min-h-8 rounded-full px-(--space-8) text-muted-soft hover:bg-ink/5"
              onClick={onClearDirectControl}
            >
              지우기
            </button>
          </div>
        ) : null}
        <label htmlFor={inputId} className="sr-only">
          원하는 변화
        </label>
        <div className="flex items-end gap-(--space-6) rounded-[18px] border border-hairline-strong bg-surface py-(--space-4) pr-(--space-4) pl-(--space-12) shadow-[0_1px_2px_oklch(0.2_0.01_286/0.04)] transition-[border-color,box-shadow] duration-(--pf-dur-ui) focus-within:border-ink/40 focus-within:shadow-[0_0_0_4px_oklch(0.2_0.01_286/0.05)]">
          <textarea
            ref={input}
            id={inputId}
            {...PRIVATE_TEXT}
            value={text}
            rows={1}
            onChange={(event) => setText(event.target.value.slice(0, CONTENT_MAX))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!busy && text.trim()) void submit()
              }
            }}
            placeholder={
              directControl
                ? '선택한 항목을 어떻게 바꿀까요?'
                : previewRequest
                  ? '비교해 보고 싶은 변화를 적어 주세요'
                  : exploring
                    ? '신경 쓰이는 부분을 편하게 적어 주세요'
                    : '궁금한 점이나 원하는 변화를 적어 주세요'
            }
            maxLength={CONTENT_MAX}
            disabled={inputLocked}
            aria-describedby={text.length >= CONTENT_MAX - 30 ? `${inputId}-count` : undefined}
            className="field-sizing-content max-h-[72px] min-h-10 min-w-0 flex-1 resize-none bg-transparent py-(--space-8) text-[14px] leading-[1.45] text-ink placeholder:text-faint focus:outline-none sm:max-h-[120px]"
          />
          <button
            type="submit"
            aria-label="AI 실장님께 보내기"
            disabled={waiting || switching || !text.trim()}
            className="inline-flex size-9 shrink-0 items-center justify-center self-center rounded-full bg-ink text-on-ink transition-[background-color,transform,opacity] duration-(--pf-dur-ui) ease-(--pf-ease-out) hover:bg-[oklch(0.28_0.01_286)] active:scale-95 disabled:opacity-25"
          >
            <Icon name="PaperPlaneTilt" weight="fill" size={17} />
          </button>
        </div>
        <div className="type-caption mt-(--space-4) flex items-center justify-between pr-(--space-4) text-faint">
          <a href={FEEDBACK_HREF} className="underline underline-offset-2">
            상담 결과가 의도와 달라요
          </a>
          {text.length >= CONTENT_MAX - 30 ? (
            <span id={`${inputId}-count`} className="tabular-nums">
              {text.length} / {CONTENT_MAX}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  )
}

function profileReplyTopic(section?: string | null): ProfileSection | null {
  const topic = section?.startsWith('analysis:') ? section.split(':')[1] : section
  return topic && Object.hasOwn(PROFILE_SECTIONS, topic) ? (topic as ProfileSection) : null
}

function isJawObservation(section: ProfileSection, question: string) {
  return (
    section === 'lower' &&
    /턱선|아래턱|사각턱/.test(question) &&
    !/인중|턱끝|하안부|전체|비교|추천|제안/.test(question)
  )
}

function profileReply(
  section: ProfileSection,
  profile?: FaceProfile | null,
  state?: 'loading' | 'unavailable',
  hasComparisons = false,
  original?: FaceProfile | null,
  jawOnly = false,
) {
  if (state === 'loading') return '현재 시안의 3D를 확인하고 있어요.'
  if (state === 'unavailable')
    return '현재 시안을 분석할 3D를 불러오지 못했어요. 새로고침한 뒤 다시 확인해 주세요.'
  const metrics =
    section === 'overall'
      ? Object.values(profile ?? {}).flat()
      : (profile?.[section] ?? []).filter((item) => !jawOnly || item.id === 'jaw-width-face-width')
  if (!metrics.length) return '현재 시안에 이 부위를 살펴볼 기준점이 충분하지 않아요.'

  const measure = (id: string) =>
    Number.parseFloat(metrics.find((metric) => metric.id === id)?.value ?? '')
  const observations: string[] = []
  const eyes = measure('intercanthal-outer-eye-width')
  if (Number.isFinite(eyes)) {
    const span = eyes === 0.5 ? '절반 정도예요' : eyes < 0.5 ? '절반보다 좁아요' : '절반보다 넓어요'
    observations.push(`정면에서 눈머리 사이 간격은 양쪽 바깥 눈꼬리 사이 너비의 ${span}.`)
  }
  const height = measure('eye-to-chin-face-width')
  if (Number.isFinite(height)) {
    const span = height === 1 ? '폭과 비슷해요' : height < 1 ? '폭보다 짧아요' : '폭보다 길어요'
    observations.push(`눈꼬리 높이부터 턱끝까지는 얼굴의 가로 ${span}.`)
  }
  const upperLip = measure('upper-lip-profile-line')
  const lowerLip = measure('lower-lip-profile-line')
  const side = Number.isFinite(upperLip) ? upperLip : lowerLip
  if (Number.isFinite(side)) {
    const location = side === 0 ? '선에 가까워요' : `선의 ${side > 0 ? '앞' : '뒤'}에 있어요`
    observations.push(
      `옆모습에서 ${Number.isFinite(upperLip) ? '윗입술' : '아랫입술'}은 코끝과 턱끝을 이은 ${location}.`,
    )
  }
  const lips = measure('lower-upper-vermilion-height')
  if (Number.isFinite(lips)) {
    observations.push(
      lips === 1
        ? '입술 중앙에서 보이는 윗입술과 아랫입술의 높이가 비슷해요.'
        : `입술 중앙의 붉은 부분은 ${lips > 1 ? '아랫입술' : '윗입술'}이 더 높게 측정됐어요.`,
    )
  }
  const jaw = measure('jaw-width-face-width')
  if (Number.isFinite(jaw)) {
    observations.push(
      jaw === 1
        ? '정면에서 아래턱 폭과 얼굴 양옆 너비가 비슷해요.'
        : `정면에서 아래턱 폭은 얼굴 양옆 너비보다 ${jaw < 1 ? '좁아요' : '넓어요'}.`,
    )
  }
  for (const [id, subject] of [
    ['nose-length-nose-to-chin', '코 시작점부터 턱끝까지의 세로 길이에서 코가'],
    ['mouth-width-face-width', '얼굴의 가로 폭에서 입술 너비가'],
    ['philtrum-nose-base-to-chin', '코밑부터 턱끝까지의 세로 길이에서 인중이'],
  ]) {
    const value = measure(id)
    if (Number.isFinite(value))
      observations.push(`${subject} 약 ${Math.round(value * 100)}%를 차지해요.`)
  }
  const summary = observations.length
    ? observations.slice(0, 3)
    : ['현재 시안에서 잰 값과 측정 방법을 근거 보기에 정리했어요.']
  const originalMetrics = Object.values(original ?? {}).flat()
  const change = metrics.find((item) =>
    originalMetrics.some(
      (before) => item.id && before.id === item.id && before.value !== item.value,
    ),
  )
  const previous = originalMetrics.find((before) => change && before.id === change.id)
  return [
    ...(previous && change
      ? [`원본과 비교하면 ${change.label} 값이 ${previous.value}에서 ${change.value}로 달라졌어요.`]
      : []),
    ...summary,
    ...(hasComparisons
      ? ['이 특징을 직접 살펴보고 싶다면, 아래 조절부터 비교해 볼 수 있어요.']
      : []),
  ].join('\n\n')
}

type ResultSlider = {
  codeFor: (codes: readonly string[]) => string | undefined
  open: (code: string) => void
}

function ChatBubble({
  item,
  catalog,
  supported,
  resultSlider,
  showOptions,
  onOption,
  children,
}: {
  item: ChatItem
  children?: ReactNode
  catalog: MorphParameterCatalog | null
  supported?: Record<string, { min: number; max: number }>
  resultSlider?: ResultSlider
  showOptions: boolean
  onOption: (option: { id: string; label: string }) => void
}) {
  if (item.role === 'user') {
    return (
      <p
        className={cx(
          'ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-[6px] bg-ink px-(--space-14) py-(--space-8) text-[14px] leading-[1.5] text-on-ink',
          item.sending && 'opacity-60',
        )}
      >
        {item.content}
      </p>
    )
  }

  if (item.applyResult) {
    return (
      <RequestCard
        result={item.applyResult}
        catalog={catalog}
        supported={supported}
        resultSlider={resultSlider}
      />
    )
  }

  const citation = item.content.match(
    /^([\s\S]*) 출처: (https:\/\/(?:pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/|pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/|www\.facebase\.org\/resources\/human\/facial_norms\/notes\/))(?:, (https:\/\/(?:pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/|pmc\.ncbi\.nlm\.nih\.gov\/articles\/PMC\d+\/)))?$/,
  )

  return (
    // 실장님 답은 말풍선 없이 왼쪽 글로. 이름은 작은 보라 점 + 캡션
    <div className="flex max-w-[92%] flex-col gap-(--space-6)">
      <p className="type-caption flex items-center gap-(--space-6) text-muted-soft">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        AI 실장님
      </p>
      {item.content ? (
        <div className="flex flex-col gap-(--space-8) text-[14px] leading-relaxed text-ink">
          {(citation ? citation[1] : item.content).split(/\n[ \t]*\n+/).map((paragraph, index) => (
            <p key={index} className="whitespace-pre-line [overflow-wrap:anywhere]">
              {paragraph}
            </p>
          ))}
          {citation ? (
            <div className="flex flex-wrap gap-x-(--space-12)">
              {[citation[2], citation[3]].filter(Boolean).map((source, index) => (
                <a
                  key={index}
                  className="inline-flex min-h-8 items-center text-accent underline underline-offset-2"
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {citation[3] ? '출처 ' + (index + 1) : '출처 보기'}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
      {showOptions && item.options?.length ? (
        <div
          className="flex flex-wrap gap-(--space-4) pt-(--space-2)"
          role="group"
          aria-label="답변 고르기"
        >
          {item.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onOption(option)}
              className="inline-flex min-h-11 items-center rounded-full border border-hairline-strong px-(--space-12) text-[13px] text-ink transition-colors duration-(--pf-dur-ui) hover:border-ink"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 카드와 변경내역에 동일한 사용자 조절 항목을 표시한다. */
export function visibleApplyRows(
  result: ApplyResult,
  catalog: MorphParameterCatalog | null,
  supported?: Record<string, { min: number; max: number }>,
) {
  const applied =
    result.eyeBefore && result.eyeAfter
      ? result.applied.filter((change) => !change.code.startsWith('eye.'))
      : result.applied
  const lowerChanges = applied.filter(
    (change) => change.code === TIP_HEIGHT_CODE || change.code === TIP_ROTATION_CODE,
  )
  const lower =
    catalog && isTipLowerPair(lowerChanges)
      ? [
          noseControls(
            catalog,
            Object.fromEntries(lowerChanges.map((change) => [change.code, change.from])),
          )[2],
          noseControls(
            catalog,
            Object.fromEntries(lowerChanges.map((change) => [change.code, change.to])),
          )[2],
        ]
      : null
  const groupedLower = lower && lower.every((control) => !control.unavailable && !control.mixed)
  const noseRows = orderByCatalog(catalog, applied, (change) => change.code).flatMap((change) => {
    if (groupedLower && change.code === TIP_ROTATION_CODE) return []
    if (groupedLower && change.code === TIP_HEIGHT_CODE) {
      return [
        {
          label: '코끝 위아래',
          codes: lowerChanges.map((item) => item.code),
          value: describeChange({ from: lower[0].value, to: lower[1].value }),
          limited: lowerChanges.some((item) => item.limited),
        },
      ]
    }
    return [
      {
        label: labelOf(catalog, change.code),
        codes: [change.code],
        value:
          change.code === WEIGHT_SHAPE_CODE
            ? `${weightShapeStrengthLabel(displayWeight(change.from, supported?.[change.code]))} → ${weightShapeStrengthLabel(displayWeight(change.to, supported?.[change.code]))}`
            : describeChange({
                from: displayWeight(change.from, supported?.[change.code]),
                to: displayWeight(change.to, supported?.[change.code]),
              }),
        limited: change.limited,
      },
    ]
  })
  return { rows: [...noseRows, ...eyeApplyRows(result)] }
}

function eyeApplyRows(result: ApplyResult) {
  if (!result.eyeBefore || !result.eyeAfter) return []
  const beforeState = result.eyeBefore
  const afterState = result.eyeAfter
  const labels: Record<Exclude<EyeControl, 'crease'>, string> = {
    height: '쌍꺼풀 높이',
    inner: '앞트임',
    outer: '뒤트임',
    upper: '윗트임',
    lower: '밑트임',
  }
  const rows: { label: string; codes: string[]; value: string; limited: boolean }[] = []
  const sides: EyeSide[] = ['L', 'R']
  const styleLabel = (enabled: boolean, style: 'inline' | 'inout' | 'outline') =>
    enabled ? { inline: '인라인', inout: '인아웃', outline: '아웃라인' }[style] : '없음'
  const percent = (value: number, key: string) => {
    const max = result.eyeLimits?.[key]
    return max && max > 0 ? `${Math.round((value / max) * 100)}%` : `${Math.round(value)} / 100`
  }
  const add = (
    code: string,
    label: string,
    values: Record<EyeSide, [string, string]>,
    changed: EyeSide[],
  ) => {
    if (!changed.length) return
    if (changed.length === 2 && values.L.join(' → ') === values.R.join(' → ')) {
      rows.push({ label, codes: [code], value: values.L.join(' → '), limited: false })
      return
    }
    for (const side of changed) {
      rows.push({
        label: `${screenEyeLabel(side)} ${label}`,
        codes: [`${code}.${side}`],
        value: values[side].join(' → '),
        limited: false,
      })
    }
  }
  add(
    'eye.style',
    '쌍꺼풀 모양',
    {
      L: [
        styleLabel(beforeState.L.enabled, beforeState.L.style),
        styleLabel(afterState.L.enabled, afterState.L.style),
      ],
      R: [
        styleLabel(beforeState.R.enabled, beforeState.R.style),
        styleLabel(afterState.R.enabled, afterState.R.style),
      ],
    },
    sides.filter(
      (side) =>
        beforeState[side].enabled !== afterState[side].enabled ||
        beforeState[side].style !== afterState[side].style,
    ),
  )
  for (const control of ['height', 'inner', 'outer', 'upper', 'lower'] as const) {
    add(
      `eye.${control}`,
      labels[control],
      {
        L: [
          percent(
            beforeState.L.values[control],
            control === 'height' ? `${beforeState.L.style}:height` : control,
          ),
          percent(
            afterState.L.values[control],
            control === 'height' ? `${afterState.L.style}:height` : control,
          ),
        ],
        R: [
          percent(
            beforeState.R.values[control],
            control === 'height' ? `${beforeState.R.style}:height` : control,
          ),
          percent(
            afterState.R.values[control],
            control === 'height' ? `${afterState.R.style}:height` : control,
          ),
        ],
      },
      sides.filter(
        (side) => beforeState[side].values[control] !== afterState[side].values[control],
      ),
    )
  }
  return rows
}

function RequestCard({
  result,
  catalog,
  supported,
  resultSlider,
}: {
  result: ApplyResult
  catalog: MorphParameterCatalog | null
  supported?: Record<string, { min: number; max: number }>
  resultSlider?: ResultSlider
}) {
  const { rows } = visibleApplyRows(result, catalog, supported)
  const controls = availableSliders(catalog)
  const actions = rows.flatMap((row) => {
    const slider = resultSlider?.codeFor(row.codes)
    return slider ? [{ slider, label: row.label }] : []
  })
  return (
    <section aria-label="3D 반영 결과" className="flex max-w-[92%] flex-col gap-(--space-6)">
      <p className="type-caption flex items-center gap-(--space-6) text-muted-soft">
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        AI 실장님
      </p>
      <div className="flex flex-col gap-(--space-6) text-sm leading-relaxed text-ink">
        {rows.length
          ? rows.map((row) => {
              const [before, after] = row.value.split(' → ')
              const code = row.codes[0]
              const control = controls.find(({ effects }) => effects[0]?.code === code)
              const wording = SLIDER_EXAMPLES.find((example) => example.control === control?.id)
              const change = result.applied.find((entry) => entry.code === code)
              const delta =
                change && control ? (change.to - change.from) / control.effects[0].gain : 0
              const eyeDelta = Number.parseFloat(after ?? '') - Number.parseFloat(before)
              const text =
                wording &&
                delta &&
                control?.id !== 'weightShape' &&
                (control?.id !== 'lower' || row.codes.length === 2)
                  ? (delta < 0 ? wording.down : wording.up)
                      .replace(/ (?:좀|조금|살짝) /, ' ')
                      .replace(/줘$/, '드렸어요.')
                  : code.startsWith('eye.style') && after
                    ? after === '없음'
                      ? `${row.label.replace(/ 모양$/, '')}을 없앴어요.`
                      : `${row.label}을 ${after} 스타일로 바꿨어요.`
                    : code.startsWith('eye.') && eyeDelta
                      ? code.startsWith('eye.height')
                        ? `${row.label}를 ${eyeDelta > 0 ? '높였어요' : '낮췄어요'}.`
                        : `${row.label}을 ${eyeDelta > 0 ? '넓혔어요' : '줄였어요'}.`
                      : `${row.label} 조절을 시안에 반영했어요.`
              return <p key={code}>{text}</p>
            })
          : !result.skipped.length && <p>{result.summary}</p>}
        {result.limited || rows.some((row) => row.limited) ? (
          <p>조절 범위 끝에 닿은 항목은 가능한 범위까지만 반영했어요.</p>
        ) : null}
        {result.skipped.map((clause) => (
          <p key={clause.source} className="text-ink-2">
            {clause.source} 요청은 반영하지 않았어요. {clause.reason}
          </p>
        ))}
      </div>
      {resultSlider && actions.length ? (
        <div className="flex flex-wrap gap-x-(--space-12)">
          {actions.map(({ slider, label }) => (
            <button
              key={label}
              type="button"
              aria-label={`${label} 직접 조절하기`}
              className="type-caption min-h-11 font-medium text-ink underline underline-offset-2"
              onClick={() => resultSlider.open(slider)}
            >
              {actions.length > 1 ? label + ' ' : ''}직접 조절하기 <span aria-hidden>→</span>
            </button>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        <details className="type-caption text-ink-2">
          <summary className="min-h-8 cursor-pointer">조절값 보기</summary>
          <dl className="flex flex-col gap-(--space-4)">
            {rows.map((row) => (
              <div key={row.codes[0]} className="flex flex-wrap justify-between gap-x-(--space-12)">
                <dt>{row.label}</dt>
                <dd className="pf-mono">
                  {row.value}
                  {row.limited ? ' · 조절 한계' : ''}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  )
}
