import { getReconstruction } from '@/features/reconstruction/api'
import { useReconstructionStore } from '@/features/reconstruction/store'
import type { ReconstructionJob } from '@/features/reconstruction/types'

/** 진행 팝업은 진행 중(QUEUED·RUNNING) 작업만 그린다 */
function isActive(job: ReconstructionJob) {
  return job.status === 'QUEUED' || job.status === 'RUNNING'
}

/**
 * 휴대폰 업로드로 생긴 작업을 하단 진행 팝업(ProgressDock, S15P31B204-196)에 바로 알린다.
 *
 * QR-03은 `jobId`만 주므로 REC-02를 한 번 불러 작업 전체를 받는다. 이미 작업을 받았으면(REC-03) 그대로 쓴다.
 * 실패해도 화면 이동은 막지 않는다. 생성 대기 화면이 다시 알려 줄 수 있다.
 */
export async function trackUploadedJob(jobId: string, known?: ReconstructionJob): Promise<void> {
  try {
    const job = known ?? (await getReconstruction(jobId))
    if (job && isActive(job)) useReconstructionStore.getState().track(job)
  } catch {
    // 진행 팝업은 보조 표시다. 못 띄워도 흐름은 그대로다
  }
}
