import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '@/shared/api/ApiError'
import {
  applyChangeRequest,
  getConsultMessages,
  previewChangeRequest,
  sendConsultMessage,
  startConsultConversation,
} from '../api'
import type { ConsultMessage } from '../types'
import { useConsult } from './useConsult'
import { useEditStore } from '../store'

vi.mock('../api', () => ({
  applyChangeRequest: vi.fn(),
  getConsultMessages: vi.fn(),
  previewChangeRequest: vi.fn(),
  sendConsultMessage: vi.fn(),
  startConsultConversation: vi.fn(),
}))

const editor: Parameters<typeof useConsult>[1] = {
  run: async (task) => task(),
  applyEditResult: vi.fn(),
  handleError: vi.fn(),
  setSaveStatus: vi.fn(),
  reload: vi.fn(),
}

const messages: ConsultMessage[] = Array.from({ length: 102 }, (_, index) => ({
  messageId: String(index),
  content: `합성 메시지 ${index}`,
  role: index % 2 ? 'ASSISTANT' : 'USER',
  sender: null,
  intent: null,
  needsClarification: false,
  options: [],
  changeRequest: null,
  applyResult: null,
  createdAt: '2026-11-10T00:00:00Z',
}))

beforeEach(() => vi.resetAllMocks())

function previewError(status: number, code: string) {
  return new ApiError(status, { code, message: '비교 실패', details: [] })
}

it.each([
  ['비교 취소', null, null],
  ['시안 버전 충돌', previewError(409, 'EDIT_002'), '새로고침'],
  ['미지원', previewError(422, 'EDIT_031'), '직접 조절'],
  ['형상 거절', previewError(422, 'EDIT_032'), '강도를 낮추'],
  ['비교 불가', previewError(422, 'CON_010'), '현재 조절값'],
  ['연결 실패', new NetworkError(), '잠시 후'],
] as const)('%s: 미리보기 요청은 저장하지 않는다', async (_scenario, failure, feedback) => {
  const prior = useEditStore.getState().simulationId
  useEditStore.setState({ simulationId: 'audit' })
  try {
    vi.mocked(getConsultMessages).mockResolvedValue({
      items: [],
      page: 0,
      size: 50,
      totalElements: 0,
    })
    vi.mocked(sendConsultMessage).mockResolvedValue({
      userMessage: { id: 'user', content: '콧볼을 조금 줄여줘' },
      assistantMessage: { id: 'assistant', content: '', intent: 'EDIT' },
      changeRequest: {
        requestId: 'request',
        status: 'COMPLETE',
        schemaVersion: 'v2',
        actions: [{ code: 'nose.alar_width', direction: -1, strength: 'small', side: 'both' }],
        skipped: [],
      },
      needsClarification: false,
      options: [],
      recommendedSliderCode: null,
    } as unknown as Awaited<ReturnType<typeof sendConsultMessage>>)
    vi.mocked(previewChangeRequest).mockResolvedValue({
      stateVersion: useEditStore.getState().version,
    } as Awaited<ReturnType<typeof previewChangeRequest>>)
    if (failure) vi.mocked(previewChangeRequest).mockRejectedValueOnce(failure)
    const { result } = renderHook(() => useConsult('audit', editor))
    await waitFor(() => expect(result.current.historyReady).toBe(true))
    await act(async () => {
      await result.current.send('콧볼을 조금 줄여줘', { exampleId: 'consult-preview' })
    })
    if (feedback) {
      expect(result.current.items.at(-1)?.content).toContain(feedback)
    } else {
      expect(result.current.comparison?.requestId).toBe('request')
      expect(result.current.items.at(-1)?.content).toContain('현재 시안과 제안')
      act(() => result.current.cancelComparison())
    }
    expect(applyChangeRequest).not.toHaveBeenCalled()
    expect(result.current.comparison).toBeNull()
    expect(editor.applyEditResult).not.toHaveBeenCalled()
  } finally {
    useEditStore.setState({ simulationId: prior })
  }
})

