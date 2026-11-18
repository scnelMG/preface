import type { AppNotification } from './types'

/**
 * 알림을 누르면 갈 곳 (API-NOTI-01 "FE 이동", FN-REC-03 수용 5).
 *
 * - `FACE_MODEL`(복원 성공) → 작업실에서 그 머리를 고른 상태. 서버는 jobId가 아니라 faceModelId를 준다
 *   (services/backend ReconstructionFinisher: `reconSucceeded(userId, model.getId())`).
 *   작업실(S15P31B204-275 `studioHref`)과 같은 `?faceModelId=<id>` 형식을 쓴다.
 * - `RECON_JOB`(복원 실패) → 복원 실패·재촬영 안내(SCR-09). `/reconstructions/{jobId}`가 실패 상태를 그린다.
 *
 * 종류(type)보다 대상(target.kind)을 먼저 본다. 대상이 없거나 모르는 종류면 null(이동하지 않음).
 */
export function notificationHref(notification: Pick<AppNotification, 'target'>): string | null {
  const target = notification.target
  if (!target?.id) return null
  const id = encodeURIComponent(target.id)
  switch (target.kind) {
    case 'FACE_MODEL':
      return `/studio?faceModelId=${id}`
    case 'RECON_JOB':
      return `/reconstructions/${id}`
    default:
      return null
  }
}
