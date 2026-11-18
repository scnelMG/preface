'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { getCurrentReconstruction } from '@/features/reconstruction/api'
import type { ReconstructionJob } from '@/features/reconstruction/types'
import { createCaptureLink, deleteCaptureLink, getCaptureLink } from './api'
import { trackUploadedJob } from './trackUploadedJob'
import { isLinkClosed, type CaptureLinkStatus, type CreatedCaptureLink } from './types'

/**
 * QR 휴대폰 연결(SCR-16)의 상태를 쥔다. 발급(QR-01) → 폴링(QR-03) → 끊기(QR-04).
 *
 * **전송 방식은 폴링이다**(이슈 S15P31B204-181에서 WebSocket 대신 폴링으로 결정).
 * 명세서 API-QR-03 비고대로 3초 간격으로 묻는다. 호출부는 결과만 쓰므로
 * 나중에 방식을 바꾸면 이 파일만 고친다.
 *
 * - 탭이 숨겨지면 묻지 않는다. 다시 보이면 바로 한 번 묻고 이어 간다(만료 시각은 Date 기준이라 어긋나지 않는다).
 * - 컴포넌트가 사라지면 진행 중인 요청을 끊고 타이머를 멈춘다.
 * - 3분 카운트다운은 서버 `expiresAt`과 이 기기 시계로 센다. 0이 되면 서버 응답을 기다리지 않고 만료로 보여 준다.
 *
 * 업로드 완료 감지(FN-CAP-04 수용 6)의 경계 (S15P31B204-191):
 * - `UPLOADED`인데 `jobId`가 아직 없으면 멈추지 않고 계속 묻는다(jobId가 와야 넘어갈 수 있다).
 * - 휴대폰이 연결된(CONNECTED) 뒤 링크가 사라지거나(404·410·QR_001) EXPIRED가 되면 업로드가 끝나 링크가 정리된 것일 수 있다.
 *   그때는 API-REC-03(진행 중 작업)으로 한 번 확인해 작업이 있으면 그 jobId로 넘어간다.
 *   QR-01이 "진행 중 작업 없음"을 확인하고 발급하므로, 연결 뒤 생긴 진행 중 작업은 이 휴대폰 업로드다.
 */

export const POLL_INTERVAL_MS = 3000
/** 로컬로 만료된 뒤에도 서버가 WAITING이라고 하면(시계 차이) 이만큼 더 묻고 멈춘다 */
const EXPIRY_GRACE_MS = 10_000

export type CaptureLinkView =
  | { kind: 'issuing' }
  | { kind: 'failed'; error: Error }
  | {
      kind: 'ready'
      link: CreatedCaptureLink
      status: CaptureLinkStatus
      /** UPLOADED일 때만 */
      jobId: string | null
      /** 만료까지 남은 시간(ms). 0 이상 */
      remainingMs: number
    }

interface Active {
  link: CreatedCaptureLink
  status: CaptureLinkStatus
  jobId: string | null
}

type Inner = { kind: 'issuing' } | { kind: 'failed'; error: Error } | ({ kind: 'ready' } & Active)

export interface UseCaptureLinkOptions {
  /** false면 아직 발급하지 않는다(촬영 가이드를 보는 중 등) */
  enabled?: boolean
  intervalMs?: number
  /** 휴대폰 업로드가 끝나 복원 작업이 생겼다 */
  onUploaded?: (jobId: string) => void
}

export interface UseCaptureLink {
  view: CaptureLinkView
  /** 새 QR을 만든다. 살아 있는 링크가 있으면 먼저 끊는다 */
  regenerate: () => void
  /** 휴대폰 연결을 끊는다(QR-04). 실패하면 throw */
  disconnect: () => Promise<void>
  /** 아직 아무도 쓰지 않은 QR이면 끊는다. 화면을 떠날 때 부른다. 실패는 무시한다 */
  release: () => void
}

