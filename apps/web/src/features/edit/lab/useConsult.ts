'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isDefaultEyes } from '../eyes/state'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import {
  applyChangeRequest,
  getConsultMessages,
  previewChangeRequest,
  sendConsultMessage,
  startConsultConversation,
} from '../api'
import { isLockedCode } from '../editLogic'
import { feedbackToast } from '../feedbackToast'
import { useEditStore } from '../store'
import type {
  ApplyResult,
  ApplyChangeRequestResult,
  ChangeRequest,
  ConsultIntent,
  ConsultMessage,
  ConsultOption,
  SendMessageBody,
  SendMessageResult,
} from '../types'
import type { SimulationEditor } from '../useSimulationEditor'
import { WEIGHT_CONTOUR_REJECTED, WEIGHT_SHAPE_CODE } from '../weightShapeControls'

/**
 * AI 실장님 상담(API-CON-01·02)과 변경 요청 반영(API-EDIT-05).
 *
 * 명세서 v3.1 "반영 방식": CON-01이 `COMPLETE` 변경 요청을 주면 **확인 버튼 없이** EDIT-05를 이어서 부른다.
 * 되묻기(CLARIFY)·답변(REPLY)만 있으면 부르지 않는다. UNDO·REDO·RESET은 `morphResult`로 3D를 맞춘다.
 * 성공 문구·변경 카드·슬라이더·After는 EDIT-05 응답의 실제값으로 만든다.
 */

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  intent?: ConsultIntent | null
  options?: ConsultOption[]
  applyResult?: ApplyResult | null
  /** 반영 카드에 인용할 사용자 문장 */
  requestText?: string
  /** 아직 서버 응답 전 */
  sending?: boolean
  recovery?: ConsultRecovery
  comparisonCode?: string
  profileSection?: string | null
  previewed?: boolean
}

export type ConsultRecovery = 'limit' | 'unsupported' | 'mode' | 'retry' | 'unapplied'

export function consultRecovery(item: ChatItem | undefined): ConsultRecovery | undefined {
  if (!item) return undefined
  if (item.recovery) return item.recovery
  if (item.applyResult?.limited) return 'limit'
  if (item.intent !== 'REPLY') return undefined
  if (
    /먼저 조절 모드를 전환|체중 변화는 눈·코·윤곽과 따로|다른 부위의 편집이 있어 체중 변화/.test(
      item.content,
    )
  ) {
    return 'mode'
  }
  if (/현재 조절 한계에서|안전한 마지막 값/.test(item.content)) return 'limit'
  if (
    /현재 시안에서는 해당 조절을 할 수 없|해당 부위를 아직 조절할 수 없|해당 부위는 아직 조절할 수 없|이 모델에서는 눈 슬라이더를 사용할 수 없|해당 눈 조절은 아직 사용할 수 없|해당 눈 조절을 사용할 수 없|그 눈 조절은 아직 제공하지 않|조절 변형이 확인되지 않아|현재 열린 얼굴 조절이 없/.test(
      item.content,
    )
  ) {
    return 'unsupported'
  }
}

export const CONTENT_MAX = 300

/**
 * 반영되지 않은 채 남은 변경 요청인지. EDIT_030으로 거절되면 CON-02에 `COMPLETE`·`applyResult: null`로 남는다
 * (명세서 v3.2 API-EDIT-05 비고).
 */
function isUnappliedChange(m: ConsultMessage): boolean {
  return !m.needsClarification && m.changeRequest?.status === 'COMPLETE' && !m.applyResult
}

/** 반영하지 못한 요청에서도 서버가 기록한 미지원 구절과 이유를 보존한다. */
function unappliedMessage(
  changeRequest: Pick<ChangeRequest, 'actions' | 'skipped'> | null,
  serverMessage?: string,
): string {
  const base = serverMessage ?? '이 요청은 3D에 반영되지 않았어요.'
  const skipped = changeRequest?.skipped.map(({ source, reason }) => `${source}: ${reason}`) ?? []
  return skipped.length ? `${base} 미적용: ${skipped.join(' / ')}` : base
}

