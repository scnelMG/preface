import { ApiError, NetworkError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { getSimulation, updateMorphState } from './api'
import type { MorphValueChange } from './noseControls'
import type { Simulation } from './types'

type PendingSave = { version: number; changes: MorphValueChange[]; expires: number }

function storageKey(id: string) {
  return 'preface:recommendation-save:' + id
}

export function rememberRecommendation(id: string, version: number, changes: MorphValueChange[]) {
  try {
    const record: PendingSave = { version, changes, expires: Date.now() + 10 * 60 * 1000 }
    const value = JSON.stringify(record)
    const key = storageKey(id)
    sessionStorage.setItem(key, value)
    return () => {
      try {
        if (sessionStorage.getItem(key) === value) sessionStorage.removeItem(key)
      } catch {
        // 저장은 서버에서 이미 끝났다.
      }
    }
  } catch {
    // 저장소가 제한된 브라우저에서도 현재 화면의 저장은 계속한다.
    return undefined
  }
}

export function uncertainRecommendationSave(error: unknown) {
  return error instanceof NetworkError || (error instanceof ApiError && error.status >= 500)
}

export async function recoverRecommendation(data: Simulation, signal: AbortSignal) {
  const key = storageKey(data.simulationId)
  let raw: string | null
  let saved: PendingSave
  try {
    raw = sessionStorage.getItem(key)
    if (!raw) return null
    saved = JSON.parse(raw)
    if (
      !saved ||
      !(saved.expires > Date.now()) ||
      !Number.isSafeInteger(saved.version) ||
      !Array.isArray(saved.changes) ||
      !saved.changes.length ||
      saved.changes.length > 8 ||
      !saved.changes.every(
        (change) =>
          change &&
          /^(?:nose|contour)\.[a-z_]+$/.test(change.code) &&
          Number.isFinite(change.value),
      )
    ) {
      sessionStorage.removeItem(key)
      return null
    }
  } catch {
    return null
  }

  const finish = (current: Simulation, ok: boolean, forget = true) => {
    signal.throwIfAborted()
    if (forget) {
      try {
        if (sessionStorage.getItem(key) === raw) sessionStorage.removeItem(key)
      } catch {
        // 서버에서 읽은 상태는 그대로 표시한다.
      }
    }
    return { data: current, status: ok ? ('saved' as const) : ('error' as const) }
  }
  const matches = (current: Simulation) =>
    saved.changes.every(
      ({ code, value }) => Math.abs((current.morphState.weights[code] ?? 0) - value) < 0.000001,
    )
  signal.throwIfAborted()
  if (data.stateVersion !== saved.version) return finish(data, matches(data))

  try {
    const result = await updateMorphState(data.simulationId, saved.version, saved.changes)
    return finish({ ...data, ...result, hasChanges: data.hasChanges || result.canUndo }, true)
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof ApiError && error.code === ErrorCode.VERSION_CONFLICT) {
      // 새로고침 전 요청이 먼저 완료됐을 수 있다. 최신 버전에 같은 변경을 다시 쓰지 않는다.
      const latest = await getSimulation(data.simulationId, signal).catch(() => null)
      return latest ? finish(latest, matches(latest)) : finish(data, false, false)
    }
    return finish(data, false, !uncertainRecommendationSave(error))
  }
}