/** 더 물을 필요가 없는 상태. UPLOADED는 jobId까지 받아야 끝난다 */
function isSettled(status: CaptureLinkStatus, jobId: string | null): boolean {
  if (status === 'UPLOADED') return jobId !== null
  return isLinkClosed(status)
}

/** 연결된 뒤 링크가 사라졌을 때 진행 중 작업을 찾는다. 없거나 실패하면 null */
async function findUploadedJob(signal: AbortSignal): Promise<ReconstructionJob | null> {
  try {
    const job = await getCurrentReconstruction({ signal })
    return job && (job.status === 'QUEUED' || job.status === 'RUNNING') ? job : null
  } catch {
    return null
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

/** 링크가 이미 없다는 뜻의 응답. 만료로 다룬다 */
function isGone(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (cause.status === 404 || cause.status === 410 || cause.isCaptureEnded)
  )
}

export function useCaptureLink({
  enabled = true,
  intervalMs = POLL_INTERVAL_MS,
  onUploaded,
}: UseCaptureLinkOptions = {}): UseCaptureLink {
  const [inner, setInner] = useState<Inner>({ kind: 'issuing' })
  // 링크를 받는 순간 채운다. 렌더 중에 Date.now()를 읽으면 cacheComponents 사전 렌더가 막힌다
  const [now, setNow] = useState(0)
  // 발급 요청이 겹치면 마지막 것만 받는다
  const issueSeq = useRef(0)
  // 휴대폰 연결(CONNECTED)을 본 링크. 링크가 사라졌을 때 업로드 완료를 의심할지 정한다
  const connectedLinkRef = useRef<string | null>(null)
  const onUploadedRef = useRef(onUploaded)
  useEffect(() => {
    onUploadedRef.current = onUploaded
  })

  /** 발급을 시작한다. 돌려준 함수를 부르면 늦게 온 응답을 버린다 */
  const issue = useCallback(() => {
    const seq = ++issueSeq.current
    const ignore = () => {
      if (issueSeq.current === seq) issueSeq.current++
    }
    createCaptureLink().then(
      (link) => {
        if (seq !== issueSeq.current) return
        setNow(Date.now())
        setInner({ kind: 'ready', link, status: 'WAITING', jobId: null })
      },
      (cause: unknown) => {
        if (seq !== issueSeq.current) return
        setInner({ kind: 'failed', error: toError(cause) })
      },
    )
    return ignore
  }, [])

  // 처음 켜질 때 발급한다. 꺼지거나 사라지면 늦게 온 응답을 버린다.
  // cacheComponents는 떠난 화면을 <Activity hidden>으로 남겨 상태가 그대로다(effect만 정리된다).
  // 다시 들어왔을 때 지난 QR·연결 상태가 잠깐이라도 보이지 않게, 정리할 때 처음 상태로 돌린다
  useEffect(() => {
    if (!enabled) return
    const ignore = issue()
    return () => {
      ignore()
      connectedLinkRef.current = null
      setInner({ kind: 'issuing' })
    }
  }, [enabled, issue])

  const linkId = inner.kind === 'ready' ? inner.link.linkId : null
  const status = inner.kind === 'ready' ? inner.status : null
  const jobId = inner.kind === 'ready' ? inner.jobId : null
  const expiresAtMs = inner.kind === 'ready' ? Date.parse(inner.link.expiresAt) : NaN
  const remainingMs = Number.isFinite(expiresAtMs) ? Math.max(0, expiresAtMs - now) : 0
  const waitingTooLong = status === 'WAITING' && now > expiresAtMs + EXPIRY_GRACE_MS
  const polling = linkId !== null && status !== null && !isSettled(status, jobId) && !waitingTooLong

  // 카운트다운. WAITING인 동안만 1초마다 시계를 갱신한다
  useEffect(() => {
    if (status !== 'WAITING') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [status, linkId])

  // 상태 폴링
  useEffect(() => {
    if (!polling || !linkId) return

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false
    let stopped = false

    const schedule = () => {
      clearTimeout(timer)
      if (stopped || document.hidden) return
      timer = setTimeout(tick, intervalMs)
    }

    /** 링크가 사라졌거나 만료됐다. 연결된 적이 있으면 업로드 완료인지 확인하고, 아니면 만료로 둔다 */
    async function settleAfterGone() {
      const job =
        connectedLinkRef.current === linkId ? await findUploadedJob(controller.signal) : null
      if (stopped) return
      const uploadedJobId = job?.jobId ?? null
      setInner((prev) =>
        prev.kind === 'ready' && prev.link.linkId === linkId
          ? uploadedJobId
            ? { ...prev, status: 'UPLOADED', jobId: uploadedJobId }
            : { ...prev, status: 'EXPIRED' }
          : prev,
      )
      if (job) {
        void trackUploadedJob(job.jobId, job)
        onUploadedRef.current?.(job.jobId)
      }
    }

    async function tick() {
      if (stopped || inFlight || document.hidden) return
      inFlight = true
      try {
        const next = await getCaptureLink(linkId!, controller.signal)
        if (stopped) return
        // 연결된 뒤 만료로 바뀌었다 → 업로드가 끝났는지 진행 중 작업으로 확인한다
        if (next.status === 'EXPIRED' && connectedLinkRef.current === linkId) {
          await settleAfterGone()
          return
        }
        setInner((prev) =>
          prev.kind === 'ready' && prev.link.linkId === linkId
            ? { ...prev, status: next.status, jobId: next.jobId }
            : prev,
        )
        if (next.status === 'CONNECTED' || next.status === 'UPLOADED')
          connectedLinkRef.current = linkId
        if (next.status === 'UPLOADED' && next.jobId) {
          // 진행 팝업을 바로 띄우고(REC-02 한 번) 생성 대기 화면으로 넘어간다
          void trackUploadedJob(next.jobId)
          onUploadedRef.current?.(next.jobId)
        }
        if (isSettled(next.status, next.jobId)) return
      } catch (cause) {
        if (stopped || controller.signal.aborted) return
        if (isGone(cause)) {
          await settleAfterGone()
          return
        }
        // 네트워크 등 일시적 실패는 한 주기 쉬고 다시 묻는다
      } finally {
        inFlight = false
      }
      schedule()
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer)
      } else {
        clearTimeout(timer)
        void tick()
      }
    }

    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [polling, linkId, intervalMs])

  const regenerate = useCallback(() => {
    if (inner.kind === 'ready' && !isLinkClosed(inner.status)) {
      deleteCaptureLink(inner.link.linkId).catch(() => {})
    }
    setInner({ kind: 'issuing' })
    issue()
  }, [inner, issue])

  const disconnect = useCallback(async () => {
    if (inner.kind !== 'ready') return
    const id = inner.link.linkId
    await deleteCaptureLink(id)
    setInner((prev) =>
      prev.kind === 'ready' && prev.link.linkId === id ? { ...prev, status: 'CANCELED' } : prev,
    )
  }, [inner])

  const release = useCallback(() => {
    issueSeq.current++
    if (inner.kind === 'ready' && inner.status === 'WAITING') {
      deleteCaptureLink(inner.link.linkId).catch(() => {})
    }
  }, [inner])

  let view: CaptureLinkView
  if (inner.kind !== 'ready') {
    view = inner
  } else {
    // 서버가 아직 WAITING이어도 시간이 다 됐으면 만료로 보여 준다
    const shown: CaptureLinkStatus =
      inner.status === 'WAITING' && remainingMs === 0 ? 'EXPIRED' : inner.status
    view = { kind: 'ready', link: inner.link, status: shown, jobId: inner.jobId, remainingMs }
  }

  return { view, regenerate, disconnect, release }
}
