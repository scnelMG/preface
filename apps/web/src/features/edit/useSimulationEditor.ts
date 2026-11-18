'use client'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { ApiError, NetworkError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { newEyeState, type EyeState } from './eyes/state'
import {
  getFaceModel,
  getSimulation,
  redoEdit,
  renameSimulation,
  resetEdit,
  undoEdit,
  updateMorphState,
  updateEyeState,
} from './api'
import { diffWeights, originalMorphState, overlayPending, type SliderChange } from './editLogic'
import { beginEditAction, feedbackToast, isLatestEditAction } from './feedbackToast'
import { useEditStore } from './store'
import type { MorphValueChange } from './noseControls'
import {
  recoverRecommendation,
  rememberRecommendation,
  uncertainRecommendationSave,
} from './recommendationSave'
import type { EditResult, MorphState, Simulation } from './types'
import { WEIGHT_SHAPE_CODE } from './weightShapeControls'

/**
 * 회원 실험실(내 모델 수정) 편집 상태와 서버 동기화.
 *
 * - 처음: API-EDIT-03(가중치·이력 가능 여부) → API-HIS-02(메시 presigned URL)
 * - 슬라이더: 움직이는 동안 화면만 바꾸고(store.setWeight), 손을 떼면 바뀐 항목만 API-EDIT-04 1회
 * - 되돌리기·앞으로·처음으로: API-EDIT-06·08·07. 처음으로는 확인 없이 실행하고 되돌리기 토스트
 * - 서버를 바꾸는 호출은 **한 줄로 세운다**(stateVersion이 앞 응답을 따라가야 해서). `run`이 그 줄이다
 * - EDIT_002(버전 충돌)·EDIT_001·CON_010·EDIT_003·EDIT_004면 EDIT-03으로 최신 상태를 다시 읽고 토스트(명세서 8절 FE 매핑)
 * - EDIT_003·EDIT_004는 저장 실패가 아니라 이력이 없다는 뜻이라 저장 상태를 `error`로 바꾸지 않는다
 * - 손을 뗀 값은 저장·재조회가 도는 동안 그대로 보인다. 서버 값이 오면 그때 한 번만 옮긴다(앞 저장의 응답이나
 *   재조회가 줄 서 있는 뒤 저장 값을 덮어 0 같은 옛 값으로 튀었다 돌아오지 않게, `queued`)
 * - 편집 알림(저장 실패·충돌 등)은 feedbackToast로 하나만 띄운다
 * - 처음으로는 줄 선 저장을 기다리지 않고 원본을 먼저 보인다(`resetView`). 앞 저장은 순서대로 서버에 보내지만(이력 유지)
 *   그 응답은 버전·이력 가능 여부만 옮기고 화면은 원본으로 둔다. 처음으로 응답이 오면 서버 상태로 맞춘다(S15P31B204-727)
 * - 저장·되돌리기·앞으로 가기는 응답이 왔을 때 더 새 편집 동작이 있으면 null을 돌려 알림을 띄우지 않게 한다(`beginEditAction`)
 * - 슬라이더 저장의 한계 알림은 화면이 확정할 수 있으면 손을 뗀 순간 `onChanges`로 바로 띄운다(S15P31B204-839, -852).
 *   응답(줄 선 앞 저장 + PATCH 한 번)을 기다리면 알림이 늦게 떴다. 실패하면 handleError의 오류 알림이 그 자리를 바꾼다
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type LoadState = 'loading' | 'ready' | 'notFound' | 'failed'

/**
 * 공통 REFETCH 묶음 밖이지만 EDIT-03을 다시 읽어야 하는 코드.
 * - CON_010: 미리보기를 버리고 최신 상태로
 * - EDIT_003·EDIT_004: 되돌릴·앞으로 갈 이력이 없다. 버튼이 서버와 어긋난 것이니 canUndo·canRedo를 다시 맞춘다
 *   (명세서 v3.2 8절 "앞으로 가기 비활성 = EDIT_004")
 */
const REFETCH_ALSO: ReadonlySet<string> = new Set([
  ErrorCode.CHANGE_REQUEST_NOT_APPLICABLE,
  ErrorCode.NOTHING_TO_UNDO,
  ErrorCode.NOTHING_TO_REDO,
  ErrorCode.NOSE_EDIT_NOT_READY,
  ErrorCode.UNSAFE_NOSE_EDIT,
])

/**
 * 저장 실패가 아닌 코드. 되돌릴·앞으로 갈 이력이 없을 뿐 시안은 그대로라,
 * 툴바 저장 상태를 `저장하지 못했어요`로 바꾸지 않고 요청 전 상태로 돌린다.
 */
const HISTORY_EMPTY: ReadonlySet<string> = new Set([
  ErrorCode.NOTHING_TO_UNDO,
  ErrorCode.NOTHING_TO_REDO,
])

/** 메시 주소를 다시 받는 최대 횟수(presigned 만료 대비). 계속 실패하면 오류 화면 */
const MESH_RETRY_LIMIT = 2

export function useSimulationEditor(
  simulationId: string,
  checkNosePreview: (weights: Readonly<Record<string, number>>) => boolean,
) {
  const [simulation, setSimulationState] = useState<Simulation | null>(null)
  /** 마지막으로 정한 시안. 렌더를 기다리지 않고 읽는다(`flush` 뒤 바로 이름·바꾼 것 여부를 보려고, -844) */
  const latestSimulation = useRef<Simulation | null>(null)
  const setSimulation = useCallback((next: SetStateAction<Simulation | null>) => {
    latestSimulation.current = typeof next === 'function' ? next(latestSimulation.current) : next
    setSimulationState(latestSimulation.current)
  }, [])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [saveStatus, setSaveStatusState] = useState<SaveStatus>('idle')
  /** 마지막으로 끝난 저장 상태(`saving` 제외). 저장 실패가 아닌 오류 뒤 이 값으로 돌린다 */
  const settledStatus = useRef<SaveStatus>('idle')

  /** 저장에 실패한 횟수. `flush`가 기다리는 동안 실패가 있었는지 본다 */
  const failures = useRef(0)

  const setSaveStatus = useCallback((status: SaveStatus) => {
    if (status !== 'saving') settledStatus.current = status
    if (status === 'error') failures.current += 1
    setSaveStatusState(status)
  }, [])
  const [meshUrl, setMeshUrl] = useState<string | null>(null)
  const [rigUrl, setRigUrl] = useState<string | null>(null)
  const [expressionUrl, setExpressionUrl] = useState<string | null>(null)
  const [meshFailed, setMeshFailed] = useState(false)
  const [previewBlocked, setPreviewBlocked] = useState(false)
  const [savingGroup, setSavingGroup] = useState<'face' | 'weight' | null>(null)
  const previewBarriers = useRef(0)
  const loadContext = useRef<{ simulationId: string; signal: AbortSignal }>(null)

  const pending = useRef(new Set<string>())
  /** 손을 떼서 저장 줄에 올렸지만 아직 응답이 오지 않은 항목(코드 → 남은 저장 수) */
  const queued = useRef(new Map<string, number>())
  /** 아직 안 보낸 항목의 움직이기 전 값. 저장 뒤 요약(`콧대 높이를 +20%로 키웠어요`)에 쓴다 */
  const baseline = useRef(new Map<string, number>())
  const previewRevisions = useRef(new Map<string, number>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const meshRetries = useRef(0)
  const pendingEye = useRef<EyeState | null>(null)
  const queuedEyes = useRef(0)
  const savedState = useRef<Simulation['morphState'] | null>(null)
  const eyeBaseline = useRef<EyeState | null>(null)
  const eyeRevision = useRef(0)
  /** 처음으로 응답을 기다리는 동안 화면에 보일 원본. 앞 저장의 응답이 화면을 중간 값으로 되돌리지 않게 한다 */
  const resetView = useRef<MorphState | null>(null)
  const resetsInFlight = useRef(0)
  const [resetting, setResetting] = useState(false)

  /** 서버를 바꾸는 호출을 앞 호출이 끝난 뒤에 돌린다 */
  const run = useCallback(<T>(task: () => Promise<T>, replacesState = false): Promise<T> => {
    if (replacesState) {
      previewBarriers.current += 1
      setPreviewBlocked(true)
    }
    const work = queue.current.then(task, task)
    const next = replacesState
      ? work.finally(() => {
          previewBarriers.current -= 1
          if (previewBarriers.current === 0) setPreviewBlocked(false)
        })
      : work
    queue.current = next.catch(() => undefined)
    return next
  }, [])

  /** 화면 값을 지킬 항목: 아직 안 보낸 미리보기 + 줄 서서 응답을 기다리는 저장 */
  const unsettled = useCallback(() => [...pending.current, ...queued.current.keys()], [])

  const reconcileNosePreview = useCallback(
    (weights: Record<string, number>, saved: Readonly<Record<string, number>>) => {
      const noseCodes = [...new Set([...Object.keys(weights), ...Object.keys(saved)])].filter(
        (code) => code.startsWith('nose.') && (weights[code] ?? 0) !== (saved[code] ?? 0),
      )
      if (noseCodes.length === 0 || checkNosePreview(weights)) return weights
      // 앞 저장 응답과 미리보기의 조합이 안전하지 않으면 서버가 확정한 코 값으로 복귀한다.
      const restored = { ...weights }
      for (const code of noseCodes) {
        pending.current.delete(code)
        baseline.current.delete(code)
        if (code in saved) restored[code] = saved[code]
        else delete restored[code]
      }
      return restored
    },
    [checkNosePreview],
  )

  /** 편집 응답을 화면에 반영한다. 아직 안 보낸 슬라이더 값과 줄 선 저장 값은 지킨다 */
  const applyEditResult = useCallback(
    (result: EditResult, discardPreview = false) => {
      const store = useEditStore.getState()
      const load = loadContext.current
      if (
        load?.signal.aborted ||
        load?.simulationId !== simulationId ||
        store.simulationId !== simulationId
      )
        return false
      savedState.current = result.morphState
      const view = resetView.current
      if (view) {
        // 처음으로가 줄 서 있다. 버전·이력 가능 여부만 옮기고 화면은 원본 그대로 둔다
        store.syncFromServer({
          morphState: view,
          version: result.stateVersion,
          canUndo: result.canUndo,
          canRedo: result.canRedo,
        })
        useEditStore.setState({ isDirty: true })
        setSimulation((prev) => (prev ? { ...prev, hasChanges: true } : prev))
        return true
      }
      if (discardPreview) {
        pending.current.clear()
        baseline.current.clear()
        previewRevisions.current.clear()
        pendingEye.current = null
        eyeBaseline.current = null
      }
      const weights = discardPreview
        ? result.morphState.weights
        : reconcileNosePreview(
            overlayPending(result.morphState.weights, store.morphState.weights, unsettled()),
            result.morphState.weights,
          )
      store.syncFromServer({
        morphState: {
          ...result.morphState,
          weights,
          eyeEdit:
            pendingEye.current ??
            (queuedEyes.current ? store.morphState.eyeEdit : result.morphState.eyeEdit),
        },
        version: result.stateVersion,
        canUndo: result.canUndo,
        canRedo: result.canRedo,
      })
      if (pending.current.size || queued.current.size || pendingEye.current || queuedEyes.current)
        useEditStore.setState({ isDirty: true })
      setSimulation((prev) => (prev ? { ...prev, hasChanges: true } : prev))
      return true
    },
    [simulationId, unsettled, reconcileNosePreview, setSimulation],
  )

  /**
   * EDIT-03 응답으로 화면 상태를 연다. 아직 안 보낸 미리보기는 버린다.
   * 줄 서 있는 저장 값은 그 저장이 끝날 때 한 번에 옮기도록 화면에 남긴다(재조회 중 옛 값으로 튀지 않게).
   */
  const openSimulation = useCallback(
    (data: Simulation) => {
      savedState.current = data.morphState
      pending.current.clear()
      baseline.current.clear()
      previewRevisions.current.clear()
      pendingEye.current = null
      eyeBaseline.current = null
      const store = useEditStore.getState()
      const weights = queued.current.size
        ? reconcileNosePreview(
            overlayPending(
              data.morphState.weights,
              store.morphState.weights,
              queued.current.keys(),
            ),
            data.morphState.weights,
          )
        : data.morphState.weights
      store.open({
        simulationId: data.simulationId,
        // 처음으로 응답을 기다리는 중이면 원본을 그대로 보인다
        morphState: resetView.current ?? {
          ...data.morphState,
          weights,
          eyeEdit: queuedEyes.current ? store.morphState.eyeEdit : data.morphState.eyeEdit,
        },
        version: data.stateVersion,
        canUndo: data.canUndo,
        canRedo: data.canRedo,
      })
      if (queued.current.size || queuedEyes.current || resetView.current)
        useEditStore.setState({ isDirty: true })
      setSimulation(data)
      return data
    },
    [reconcileNosePreview, setSimulation],
  )

  const loadSimulation = useCallback(
    (signal = loadContext.current?.signal) =>
      getSimulation(simulationId, signal).then((data) => {
        signal?.throwIfAborted()
        if (loadContext.current?.simulationId !== simulationId)
          throw new DOMException('시안이 바뀌었어요.', 'AbortError')
        return openSimulation(data)
      }),
    [simulationId, openSimulation],
  )

  const loadMesh = useCallback(async (faceModelId: string, signal?: AbortSignal) => {
    const model = await getFaceModel(faceModelId, signal)
    setMeshUrl(model.meshUrl)
    setRigUrl(model.rigUrl ?? null)
    setExpressionUrl(model.expressionUrl ?? null)
    setMeshFailed(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadContext.current = { simulationId, signal: controller.signal }
    const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
    getSimulation(simulationId, controller.signal)
      .then(async (initial) => {
        controller.signal.throwIfAborted()
        const recovered = await recoverRecommendation(initial, controller.signal)
        const data = recovered?.data ?? initial
        controller.signal.throwIfAborted()
        openSimulation(data)
        if (recovered) setSaveStatus(recovered.status)
        setLoadState('ready')
        return loadMesh(data.faceModelId, controller.signal).catch((error: unknown) => {
          if (!aborted(error)) setMeshFailed(true)
        })
      })
      .catch((error: unknown) => {
        if (aborted(error)) return
        setLoadState(error instanceof ApiError && error.isNotFound ? 'notFound' : 'failed')
      })
    return () => {
      controller.abort()
      useEditStore.getState().reset()
    }
  }, [simulationId, openSimulation, loadMesh, setSaveStatus])

  const approvalPending =
    simulation?.simulationId === simulationId && simulation.editApprovalPending
  useEffect(() => {
    if (!approvalPending) return
    const controller = new AbortController()
    const poll = () => {
      getSimulation(simulationId, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return
          setSimulation((current) =>
            current?.simulationId === simulationId
              ? {
                  ...current,
                  editApprovalPending: data.editApprovalPending,
                  capabilities: data.capabilities,
                  eyeReview: data.eyeReview,
                  eyePartsSha256: data.eyePartsSha256,
                  eyeCapabilities: data.eyeCapabilities,
                  editRanges: data.editRanges,
                  weightShapeSupported: data.weightShapeSupported,
                }
              : current,
          )
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) timer = window.setTimeout(poll, 5000)
        })
    }
    let timer = window.setTimeout(poll, 5000)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [approvalPending, simulationId, setSimulation])

  /** 실패 처리. 최신 상태를 다시 읽어야 하는 코드면 EDIT-03을 다시 부른다 */
  const handleError = useCallback(
    async (
      error: unknown,
      message = error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
    ) => {
      if (error instanceof ApiError && (error.needsRefetch || REFETCH_ALSO.has(error.code))) {
        feedbackToast(message)
        return loadSimulation().then(
          () => true,
          () => false,
        )
      }
      feedbackToast(message)
      return false
    },
    [loadSimulation],
  )

  /**
   * 서버 편집 호출 하나를 줄 세워 돌리고 결과를 반영한다.
   * `settle`은 응답(성공·실패)을 화면에 반영하기 직전에 부른다. 저장이 지키던 화면 값을 놓아 주는 자리다.
   * `onFailed`는 실패 처리(handleError) 뒤에 부른다. 인자는 최신 상태를 다시 읽었는지다.
   * `failureMessage`가 문구를 주면 일반 오류 문구 대신 그것을 띄운다(알림은 하나).
   */
  const mutate = useCallback(
    (
      call: (version: number) => Promise<EditResult | null>,
      discardPreview = false,
      settle?: () => void,
      onFailed?: (refreshed: boolean) => void,
      failureMessage?: (error: unknown) => string | null,
    ) =>
      run(async () => {
        if (
          loadContext.current?.signal.aborted ||
          useEditStore.getState().simulationId !== simulationId
        ) {
          settle?.()
          if (settle && !queuedEyes.current && !queued.current.size) setSavingGroup(null)
          return null
        }
        setSaveStatus('saving')
        let result: EditResult | null
        try {
          result = await call(useEditStore.getState().version)
        } catch (error) {
          settle?.()
          const historyEmpty = error instanceof ApiError && HISTORY_EMPTY.has(error.code)
          const refreshed = await handleError(error, failureMessage?.(error) ?? undefined)
          onFailed?.(refreshed)
          if (settle && !queuedEyes.current && !queued.current.size) setSavingGroup(null)
          setSaveStatus(
            historyEmpty
              ? settledStatus.current
              : refreshed && error instanceof ApiError && error.code === ErrorCode.VERSION_CONFLICT
                ? 'idle'
                : 'error',
          )
          return null
        }
        settle?.()
        if (settle && !queuedEyes.current && !queued.current.size) setSavingGroup(null)
        if (result && !applyEditResult(result, discardPreview)) return null
        setSaveStatus('saved')
        return result
      }, discardPreview),
    [run, applyEditResult, handleError, setSaveStatus, simulationId],
  )

  /** 슬라이더를 움직이는 동안. 3D만 바꾼다 */
  const previewChanges = useCallback((changes: readonly MorphValueChange[]) => {
    if (previewBarriers.current) return
    const store = useEditStore.getState()
    for (const { code } of changes) {
      if (!baseline.current.has(code))
        baseline.current.set(code, store.morphState.weights[code] ?? 0)
      pending.current.add(code)
      previewRevisions.current.set(code, (previewRevisions.current.get(code) ?? 0) + 1)
    }
    store.setWeights(Object.fromEntries(changes.map(({ code, value }) => [code, value])))
  }, [])

  const previewEyes = useCallback((eyeEdit: EyeState) => {
    if (previewBarriers.current) return
    const store = useEditStore.getState()
    if (!pendingEye.current) eyeBaseline.current = store.morphState.eyeEdit ?? null
    pendingEye.current = eyeEdit
    eyeRevision.current += 1
    useEditStore.setState({
      morphState: { ...store.morphState, eyeEdit },
      isDirty: true,
    })
  }, [])

  const commitEyes = useCallback(() => {
    if (previewBarriers.current) return Promise.resolve(null)
    const eyeEdit = pendingEye.current
    if (!eyeEdit) return Promise.resolve(null)
    const before = eyeBaseline.current
    const revision = eyeRevision.current
    pendingEye.current = null
    eyeBaseline.current = null
    if (JSON.stringify(eyeEdit) === JSON.stringify(before ?? newEyeState())) {
      useEditStore.setState({
        isDirty: pending.current.size > 0 || queued.current.size > 0 || queuedEyes.current > 0,
      })
      return Promise.resolve(null)
    }
    beginEditAction()
    queuedEyes.current += 1
    setSavingGroup('face')
    return mutate(
      (version) => updateEyeState(simulationId, version, eyeEdit),
      false,
      () => {
        queuedEyes.current -= 1
      },
    ).then((result) => {
      if (
        !result &&
        !resetView.current &&
        !pendingEye.current &&
        eyeRevision.current === revision
      ) {
        const store = useEditStore.getState()
        if (store.morphState.eyeEdit === eyeEdit)
          useEditStore.setState({
            morphState: { ...store.morphState, eyeEdit: savedState.current?.eyeEdit ?? null },
            isDirty: pending.current.size > 0 || queued.current.size > 0 || queuedEyes.current > 0,
          })
      }
      return result
    })
  }, [mutate, simulationId])

  /**
   * 손을 뗐다. 움직인 항목만 한 번에 저장한다(undo 1단계).
   * 저장되면 항목별 움직이기 전 값 → 서버가 저장한 값(보낸 값은 `requested`)을 돌려준다(실패·보낼 것 없음은 null).
   * 응답이 올 때까지 손을 뗀 값을 그대로 보인다(`queued`). 서버가 안전 범위로 줄였으면 응답에서 한 번 옮긴다.
   * `onChanges`는 보낼 항목이 있을 때 저장 줄에 올리기 전에 바로 부른다(움직이기 전 값 → 손을 뗀 값, -839).
   * 한계 알림을 응답 뒤가 아니라 손을 뗀 순간 띄우기 위해서다(-852). 실패하면 handleError가 오류 알림으로 바꾼다.
   * `describeRevert`는 실패로 원래 값으로 돌아간 항목(뒤에 다시 줄 선 항목 제외)과 오류 코드를 받아 그 오류 알림 문구를 정한다.
   * 코 검사기가 거절(EDIT_032·EDIT_031)해 다시 읽으면 어떤 항목이 돌아갔는지 짚으려고 쓴다. null이면 일반 오류 문구다.
   */
  const commit = useCallback(
    (
      onChanges?: (changes: SliderChange[]) => void,
      recoverOnReload = false,
      describeRevert?: (codes: string[], errorCode: string) => string | null,
    ): Promise<SliderChange[] | null> => {
      if (previewBarriers.current) return Promise.resolve(null)
      if (!pending.current.size) return Promise.resolve(null)
      const weights = useEditStore.getState().morphState.weights
      const changes = [...pending.current]
        .filter((code) => (weights[code] ?? 0) !== (baseline.current.get(code) ?? 0))
        .map((code) => ({ code, value: weights[code] ?? 0 }))
      const before = new Map(changes.map(({ code }) => [code, baseline.current.get(code) ?? 0]))
      const revisions = new Map(
        changes.map(({ code }) => [code, previewRevisions.current.get(code)]),
      )
      pending.current.clear()
      baseline.current.clear()
      if (!changes.length) {
        useEditStore.setState({
          isDirty: queued.current.size > 0 || pendingEye.current !== null || queuedEyes.current > 0,
        })
        return Promise.resolve(null)
      }
      const action = beginEditAction()
      const forget = recoverOnReload
        ? rememberRecommendation(simulationId, useEditStore.getState().version, changes)
        : undefined
      onChanges?.(
        changes.map(({ code, value }) => ({ code, from: before.get(code) ?? 0, to: value })),
      )
      for (const { code } of changes) queued.current.set(code, (queued.current.get(code) ?? 0) + 1)
      setSavingGroup(changes.some(({ code }) => code === WEIGHT_SHAPE_CODE) ? 'weight' : 'face')
      const settle = () => {
        for (const { code } of changes) {
          const left = (queued.current.get(code) ?? 1) - 1
          if (left > 0) queued.current.set(code, left)
          else queued.current.delete(code)
        }
      }
      let sentVersion: number | null = null
      const save = (version: number) => {
        sentVersion = version
        return updateMorphState(simulationId, version, changes).then(
          (result) => {
            forget?.()
            return result
          },
          (error: unknown) => {
            if (!uncertainRecommendationSave(error)) forget?.()
            throw error
          },
        )
      }
      // settle 뒤에 불려 queued에는 이 저장 뒤에 다시 줄 선 항목만 남는다. 그 항목은 화면에 남으니 돌렸다고 하지 않는다
      const revertMessage = (error: unknown) =>
        describeRevert && error instanceof ApiError
          ? describeRevert(
              changes.map(({ code }) => code).filter((code) => !queued.current.has(code)),
              error.code,
            )
          : null
      return mutate(save, false, settle, undefined, revertMessage).then((result) => {
        if (!result) {
          const store = useEditStore.getState()
          if (store.simulationId !== simulationId) return null
          // 최신 상태를 다시 읽었으면 화면은 이미 서버 값이다. 움직이기 전 값으로 한 번 더 옮기지 않는다
          if (store.version !== sentVersion) {
            useEditStore.setState({
              isDirty:
                pending.current.size > 0 ||
                queued.current.size > 0 ||
                pendingEye.current !== null ||
                queuedEyes.current > 0,
            })
            return null
          }
          // 처음으로가 원본을 보이고 있다. 실패한 저장 값을 되살리지 않는다
          if (resetView.current) return null
          const restored = { ...store.morphState.weights }
          for (const { code, value } of changes) {
            if (
              !pending.current.has(code) &&
              revisions.get(code) === previewRevisions.current.get(code) &&
              restored[code] === value
            ) {
              const previous = savedState.current?.weights[code] ?? 0
              if (previous === 0) delete restored[code]
              else restored[code] = previous
            }
          }
          useEditStore.setState({
            morphState: {
              ...store.morphState,
              weights: reconcileNosePreview(restored, savedState.current?.weights ?? {}),
            },
            isDirty:
              pending.current.size > 0 ||
              queued.current.size > 0 ||
              pendingEye.current !== null ||
              queuedEyes.current > 0,
          })
          return null
        }
        // 저장 뒤 다른 편집(처음으로·되돌리기·다음 저장 등)을 이미 요청했다. 지난 저장은 알리지 않는다
        if (!isLatestEditAction(action)) return null
        return changes.map(({ code, value }) => ({
          code,
          from: before.get(code) ?? 0,
          to: result.morphState.weights[code] ?? 0,
          requested: value,
        }))
      })
    },
    [mutate, reconcileNosePreview, simulationId],
  )

  const clearWeightShape = useCallback(
    () =>
      mutate(
        (version) =>
          updateMorphState(simulationId, version, [{ code: WEIGHT_SHAPE_CODE, value: 0 }]),
        true,
      ),
    [mutate, simulationId],
  )

  /**
   * 되돌리기·앞으로 가기. 서버 요약 문구(`…변경을 취소했어요`)는 쓰지 않고, 바뀐 항목(전 → 후 가중치)을 돌려준다.
   * 알림 문구는 화면이 슬라이더와 같은 모양으로 만든다(useChangeSummary). 실패면 null.
   */
  const moveHistory = useCallback(
    (send: typeof undoEdit) => {
      const action = beginEditAction()
      let before: Record<string, number> = {}
      return mutate(async (version) => {
        before = { ...useEditStore.getState().morphState.weights }
        const signal = loadContext.current?.signal
        for (const retry of [false, true]) {
          try {
            return await send(simulationId, version)
          } catch (error) {
            const unavailable = error instanceof ApiError && [502, 503, 504].includes(error.status)
            if (!(error instanceof NetworkError) && !unavailable) throw error
            const latest = await loadSimulation(signal)
            // 다른 버전이면 서버 값을 표시하고 같은 동작을 한 번 더 보내지 않는다.
            if (latest.stateVersion !== version) return null
            if (retry) throw error
          }
        }
        return null
      }, true).then((result) =>
        result && isLatestEditAction(action)
          ? diffWeights(before, result.morphState.weights)
          : null,
      )
    },
    [loadSimulation, mutate, simulationId],
  )
  const undo = useCallback(() => moveHistory(undoEdit), [moveHistory])
  const redo = useCallback(() => moveHistory(redoEdit), [moveHistory])

  /**
   * 처음으로. 줄 선 저장을 기다리지 않고 원본(서버가 돌려줄 상태, `originalMorphState`)을 바로 보이고 알림도 바로 띄운다.
   * 앞에 줄 선 저장은 그대로 순서대로 보내고(이력 유지) 그 뒤에 EDIT-07을 보낸다. 응답이 올 때까지 앞 저장 응답은 화면을 바꾸지 않는다.
   * 실패하면 마지막 서버 상태(+ 누르기 전 아직 안 보낸 미리보기)로 돌리고, handleError가 오류 알림으로 바꾼다.
   * 알림의 `되돌리기`는 `onUndo`(화면이 알림까지 붙인 되돌리기)를 부른다. 없으면 그냥 되돌린다.
   * 처음으로가 끝나기 전에 눌러도 처음으로가 성공한 뒤에 보낸다(실패했으면 보내지 않는다).
   */
  const reset = useCallback(
    (onUndo?: () => unknown): Promise<EditResult | null> => {
      const store = useEditStore.getState()
      if (store.simulationId !== simulationId) return Promise.resolve(null)
      beginEditAction()
      const shown = store.morphState
      const preview = {
        codes: new Set(pending.current),
        baseline: new Map(baseline.current),
        revisions: new Map(previewRevisions.current),
        eye: pendingEye.current,
        eyeBaseline: eyeBaseline.current,
      }
      pending.current.clear()
      baseline.current.clear()
      previewRevisions.current.clear()
      pendingEye.current = null
      eyeBaseline.current = null
      const original = originalMorphState(shown)
      resetView.current = original
      resetsInFlight.current += 1
      setResetting(true)
      useEditStore.setState({ morphState: original, isDirty: true })

      const settle = () => {
        resetsInFlight.current -= 1
        if (resetsInFlight.current > 0) return
        resetView.current = null
        setResetting(false)
      }
      const restore = (refreshed: boolean) => {
        // 최신 상태를 다시 읽었으면 화면은 이미 서버 값이다
        if (refreshed || resetView.current) return
        const current = useEditStore.getState()
        if (current.simulationId !== simulationId) return
        const saved = savedState.current ?? current.morphState
        for (const code of preview.codes) pending.current.add(code)
        for (const [code, value] of preview.baseline) baseline.current.set(code, value)
        for (const [code, value] of preview.revisions) previewRevisions.current.set(code, value)
        pendingEye.current = preview.eye
        eyeBaseline.current = preview.eyeBaseline
        useEditStore.setState({
          morphState: {
            ...saved,
            weights: reconcileNosePreview(
              overlayPending(saved.weights, shown.weights, preview.codes),
              saved.weights,
            ),
            eyeEdit: preview.eye ?? saved.eyeEdit ?? null,
          },
          isDirty: pending.current.size > 0 || pendingEye.current !== null,
        })
      }

      let request: Promise<EditResult | null> = Promise.resolve(null)
      feedbackToast('처음 상태로 돌렸어요', {
        action: {
          label: '되돌리기',
          onClick: () => void request.then((result) => (result ? (onUndo ?? undo)() : null)),
        },
      })
      request = mutate((version) => resetEdit(simulationId, version), true, settle, restore)
      return request
    },
    [mutate, reconcileNosePreview, simulationId, undo],
  )

  /**
   * 편집실 `완료`(S15P31B204-844). 아직 안 보낸 미리보기(슬라이더·눈)를 보내고, 줄 선 서버 호출이 모두 끝날 때까지 기다린다.
   * 기다리는 사이 줄에 더 붙은 호출(재조회 등)도 기다린다. 다 끝나면 그때의 시안을 돌려준다(이름·바꾼 것 여부가 최신).
   * 기다리는 동안 저장이 실패했으면 null — 부른 쪽은 화면을 떠나지 않는다. 실패 뒤에는 서버 상태를 다시 읽어 두므로(handleError),
   * 한 번 더 누르면 지금 보이는 서버 상태로 떠날 수 있다
   */
  const flush = useCallback(async (): Promise<Simulation | null> => {
    const before = failures.current
    await Promise.all([commit(), commitEyes()])
    let current: Promise<unknown>
    do {
      current = queue.current
      await current
    } while (current !== queue.current)
    return failures.current === before ? latestSimulation.current : null
  }, [commit, commitEyes])

  /** API-HIS-05 시안 이름 바꾸기(도구 줄 제목, -812). 실패는 호출한 쪽이 보인다 */
  const rename = useCallback(
    async (title: string) => {
      const saved = await renameSimulation(simulationId, title)
      setSimulation((prev) => (prev ? { ...prev, title: saved.title } : prev))
      return saved
    },
    [simulationId, setSimulation],
  )

  /** 3D를 못 불러왔다. presigned 주소가 만료됐을 수 있어 HIS-02를 다시 부른다 */
  const onMeshError = useCallback(() => {
    const faceModelId = simulation?.faceModelId
    if (!faceModelId || meshRetries.current >= MESH_RETRY_LIMIT) {
      setMeshFailed(true)
      return
    }
    meshRetries.current += 1
    loadMesh(faceModelId).catch(() => setMeshFailed(true))
  }, [simulation?.faceModelId, loadMesh])

  return {
    simulation,
    loadState,
    saveStatus,
    meshUrl,
    rigUrl,
    expressionUrl,
    meshFailed,
    previewEyes,
    commitEyes,
    run,
    applyEditResult,
    handleError,
    reload: loadSimulation,
    previewChanges,
    previewBlocked,
    savingGroup,
    commit,
    clearWeightShape,
    undo,
    redo,
    reset,
    resetting,
    rename,
    flush,
    onMeshError,
    setSaveStatus,
  }
}

export type SimulationEditor = ReturnType<typeof useSimulationEditor>
