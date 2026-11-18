import { isTerminal, type ReconstructionJob } from './types'

/**
 * 하단 진행 팝업용 폴링(API-REC-03). React와 떼어 두어 타이머만으로 시험할 수 있게 했다.
 *
 * 명세서 API-REC-03 사용처 ①:
 * - 진행 중 작업이 있는 동안 10초 간격으로 조회한다.
 * - 없어도 보이는 탭에서는 30초 간격으로 계속 묻는다(-790). 전에는 없으면 묻지 않아, 다른 탭·기기에서 시작한 작업이나
 *   첫 조회가 실패한 뒤의 작업은 새로고침 전까지 팝업이 뜨지 않았다. 숨긴 탭에서 작업이 없으면 묻지 않고, 보이면 `refresh()`로 바로 묻는다.
 * - `data: null`이 되면(또는 다른 작업이 오면) 추적하던 jobId로 API-REC-02를 **한 번** 불러 결과를 확인한다.
 *
 * 탭이 숨겨져 있으면 멈추지 않고 늦춘다(기본 60초). 완료 시 브라우저 알림을 띄우려면(FN-REC-03 수용 7)
 * 탭을 떠나 있어도 끝난 것을 알아야 해서다. 탭이 다시 보이면 `pollNow()`로 바로 한 번 묻는다.
 *
 * 전송 방식을 SSE로 바꾸게 되면 이 파일만 갈아 끼운다(apps/web/AGENTS.md "3D 복원 진행 상태").
 */
export interface DockPollerDeps {
  /** API-REC-03. 진행 중 작업이 없으면 null */
  fetchCurrent: (signal: AbortSignal) => Promise<ReconstructionJob | null>
  /** API-REC-02 */
  fetchJob: (jobId: string, signal: AbortSignal) => Promise<ReconstructionJob>
  getTracked: () => ReconstructionJob | null
  setTracked: (job: ReconstructionJob | null) => void
  /** 추적하던 작업이 SUCCEEDED·FAILED·CANCELED로 끝났다 */
  onFinished: (job: ReconstructionJob) => void
  isHidden: () => boolean
  /** 기본 10000 (REQ-F-08 "다른 화면 10초") */
  intervalMs?: number
  /** 탭이 숨겨졌을 때. 기본 60000 */
  hiddenIntervalMs?: number
  /** 진행 중 작업이 없을 때(보이는 탭). 기본 30000. 숨긴 탭에서는 묻지 않는다 */
  idleIntervalMs?: number
  /** `refresh()`가 이 시간 안에 다시 불리면 묻지 않는다. 기본 5000 */
  refreshGapMs?: number
}

export interface DockPoller {
  /** 예약을 지우고 지금 바로 묻는다. 이미 묻는 중이면 그 결과를 기다린다 */
  pollNow: () => Promise<void>
  /** 다음 조회를 지금 상태(추적 여부·탭 숨김)에 맞게 다시 예약한다 (`track()`으로 새 작업이 들어왔을 때) */
  ensureScheduled: () => void
  /** 탭이 다시 보이거나 창에 포커스가 왔을 때. 방금(refreshGapMs 안) 물었으면 건너뛰고, 아니면 바로 묻는다 */
  refresh: () => Promise<void>
  stop: () => void
}

export const DOCK_INTERVAL_MS = 10_000
export const DOCK_HIDDEN_INTERVAL_MS = 60_000
export const DOCK_IDLE_INTERVAL_MS = 30_000
export const DOCK_REFRESH_GAP_MS = 5_000

export function createDockPoller(deps: DockPollerDeps): DockPoller {
  const intervalMs = deps.intervalMs ?? DOCK_INTERVAL_MS
  const hiddenIntervalMs = deps.hiddenIntervalMs ?? DOCK_HIDDEN_INTERVAL_MS
  const idleIntervalMs = deps.idleIntervalMs ?? DOCK_IDLE_INTERVAL_MS
  const refreshGapMs = deps.refreshGapMs ?? DOCK_REFRESH_GAP_MS
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let stopped = false
  let lastStarted = -Infinity

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** 다음 조회까지 기다릴 시간. null이면 예약하지 않는다(숨긴 탭에서 진행 중 작업이 없을 때) */
  const nextDelay = () => {
    const hidden = deps.isHidden()
    if (deps.getTracked()) return hidden ? hiddenIntervalMs : intervalMs
    return hidden ? null : idleIntervalMs
  }

  const schedule = () => {
    clearTimer()
    if (stopped) return
    const delay = nextDelay()
    if (delay !== null) timer = setTimeout(() => void pollNow(), delay)
  }

  /** 추적하던 작업이 진행 목록에서 빠졌다. REC-02로 한 번 확인한다 */
  const settle = async (tracked: ReconstructionJob): Promise<ReconstructionJob> => {
    try {
      return await deps.fetchJob(tracked.jobId, controller.signal)
    } catch {
      // 404(지워졌거나 남의 작업) 등. 알릴 결과가 없으니 조용히 놓는다
      return { ...tracked, status: 'CANCELED' }
    }
  }

  const run = async () => {
    const tracked = deps.getTracked()
    try {
      const current = await deps.fetchCurrent(controller.signal)
      if (stopped) return

      if (tracked && current?.jobId !== tracked.jobId) {
        const latest = await settle(tracked)
        if (stopped) return
        if (isTerminal(latest.status)) {
          deps.setTracked(null)
          if (latest.status !== 'CANCELED') deps.onFinished(latest)
        } else if (!current) {
          // REC-03이 아직 못 따라왔다. 계속 추적한다
          deps.setTracked(latest)
          return
        }
      } else if (tracked && current && isTerminal(current.status)) {
        // 방어: REC-03은 진행 중만 내리지만, 끝난 작업이 오면 바로 마무리한다
        deps.setTracked(null)
        if (current.status !== 'CANCELED') deps.onFinished(current)
        return
      }

      if (current && !isTerminal(current.status)) deps.setTracked(current)
    } catch {
      // 네트워크 등 일시 실패. 다음 주기에 다시 묻는다
    }
  }

  const pollNow = () => {
    if (stopped) return Promise.resolve()
    clearTimer()
    if (!inFlight) lastStarted = Date.now()
    inFlight ??= run().finally(() => {
      inFlight = null
      schedule()
    })
    return inFlight
  }

  return {
    pollNow,
    ensureScheduled: () => {
      // 묻는 중이면 끝난 뒤 새 상태로 예약된다
      if (!inFlight) schedule()
    },
    refresh: () => {
      if (stopped || inFlight || Date.now() - lastStarted < refreshGapMs)
        return inFlight ?? Promise.resolve()
      return pollNow()
    },
    stop: () => {
      stopped = true
      clearTimer()
      controller.abort()
    },
  }
}
