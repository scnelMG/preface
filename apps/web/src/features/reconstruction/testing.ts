import type { ReconstructionJob } from './types'

/** 시험·개발 페이지용 가짜 작업. 실제 서버 값이 아니다 */
export function fakeJob(overrides: Partial<ReconstructionJob> = {}): ReconstructionJob {
  return {
    jobId: 'job-test-1',
    status: 'RUNNING',
    stage: 'QUALITY_CHECK',
    stageIndex: 2,
    queuePosition: null,
    failCodes: [],
    faceModelId: null,
    createdAt: '2026-10-25T06:30:00Z',
    startedAt: '2026-10-25T06:30:05Z',
    finishedAt: null,
    ...overrides,
  }
}
