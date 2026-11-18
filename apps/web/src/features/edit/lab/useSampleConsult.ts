'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/features/auth/store'
import type { SampleHead } from '@/features/studio/samples'
import { sendSampleConsult } from '../api'
import type { EyeLimits, EyeReview } from '../eyes/state'
import { isDefaultEyes } from '../eyes/state'
import type { MorphParameterCatalog } from '../types'
import { applySampleConsult, type SampleState } from './applySampleConsult'
import type { ChatItem, Consult } from './useConsult'

/** 기본 모델 상담은 이 탭의 메모리에만 남는다. 서버는 해석만 하고 시안을 만들지 않는다. */
export function useSampleConsult({
  sample,
  member,
  ready,
  meshSha256,
  supportedCodes,
  catalog,
  state,
  review,
  eyeLimits,
  eyeReady,
  onApply,
  onUndo,
  onRedo,
  onReset,
}: {
  sample: SampleHead
  member: boolean
  ready: boolean
  meshSha256: string | null
  supportedCodes: string[] | null
  catalog: MorphParameterCatalog | null
  state: SampleState
  review: EyeReview
  eyeLimits: EyeLimits | undefined
  eyeReady: boolean
  onApply: (next: SampleState) => void
  onUndo: () => boolean
  onRedo: () => boolean
  onReset: () => boolean
}): Consult {
  const [conversation, setConversation] = useState<{ key: string; items: ChatItem[] }>({
    key: sample.key,
    items: [],
  })
  const items = member && conversation.key === sample.key ? conversation.items : []
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const pendingController = useRef<AbortController | null>(null)
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  }, [state])
  useEffect(() => () => pendingController.current?.abort(), [sample.key, member])
  useEffect(
    () =>
      useAuthStore.subscribe((next, previous) => {
        if (next.status !== previous.status) {
          setConversation({ key: sample.key, items: [] })
          setError(null)
        }
      }),
    [sample.key],
  )

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const text = content.trim()
      if (
        !member ||
        !ready ||
        !meshSha256 ||
        !catalog ||
        !supportedCodes ||
        !text ||
        pending.current
      ) {
        setError('모델을 확인한 뒤 다시 요청해 주세요. 얼굴은 바꾸지 않았어요.')
        return false
      }
      pending.current = true
      setBusy(true)
      setError(null)
      const id = crypto.randomUUID()
      const controller = new AbortController()
      pendingController.current = controller
      try {
        const reply = await sendSampleConsult(
          sample.key,
          {
            content: text,
            requestId: id,
            meshSha256,
            weights: state.weights,
            supportedCodes,
            eyeAvailable: eyeReady,
            eyeFoldEnabled: state.eyes.L.enabled || state.eyes.R.enabled,
            eyeEdited: !isDefaultEyes(state.eyes),
          },
          controller.signal,
        )
        if (controller.signal.aborted) return false
        let assistant: ChatItem = {
          id: `${id}-assistant`,
          role: 'assistant',
          content: reply.assistantMessage,
          intent: reply.intent,
          options: reply.options.map((option, index) => ({
            id: `${id}-${index}`,
            label: option.label,
          })),
          requestText: reply.maskedUserContent,
        }
        if (
          (reply.intent === 'EDIT' || ['UNDO', 'REDO', 'RESET'].includes(reply.intent)) &&
          (latest.current.weights !== state.weights || latest.current.eyes !== state.eyes)
        ) {
          assistant.content = '그사이 조절값이 바뀌었어요. 바꾸고 싶은 내용을 다시 말씀해 주세요.'
        } else if (reply.intent === 'EDIT' && reply.changeRequest) {
          const applied = applySampleConsult(
            reply.changeRequest.actions,
            state,
            supportedCodes,
            catalog,
            review,
            eyeLimits,
            eyeReady,
          )
          if (applied) {
            onApply(applied.state)
            assistant = {
              ...assistant,
              content: '',
              applyResult: {
                summary: '기본 모델 변경',
                applied: applied.applied,
                skipped: reply.changeRequest.skipped,
                seq: items.length / 2 + 1,
                limited: applied.limited,
                eyeBefore: state.eyes,
                eyeAfter: applied.state.eyes,
                eyeLimits,
              },
            }
          } else
            assistant.content =
              '이 모델의 현재 조절 상태에서는 적용할 수 없어요. 얼굴은 바꾸지 않았어요.'
        } else if (reply.intent === 'EDIT') {
          assistant.content = '이번 요청은 적용할 수 없어요. 얼굴은 바꾸지 않았어요.'
        } else if (reply.intent === 'UNDO') {
          assistant.content = onUndo() ? '한 단계 되돌렸어요.' : '되돌릴 변경이 없어요.'
        } else if (reply.intent === 'REDO') {
          assistant.content = onRedo() ? '다시 적용했어요.' : '다시 적용할 변경이 없어요.'
        } else if (reply.intent === 'RESET') {
          assistant.content = onReset() ? '처음 상태로 돌렸어요.' : '이미 처음 상태예요.'
        }
        setConversation((previous) => ({
          key: sample.key,
          items: [
            ...(previous.key === sample.key ? previous.items : []),
            { id, role: 'user', content: reply.maskedUserContent },
            assistant,
          ],
        }))
        return true
      } catch (cause) {
        if (controller.signal.aborted) return false
        setError(cause instanceof Error ? cause.message : '잠시 후 다시 시도해 주세요.')
        return false
      } finally {
        if (pendingController.current === controller) {
          pendingController.current = null
          pending.current = false
          setBusy(false)
        }
      }
    },
    [
      member,
      ready,
      meshSha256,
      catalog,
      supportedCodes,
      sample,
      state,
      review,
      eyeLimits,
      eyeReady,
      onApply,
      onUndo,
      onRedo,
      onReset,
      items.length,
    ],
  )
  return { items, loading: false, busy, error, send }
}