/** CON-02 내역을 화면 항목으로. 반영 카드에는 바로 앞 사용자 문장을 인용한다 */
export function toChatItems(messages: ConsultMessage[]): ChatItem[] {
  let lastUser = ''
  return messages.map((m) => {
    if (m.role === 'USER') {
      lastUser = m.content
      return { id: m.messageId, role: 'user', content: m.content }
    }
    return {
      id: m.messageId,
      role: 'assistant',
      // 반영되지 않은 요청에 "바꿔 볼게요" 같은 답이 남아 있어도 미적용 안내로 보인다(성공 문구 금지)
      content: isUnappliedChange(m) ? unappliedMessage(m.changeRequest) : m.content,
      intent: m.intent,
      options: m.needsClarification ? m.options : [],
      comparisonCode: m.comparisonCode ?? undefined,
      profileSection: m.profileSection,
      applyResult: m.applyResult,
      recovery: isUnappliedChange(m) ? 'unapplied' : undefined,
      requestText: lastUser,
    }
  })
}

/** CON-01 응답 하나를 화면 항목 둘(사용자·도우미)로 */
export function fromSendResult(result: SendMessageResult): [ChatItem, ChatItem] {
  const user: ChatItem = {
    id: result.userMessage.id,
    role: 'user',
    content: result.userMessage.content,
  }
  const assistant: ChatItem = {
    id: result.assistantMessage.id,
    role: 'assistant',
    content: result.assistantMessage.content,
    intent: result.assistantMessage.intent,
    options: result.needsClarification ? result.options : [],
    profileSection: result.profileSection,
    requestText: result.userMessage.content,
  }
  return [user, assistant]
}

export const APPLY_FAILED_NOT_APPLICABLE =
  '이번 요청은 3D에 반영하지 못했어요. 조금 다르게 다시 말씀해 주세요.'
/** 명세서 v3.2 API-EDIT-05 `EDIT_030` 서버 문구와 같다 */
export const APPLY_FAILED_CHAT_UNSUPPORTED =
  '이 3D는 아직 대화로 바로 바꿀 수 없어요. 얼굴은 바꾸지 않았어요.'
export const APPLY_FAILED_RETRY = '3D에 반영하지 못했어요. 잠시 후 다시 요청해 주세요.'

/** EDIT-05 실패를 도우미 문구로. EDIT_030은 다시 보내도 같은 결과라 재시도를 권하지 않는다 */
export function applyFailureMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === ErrorCode.CHANGE_REQUEST_NOT_APPLICABLE) {
    return APPLY_FAILED_NOT_APPLICABLE
  }
  if (cause instanceof ApiError && cause.code === ErrorCode.CHAT_EDIT_UNSUPPORTED) {
    return APPLY_FAILED_CHAT_UNSUPPORTED
  }
  if (cause instanceof ApiError && cause.code === ErrorCode.UNSAFE_NOSE_EDIT) {
    return '이 조합은 현재 조절 한계를 넘어요. 요청한 값은 반영하지 않았어요.'
  }
  if (cause instanceof ApiError && cause.code === ErrorCode.UNSAFE_CONTOUR_EDIT) {
    return '이 조합은 함께 적용하기 어려워요. 한 부위씩 조금씩 조절해 주세요. 얼굴은 그대로예요.'
  }
  return APPLY_FAILED_RETRY
}

function previewFailureMessage(cause: unknown): string {
  switch (cause instanceof ApiError ? cause.code : undefined) {
    case ErrorCode.VERSION_CONFLICT:
      return '시안이 바뀌었어요. 새로고침한 뒤 다시 비교해 주세요.'
    case ErrorCode.CHAT_EDIT_UNSUPPORTED:
    case ErrorCode.NOSE_EDIT_NOT_READY:
      return '이 시안에서는 해당 조절을 미리 볼 수 없어요. 직접 조절에서 가능한 항목을 확인해 주세요.'
    case ErrorCode.UNSAFE_NOSE_EDIT:
    case ErrorCode.UNSAFE_CONTOUR_EDIT:
      return '요청한 조절로는 미리보기를 만들기 어려워요. 강도를 낮추거나 한 부위씩 비교해 보세요.'
    case ErrorCode.CHANGE_REQUEST_NOT_APPLICABLE:
      return '이 요청으로는 미리보기를 만들 수 없어요. 현재 조절값을 확인한 뒤 다시 요청해 주세요.'
    default:
      return '미리보기를 불러오지 못했어요. 잠시 후 다시 요청해 주세요.'
  }
}

