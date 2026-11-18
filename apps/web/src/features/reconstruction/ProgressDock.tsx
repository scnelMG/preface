'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Suspense, useEffect, useRef } from 'react'
import { useAuthStore } from '@/features/auth/store'
import { RECON_NOTIFICATION_TAG, showBrowserNotification } from '@/features/notifications/browser'
import { refreshUnread } from '@/features/notifications/unread'
import { studioHref } from '@/features/studio/heads'
import { getCurrentReconstruction, getReconstruction } from './api'
import { createDockPoller } from './dockPoller'
import {
  DOCK_POSITION_CLASS,
  FailedDockCard,
  ProgressDockCard,
  SucceededDockCard,
} from './ProgressDockCard'
import { useReconstructionStore } from './store'
import type { ReconstructionJob } from './types'

/**
 * 3D 생성 중 하단 진행 팝업(REQ-F-08, FN-REC-03 수용 4·6). `(app)`·`(public)` 레이아웃에 한 번씩 붙인다
 * (회원 화면과 메인·서비스·체험 화면 어디서든 보이게. 휴대폰 촬영 `(capture)`에는 붙이지 않는다).
 *
 * - 회원(`status === 'member'`)일 때만 조회한다. 토큰이 없으면 API를 부르지 않는다.
 * - 회원이 되면 API-REC-03을 한 번 불러 진행 중 작업을 되찾는다(새로고침 복구).
 *   진행 중 작업이 있으면 10초, 없으면 보이는 탭에서 30초 간격으로 다시 묻는다(`dockPoller.ts`, -790).
 *   탭이 다시 보이거나 창에 포커스가 오면 바로 한 번 묻는다. 다른 탭·기기에서 시작한 작업도 새로고침 없이 팝업이 뜬다.
 * - 끝나면 이 팝업 자리에 결과 카드를 남긴다(진행을 보던 곳에서 결과도 본다). 성공은 완성 카드(-909, 전에는 8초 토스트)로,
 *   누르면 작업실(새 모델)로 가며 내리고 ✕로도 내린다. 실패는 실패 카드(2026-11-01 사용자 결정)로,
 *   진행 카드처럼 닫기 없이 실패 안내를 보면 내린다. REC-03을 `includeRecentFailed`로 물어, 새로고침해도
 *   확인하지 않은 최근 실패(24시간)는 다시 보인다. 탭을 떠나 있고 알림 권한이 있으면 브라우저 알림도 띄운다(FN-REC-03 수용 7).
 *   그리고 안 읽은 알림을 바로 다시 물어(`refreshUnread({ force: true })`) 헤더 알림 점을 60초 주기를 기다리지 않고 켠다.
 * - 생성 진행 화면(`/reconstructions/...`)에서는 어느 작업의 화면이든 카드를 숨긴다(-909). 다른 작업의 카드가 겹쳐 보이면
 *   진도가 다르다고 오해한다. 폴링은 그 작업의 화면일 때만 쉰다. 그 화면이 REC-02를 3초 간격으로 묻고 결과를 이 스토어에
 *   넣는다(중복 폴링 방지). 다른 작업의 화면이면 그 작업은 계속 추적한다. 화면을 떠나면 바로 한 번 묻고 다시 잇는다.
 *
 * usePathname()은 `<Suspense>` 안에서만 읽을 수 있어 감싼다(apps/web/AGENTS.md "동적 라우트는 <Suspense>가 필요하다").
 * 기다리는 동안에는 아무것도 그리지 않는다 — 서버 렌더 때는 진행 중 작업을 모른다.
 */
export function ProgressDock() {
  return (
    <Suspense fallback={null}>
      <ConnectedProgressDock />
    </Suspense>
  )
}

function ConnectedProgressDock() {
  const pathname = usePathname()
  const router = useRouter()
  const isMember = useAuthStore((s) => s.status === 'member')
  const job = useReconstructionStore((s) => s.job)
  const failed = useReconstructionStore((s) => s.failed)
  const succeeded = useReconstructionStore((s) => s.succeeded)
  const dismissSuccess = useReconstructionStore((s) => s.dismissSuccess)

  // 폴링 콜백이 늘 최신 경로·라우터를 보게 한다(effect를 다시 돌리지 않으려고 ref로 둔다)
  const latest = useRef({ pathname, router })
  useEffect(() => {
    latest.current = { pathname, router }
  }, [pathname, router])

  const onJobPage = job !== null && pathname === resultPath(job.jobId)

  useDockPolling(isMember, onJobPage, (finished) => {
    const { pathname: now, router: nav } = latest.current
    announceFinished(finished, {
      isOnResultPage: now === resultPath(finished.jobId),
      open: () => nav.push(finishedHref(finished)),
    })
  })

  // 생성 진행 화면에서는 그 화면이 진행·결과를 보여 준다. 다른 작업의 카드도 겹쳐 띄우지 않는다
  if (!isMember || isReconstructionPath(pathname)) return null
  if (job) {
    return (
      <div className={DOCK_POSITION_CLASS}>
        <ProgressDockCard job={job} />
      </div>
    )
  }
  if (succeeded) {
    return (
      <div className={DOCK_POSITION_CLASS}>
        <SucceededDockCard job={succeeded} onDismiss={dismissSuccess} />
      </div>
    )
  }
  if (!failed) return null
  return (
    <div className={DOCK_POSITION_CLASS}>
      <FailedDockCard job={failed} />
    </div>
  )
}

