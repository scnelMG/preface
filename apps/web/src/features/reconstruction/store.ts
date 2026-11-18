import { create } from 'zustand'
import { isFailureSeen, markFailureSeen } from './seenFailures'
import type { ReconstructionJob } from './types'

/**
 * 진행 중인 3D 생성 작업(전역). 하단 진행 팝업(ProgressDock)이 이 값을 그린다.
 *
 * 어느 화면에 있든 팝업이 떠 있어야 해서(REQ-F-08, FN-REC-03 수용 4·6) 화면 상태가 아니라 전역에 둔다.
 * 값을 채우는 길은 둘이다.
 *
 * - `track(job)`: 작업을 만든 화면(API-REC-01 응답)이나 생성 대기 화면이 알려 준다. 바로 팝업이 뜨고 폴링이 시작된다.
 * - `ProgressDock`의 폴링: 회원 상태가 되면 API-REC-03을 한 번 불러 진행 중 작업을 되찾는다(새로고침 복구).
 *   그 뒤 진행 중 작업이 있는 동안만 10초 간격으로 다시 묻는다(`dockPoller.ts`).
 *
 * 진행 중 팝업에는 닫기가 없다(Figma `v3/ProgressDock` 설명: "닫기 없음(비동기 작업)").
 * 끝나면 같은 자리에 결과 카드를 남긴다. 진행을 보던 곳에서 결과도 보게 한다.
 * - 실패: 실패 카드(`failed`, 2026-11-01 사용자 결정). 닫기 없이, 실패 안내(SCR-09)를 보면 내린다(`acknowledgeFailure`).
 * - 성공: 완성 카드(`succeeded`, S15P31B204-909). 전에는 8초 토스트였다. 누르면 작업실(새 모델)로 가며 내리고, ✕로도 내린다.
 *   이 탭의 메모리에만 둔다(새로고침하면 사라진다). 성공은 헤더 알림(API-NOTI-01)에도 남는다.
 */
interface ReconstructionState {
  /** 진행 중(QUEUED·RUNNING)인 작업. 없으면 null */
  job: ReconstructionJob | null
  /** 아직 확인하지 않은 실패. 진행 중 작업이 없을 때 팝업 자리에 실패 카드로 보인다 */
  failed: ReconstructionJob | null
  /** 이 탭에서 끝난 것을 본 성공. 진행 중 작업이 없을 때 팝업 자리에 완성 카드로 보인다 */
  succeeded: ReconstructionJob | null

  /** 진행 중 작업을 추적한다. 같은 작업이면 상태만 갈아 끼운다. 새로 찍기 시작하면 지난 실패·완성 카드는 내린다 */
  track: (job: ReconstructionJob) => void
  /** 실패를 팝업 자리에 띄운다. 이 기기에서 이미 확인한 실패면 띄우지 않는다 */
  showFailure: (job: ReconstructionJob) => void
  /** 실패를 확인했다(실패 안내를 봤다). 이 기기에 남기고 카드를 내린다 */
  acknowledgeFailure: (jobId: string) => void
  /** 성공을 팝업 자리에 완성 카드로 띄운다 */
  showSuccess: (job: ReconstructionJob) => void
  /** 완성 카드를 내린다(눌러서 작업실로 갔거나 ✕) */
  dismissSuccess: () => void
  clear: () => void
}

export const useReconstructionStore = create<ReconstructionState>((set) => ({
  job: null,
  failed: null,
  succeeded: null,
  track: (job) => set({ job, failed: null, succeeded: null }),
  showFailure: (job) => {
    if (!isFailureSeen(job.jobId)) set({ failed: job })
  },
  acknowledgeFailure: (jobId) => {
    markFailureSeen(jobId)
    set((state) => (state.failed?.jobId === jobId ? { failed: null } : {}))
  },
  showSuccess: (job) => set({ succeeded: job }),
  dismissSuccess: () => set({ succeeded: null }),
  clear: () => set({ job: null, failed: null, succeeded: null }),
}))