/** EDIT-05를 이어서 부를지. 되묻기면 절대 부르지 않는다(FN-CON-02 수용 1) */
export function shouldApply(result: SendMessageResult): boolean {
  return (
    !result.needsClarification &&
    result.assistantMessage.intent === 'EDIT' &&
    result.changeRequest?.status === 'COMPLETE'
  )
}

const HISTORY_PAGE_SIZE = 50

function getHistoryPage(
  simulationId: string,
  page: number,
  signal?: AbortSignal,
  archived = false,
) {
  return getConsultMessages(simulationId, { page, size: HISTORY_PAGE_SIZE, archived }, signal)
}

async function recentHistory(simulationId: string, signal?: AbortSignal, archived = false) {
  const first = await getHistoryPage(simulationId, 0, signal, archived)
  const conversationAfterSeq = first.conversationAfterSeq ?? 0
  const last = Math.max(0, Math.ceil(first.totalElements / HISTORY_PAGE_SIZE) - 1)
  if (last === 0) return { items: toChatItems(first.items), olderPage: -1, conversationAfterSeq }

  const latest = await getHistoryPage(simulationId, last, signal, archived)
  if ((latest.conversationAfterSeq ?? 0) !== conversationAfterSeq)
    throw new Error('conversation changed')
  if (latest.items.length === HISTORY_PAGE_SIZE) {
    return { items: toChatItems(latest.items), olderPage: last - 1, conversationAfterSeq }
  }
  const previous =
    last === 1 ? first : await getHistoryPage(simulationId, last - 1, signal, archived)
  if ((previous.conversationAfterSeq ?? 0) !== conversationAfterSeq)
    throw new Error('conversation changed')
  return {
    items: toChatItems([...previous.items, ...latest.items]),
    olderPage: last - 2,
    conversationAfterSeq,
  }
}