function isReconstructionPath(pathname: string | null) {
  return pathname?.startsWith('/reconstructions/') ?? false
}

/** 성공은 작업실(새 모델을 가운데 둔다), 실패나 모델 id가 없으면 생성 대기 화면 */
function finishedHref(job: ReconstructionJob) {
  return job.status === 'SUCCEEDED' && job.faceModelId
    ? studioHref({ faceModelId: job.faceModelId })
    : resultPath(job.jobId)
}

function resultPath(jobId: string) {
  return `/reconstructions/${jobId}`
}

/**
 * 폴링을 켜고 끈다. 회원이 아니게 되면(로그아웃) 멈추고 추적하던 작업을 비운다.
 * `paused`(그 작업의 대기 화면)면 작업은 그대로 두고 폴링만 쉰다.
 */
function useDockPolling(
  enabled: boolean,
  paused: boolean,
  onFinished: (job: ReconstructionJob) => void,
) {
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  })

  useEffect(() => {
    if (!enabled) {
      useReconstructionStore.getState().clear()
      return
    }
    if (paused) return

    const store = useReconstructionStore
    const poller = createDockPoller({
      fetchCurrent: async (signal) => {
        const current = await getCurrentReconstruction({ includeRecentFailed: true, signal })
        // 최근 실패는 진행 중 작업이 아니다. 실패 카드로만 넘기고 폴링에는 '진행 중 없음'으로 준다
        if (current?.status !== 'FAILED') return current
        store.getState().showFailure(current)
        return null
      },
      fetchJob: (jobId, signal) => getReconstruction(jobId, signal),
      getTracked: () => store.getState().job,
      setTracked: (job) => (job ? store.getState().track(job) : store.getState().clear()),
      onFinished: (job) => onFinishedRef.current(job),
      isHidden: () => document.visibilityState === 'hidden',
    })

    // 새로고침·로그인 직후: 진행 중 작업을 되찾는다
    void poller.pollNow()

    // 다른 화면이 track()으로 새 작업을 알려 주면 폴링을 잇는다
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.job && state.job.jobId !== previous.job?.jobId) poller.ensureScheduled()
    })

    // 탭이 다시 보이거나 창에 포커스가 오면 바로 한 번 묻는다(추적 중이 아니어도, -790).
    // 숨겨진 동안은 poller가 간격을 늘리거나(추적 중) 쉰다(작업 없음). 둘이 겹쳐 와도 refresh()가 한 번만 묻는다
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void poller.refresh()
    }
    const onFocus = () => void poller.refresh()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      poller.stop()
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [enabled, paused])
}

const SUCCESS_TITLE = '원본 3D가 생성됐어요'
const FAILURE_TITLE = '3D를 만들지 못했어요'

/**
 * 완료·실패 알림. 문구는 API-NOTI-01 예시(서버 인앱 알림)와 맞춘다.
 * 결과 화면에 이미 있으면 그 화면이 결과를 보여 주므로 완성·실패 카드를 띄우지 않는다.
 * 그 밖에서는 성공은 완성 카드, 실패는 실패 카드로 진행 팝업 자리에 남긴다(토스트는 쓰지 않는다, -909).
 *
 * 완료를 알게 된 곳(진행 팝업·생성 대기 화면)이 모두 이 함수를 부르므로, 여기서 안 읽은 알림도 바로 다시 묻는다
 * (`refreshUnread({ force: true })`). 서버가 만든 완료 알림(API-NOTI-01)으로 헤더 점을 60초 주기를 기다리지 않고 켠다.
 *
 * 브라우저 알림은 `features/notifications/browser`의 helper 하나로 띄운다. 탭이 숨겨져 있고 권한이 이미 있을 때만
 * 뜬다(`onlyWhenHidden`). 권한 요청은 복원을 시작하는 클릭(머리 추가의 "영상 촬영하기")이 맡는다.
 * 헤더 조회기(`refreshUnread`)도 같은 완료를 같은 tag(`preface-recon`)로 알릴 수 있다. 브라우저가 한 장으로 바꿔 끼운다.
 */
export function announceFinished(
  job: ReconstructionJob,
  { isOnResultPage, open }: { isOnResultPage: boolean; open: () => void },
) {
  const succeeded = job.status === 'SUCCEEDED'
  if (job.status !== 'SUCCEEDED' && job.status !== 'FAILED') return

  void refreshUnread({ force: true })

  showBrowserNotification(succeeded ? SUCCESS_TITLE : FAILURE_TITLE, {
    body: succeeded ? '눌러서 결과를 확인해 보세요.' : '이유와 고치는 방법을 확인해 주세요.',
    tag: RECON_NOTIFICATION_TAG,
    onlyWhenHidden: true,
    onClick: open,
  })

  if (isOnResultPage) return
  const store = useReconstructionStore.getState()
  if (succeeded) store.showSuccess(job)
  else store.showFailure(job)
}