it('새 대화를 열면 늦은 응답을 적용하지 않고 보관 내역을 따로 표시한다', async () => {
  let boundary = 0
  vi.mocked(getConsultMessages).mockImplementation(async (_id, { archived } = {}) => ({
    items: archived || !boundary ? messages.slice(0, 2) : [],
    page: 0,
    size: 50,
    totalElements: archived || !boundary ? 2 : 0,
    conversationAfterSeq: boundary,
  }))
  vi.mocked(startConsultConversation).mockImplementation(async () => {
    boundary = 2
    return { conversationAfterSeq: boundary }
  })
  let rejectSend: (reason: Error) => void = () => {}
  vi.mocked(sendConsultMessage).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSend = reject
      }),
  )
  const hook = renderHook(() => useConsult('audit', editor))
  const { result } = hook
  await waitFor(() => expect(result.current.items).toHaveLength(2))
  let sent: Promise<boolean>
  act(() => {
    sent = result.current.send('사각턱 줄여줘')
  })
  await waitFor(() => expect(sendConsultMessage).toHaveBeenCalledOnce())
  await act(async () => {
    await result.current.history.newConversation()
  })
  await act(async () => {
    rejectSend(new Error('이전 요청 응답'))
    expect(await sent).toBe(false)
  })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.items).toEqual([])
  expect(result.current.error).toBeNull()
  expect(applyChangeRequest).not.toHaveBeenCalled()
  act(() => result.current.history.viewConversation(true))
  await waitFor(() => expect(result.current.items).toHaveLength(2))
  expect(await result.current.send('더 줄여줘')).toBe(false)
  hook.unmount()
  const reopened = renderHook(() => useConsult('audit', editor))
  await waitFor(() => expect(reopened.result.current.loading).toBe(false))
  expect(reopened.result.current.items).toEqual([])
  expect(reopened.result.current.history.hasArchived).toBe(true)
})

it('마지막 페이지에 두 개만 있어도 직전 페이지를 함께 열고 이전 내역을 이어서 읽는다', async () => {
  vi.mocked(getConsultMessages).mockImplementation(async (_id, { page = 0, size = 50 } = {}) => {
    return { items: messages.slice(page * size, (page + 1) * size), page, size, totalElements: 102 }
  })
  const { result } = renderHook(() => useConsult('audit', editor))
  await waitFor(() => expect(result.current.historyReady).toBe(true))
  expect(result.current.items.map(({ id }) => id)).toEqual(
    messages.slice(50).map((m) => m.messageId),
  )
  expect(result.current.history.hasOlder).toBe(true)
  vi.mocked(getConsultMessages).mockRejectedValueOnce(new Error('조회 실패'))
  await act(async () => {
    await result.current.history.loadOlder()
  })
  expect(result.current.history.error).toBe(true)
  expect(result.current.items).toHaveLength(52)
  await act(async () => {
    await result.current.history.loadOlder()
  })
  expect(result.current.history.error).toBe(false)
  expect(result.current.history.hasOlder).toBe(false)
  expect(result.current.items.map(({ id }) => id)).toEqual(messages.map((m) => m.messageId))
})

it('첫 조회가 실패해도 재시도하면 저장된 대화를 복원한다', async () => {
  vi.mocked(getConsultMessages)
    .mockRejectedValueOnce(new Error('조회 실패'))
    .mockResolvedValueOnce({ items: messages.slice(0, 2), page: 0, size: 50, totalElements: 2 })
  const { result } = renderHook(() => useConsult('audit', editor))
  await waitFor(() => expect(result.current.history.error).toBe(true))
  act(() => result.current.history.retry())
  await waitFor(() => expect(result.current.historyReady).toBe(true))
  expect(result.current.history.error).toBe(false)
  expect(result.current.items).toHaveLength(2)
})

it('같은 실패 동작만 같은 ID를 쓰고 전환 조건과 선택 항목이 달라지면 새 ID를 쓴다', async () => {
  vi.mocked(getConsultMessages).mockResolvedValue({
    items: [],
    page: 0,
    size: 50,
    totalElements: 0,
  })
  vi.mocked(sendConsultMessage).mockRejectedValue(new Error('응답 유실'))
  const { result } = renderHook(() => useConsult('audit', editor))
  await waitFor(() => expect(result.current.historyReady).toBe(true))
  const send = async (extra?: Parameters<typeof result.current.send>[1]) => {
    await act(async () => {
      await result.current.send('조금 올려줘', extra)
    })
  }
  await send()
  await send()
  await send({ modeSwitch: { target: 'toFace', stateVersion: 2 } })
  await send({ modeSwitch: { target: 'toFace', stateVersion: 3 } })
  await send({ directControl: { code: 'nose.bridge_height', stateVersion: 3 } })
  await send({ directControl: { code: 'nose.tip_height', stateVersion: 3 } })
  await send({ selectedOptionId: 'first' })
  await send({ selectedOptionId: 'second' })
  const ids = vi.mocked(sendConsultMessage).mock.calls.map(([, body]) => body.requestId)
  expect(ids[0]).toBe(ids[1])
  expect(new Set(ids.slice(1)).size).toBe(7)
})