export function useConsult(
  simulationId: string,
  editor: Pick<
    SimulationEditor,
    'run' | 'applyEditResult' | 'handleError' | 'setSaveStatus' | 'reload'
  >,
  { onOpenSlider }: { onOpenSlider?: (code: string) => void } = {},
) {
  const [items, setItems] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(true)
  const [historyReadyFor, setHistoryReadyFor] = useState<string | null>(null)
  const [historyRetry, setHistoryRetry] = useState(0)
  const [historyError, setHistoryError] = useState(false)
  const [olderPage, setOlderPage] = useState(-1)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const historyController = useRef<AbortController | null>(null)
  const olderInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [comparison, setComparison] = useState<{
    simulationId: string
    requestId: string
    messageId: string
    anchorId?: string
    result: ApplyChangeRequestResult
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [archived, setArchived] = useState(false)
  const [starting, setStarting] = useState(false)
  const [conversationAfterSeq, setConversationAfterSeq] = useState(0)
  const tempId = useRef(0)
  const pendingRequest = useRef<{ action: string; id: string } | null>(null)
  const { run, applyEditResult, handleError, setSaveStatus, reload } = editor

  // 다시 열면 최근 대화를 먼저 보여 준다(FN-HIS-01 수용 3).
  useEffect(() => {
    const controller = new AbortController()
    historyController.current = controller
    void recentHistory(simulationId, controller.signal, archived)
      .then((history) => {
        if (controller.signal.aborted) return
        setItems(history.items)
        setOlderPage(history.olderPage)
        setConversationAfterSeq(history.conversationAfterSeq)
        setHistoryReadyFor(simulationId)
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistoryError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [simulationId, historyRetry, archived])

  function viewConversation(previous: boolean) {
    setComparison(null)
    setArchived(previous)
    setItems([])
    setOlderPage(-1)
    setError(null)
    retryHistory()
  }

  async function newConversation() {
    if (starting || loading || loadingOlder || archived) return false
    setStarting(true)
    setComparison(null)
    setError(null)
    try {
      const next = await startConsultConversation(simulationId)
      historyController.current?.abort()
      pendingRequest.current = null
      setConversationAfterSeq(next.conversationAfterSeq)
      viewConversation(false)
      return true
    } catch {
      setError('새 대화를 열지 못했어요. 다시 시도해 주세요.')
      return false
    } finally {
      setStarting(false)
    }
  }

  function retryHistory() {
    setHistoryError(false)
    setLoading(true)
    setHistoryRetry((attempt) => attempt + 1)
  }

  async function loadOlder() {
    const signal = historyController.current?.signal
    if (!signal || signal.aborted || olderPage < 0 || olderInFlight.current) return
    olderInFlight.current = true
    setLoadingOlder(true)
    setHistoryError(false)
    try {
      const page = await getHistoryPage(simulationId, olderPage, signal, archived)
      if (signal.aborted) return
      if ((page.conversationAfterSeq ?? 0) !== conversationAfterSeq) {
        retryHistory()
        return
      }
      const older = toChatItems(page.items)
      setItems((current) => [...older, ...current])
      setOlderPage(olderPage - 1)
    } catch {
      if (!signal.aborted) setHistoryError(true)
    } finally {
      olderInFlight.current = false
      if (!signal.aborted) setLoadingOlder(false)
    }
  }

  /**
   * 메시지를 보낸다. 성공하면 true(입력창을 비운다). AI 실패면 얼굴·대화가 저장되지 않으니
   * 보낸 문장을 지우고 false를 돌려 입력창에 남긴다.
   */
  const send = useCallback(
    async (
      content: string,
      {
        comparisonAnchorId,
        ...extra
      }: Pick<
        SendMessageBody,
        | 'exampleId'
        | 'selectedOptionId'
        | 'modeSwitch'
        | 'directControl'
        | 'profileSection'
        | 'comparisonTarget'
        | 'recommendationMeasurements'
      > & { comparisonAnchorId?: string } = {},
      onComparisonReady?: () => void,
    ): Promise<boolean> => {
      const text = content.trim()
      if (
        !text ||
        text.length > CONTENT_MAX ||
        busy ||
        loading ||
        loadingOlder ||
        starting ||
        archived
      )
        return false
      const signal = historyController.current?.signal
      setComparison(null)
      const optimisticId = `pending-${++tempId.current}`
      setItems((prev) => [
        ...prev,
        { id: optimisticId, role: 'user', content: text, sending: true },
      ])
      setBusy(true)
      setError(null)

      try {
        return await run(async () => {
          if (signal?.aborted) return false
          const action = JSON.stringify([
            simulationId,
            conversationAfterSeq,
            useEditStore.getState().version,
            text,
            extra.exampleId,
            extra.selectedOptionId,
            extra.modeSwitch?.target,
            extra.modeSwitch?.stateVersion,
            extra.directControl?.code,
            extra.directControl?.stateVersion,
            extra.profileSection,
            extra.comparisonTarget?.code,
            extra.comparisonTarget?.value,
            extra.recommendationMeasurements,
          ])
          const requestId =
            pendingRequest.current?.action === action
              ? pendingRequest.current.id
              : crypto.randomUUID()
          pendingRequest.current = { action, id: requestId }
          let result: SendMessageResult
          try {
            result = await sendConsultMessage(simulationId, {
              content: text,
              requestId,
              ...extra,
              conversationAfterSeq,
            })
          } catch (cause) {
            if (signal?.aborted) return false
            setItems((prev) => prev.filter((item) => item.id !== optimisticId))
            const duplicate =
              cause instanceof ApiError && cause.code === ErrorCode.CONSULT_DUPLICATE_REQUEST
            if (duplicate) {
              try {
                const history = await recentHistory(simulationId, signal)
                if (!signal?.aborted) {
                  const overlap = items.findIndex(({ id }) => id === history.items[0]?.id)
                  setItems([...items.slice(0, Math.max(0, overlap)), ...history.items])
                  setOlderPage(
                    overlap >= 0 ? Math.min(olderPage, history.olderPage) : history.olderPage,
                  )
                  setHistoryReadyFor(simulationId)
                  setHistoryError(false)
                }
              } catch {
                // 내역 조회가 실패해도 같은 ID로 GMS를 재호출하지 않는다
              }
            }
            setError(
              duplicate
                ? '같은 요청은 다시 처리하지 않았어요. 대화 내역에 결과가 없으면 잠시 후 새로고침해 얼굴 상태를 확인해 주세요.'
                : cause instanceof Error
                  ? cause.message
                  : '잠시 후 다시 시도해 주세요.',
            )
            return false
          }
          if (signal?.aborted) return false
          pendingRequest.current = null

          const [user, assistant] = fromSendResult(result)
          if (useEditStore.getState().simulationId !== simulationId) return false
          if (result.morphResult && !applyEditResult(result.morphResult, true)) return false
          let sliderToOpen = result.recommendedSliderCode
          if (extra.exampleId === 'consult-advice') {
            assistant.comparisonCode = sliderToOpen ?? undefined
            sliderToOpen = null
          }

          if (shouldApply(result) && result.changeRequest) {
            if (extra.exampleId === 'consult-preview') {
              try {
                const requestId = result.changeRequest.requestId
                const version = useEditStore.getState().version
                const candidate = await previewChangeRequest(simulationId, requestId, version)
                if (signal?.aborted) return false
                setComparison({
                  simulationId,
                  requestId,
                  messageId: assistant.id,
                  anchorId: comparisonAnchorId,
                  result: candidate,
                })
                assistant.content = '현재 시안과 제안을 같은 각도에서 비교해 보세요.'
                assistant.previewed = true
              } catch (cause) {
                if (signal?.aborted) return false
                assistant.content = previewFailureMessage(cause)
              }
              setItems((prev) => [
                ...prev.filter((item) => item.id !== optimisticId),
                user,
                assistant,
              ])
              return true
            }
            setSaveStatus('saving')
            const { version, morphState } = useEditStore.getState()
            const requestedCodes = result.changeRequest.actions.map(({ code }) => code)
            const activeCodes = Object.keys(morphState.weights).filter(
              (code) => morphState.weights[code] !== 0,
            )
            const attemptedCodes = new Set([...requestedCodes, ...activeCodes])
            const combined =
              !extra.modeSwitch &&
              attemptedCodes.has(WEIGHT_SHAPE_CODE) &&
              (attemptedCodes.size > 1 ||
                (morphState.eyeEdit && !isDefaultEyes(morphState.eyeEdit)))
            try {
              const applied = await applyChangeRequest(
                simulationId,
                result.changeRequest.requestId,
                version,
              )
              if (signal?.aborted) {
                await reload().catch(() => undefined)
                setSaveStatus('idle')
                return false
              }
              if (!applyEditResult(applied, true)) return false
              setSaveStatus('saved')
              assistant.applyResult = {
                summary: applied.summary,
                applied: applied.applied,
                eyeBefore: applied.eyeBefore,
                eyeAfter: applied.eyeAfter,
                eyeLimits: applied.eyeLimits,
                skipped: applied.skipped,
                seq: applied.seq,
                limited: applied.limited,
              }
            } catch (cause) {
              if (signal?.aborted) {
                setSaveStatus('idle')
                return false
              }
              const rejectedCombination =
                combined && cause instanceof ApiError && cause.code === ErrorCode.UNKNOWN_MORPH_CODE
              if (cause instanceof ApiError && cause.code === ErrorCode.CHAT_EDIT_UNSUPPORTED) {
                // 이 3D는 채팅 편집을 아직 못 한다. 얼굴은 그대로이니 저장 실패로 보이지 않게 하고,
                // 최신 상태를 다시 읽는다(토스트·자동 재시도 없음). 미승인 모델은 슬라이더도 열지 않는다.
                const refreshed = await reload().catch(() => undefined)
                setSaveStatus('idle')
                // 승인된 모델만 요청 항목 슬라이더를 열어 준다.
                // 탭이 직접 조절로 바뀌어 대화의 안내가 가려지므로 같은 문구를 토스트로도 알린다
                // 코·눈이 섞인 요청은 열린 코 슬라이더를 우선 연다.
                // 코 action은 효과 코드가 곧 저장 코드다(contracts/edit/effects-v1.md)
                if (sliderToOpen && isLockedCode(sliderToOpen)) sliderToOpen = null
                sliderToOpen ??=
                  result.changeRequest.actions.find((action) => !isLockedCode(action.code))?.code ??
                  null
                if (refreshed?.capabilities === null) sliderToOpen = null
                if (sliderToOpen)
                  feedbackToast(unappliedMessage(result.changeRequest, cause.message))
              } else {
                setSaveStatus('error')
                // 미리보기를 버리고 최신 상태를 다시 읽는다(CON_010·EDIT_002). 대화는 남는다
                await handleError(cause, rejectedCombination ? WEIGHT_CONTOUR_REJECTED : undefined)
                if (rejectedCombination) sliderToOpen = null
              }
              assistant.recovery = rejectedCombination
                ? 'mode'
                : cause instanceof ApiError && cause.code === ErrorCode.CHAT_EDIT_UNSUPPORTED
                  ? 'unsupported'
                  : cause instanceof ApiError && cause.code === ErrorCode.UNSAFE_NOSE_EDIT
                    ? 'limit'
                    : cause instanceof ApiError &&
                        cause.code === ErrorCode.CHANGE_REQUEST_NOT_APPLICABLE
                      ? 'unapplied'
                      : 'retry'
              assistant.content =
                cause instanceof ApiError && cause.code === ErrorCode.CHAT_EDIT_UNSUPPORTED
                  ? unappliedMessage(result.changeRequest, cause.message)
                  : rejectedCombination
                    ? unappliedMessage(result.changeRequest, WEIGHT_CONTOUR_REJECTED)
                    : applyFailureMessage(cause)
            }
          }

          setItems((prev) => [...prev.filter((item) => item.id !== optimisticId), user, assistant])
          if (assistant.comparisonCode && assistant.intent === 'REPLY') onComparisonReady?.()
          if (sliderToOpen) onOpenSlider?.(sliderToOpen)
          return true
        }, true)
      } finally {
        setBusy(false)
      }
    },
    [
      archived,
      starting,
      conversationAfterSeq,
      busy,
      loading,
      loadingOlder,
      items,
      olderPage,
      run,
      simulationId,
      applyEditResult,
      handleError,
      setSaveStatus,
      reload,
      onOpenSlider,
    ],
  )

  const activeComparison =
    !archived && !starting && comparison?.simulationId === simulationId ? comparison : null
  async function applyComparison() {
    if (!activeComparison || busy) return
    setBusy(true)
    setError(null)
    setComparison(null)
    try {
      await run(async () => {
        const applied = await applyChangeRequest(
          simulationId,
          activeComparison.requestId,
          activeComparison.result.stateVersion,
        )
        if (!applyEditResult(applied, true)) return false
        setSaveStatus('saved')
        setItems((previous) =>
          previous.map((item) =>
            item.id === activeComparison.messageId
              ? { ...item, content: '', applyResult: applied }
              : item,
          ),
        )
        return true
      }, true)
    } catch {
      await reload().catch(() => undefined)
      setError(
        '시안이 바뀌었거나 저장 응답을 확인하지 못했어요. 현재 상태를 확인한 뒤 다시 비교해 주세요.',
      )
    } finally {
      setBusy(false)
    }
  }

  return {
    items,
    loading,
    historyReady: historyReadyFor === simulationId,
    history: {
      error: historyError,
      retry: retryHistory,
      hasOlder: olderPage >= 0,
      loadingOlder,
      loadOlder,
      archived,
      starting,
      hasArchived: conversationAfterSeq > 0,
      newConversation,
      viewConversation,
    },
    busy,
    error,
    send,
    comparison: activeComparison,
    cancelComparison: () => setComparison(null),
    applyComparison,
  }
}

type SavedConsult = Omit<ReturnType<typeof useConsult>, 'historyReady'>
type ConversationControls =
  'archived' | 'starting' | 'hasArchived' | 'newConversation' | 'viewConversation'
export type Consult = Omit<
  SavedConsult,
  'history' | 'comparison' | 'cancelComparison' | 'applyComparison'
> &
  Partial<Pick<SavedConsult, 'comparison' | 'cancelComparison' | 'applyComparison'>> & {
    history?: Omit<SavedConsult['history'], ConversationControls> &
      Partial<Pick<SavedConsult['history'], ConversationControls>>
  }
