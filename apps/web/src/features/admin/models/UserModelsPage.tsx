'use client'

import { useEffect, useRef, useState } from 'react'
import { getReconstructionDetail } from '@/features/admin/api'
import { useAuthStore } from '@/features/auth/store'
import { PRIVATE_TEXT } from '@/shared/analytics'
import { cx } from '@/shared/ui'
import { adminModelsApi, assetsFresh } from './api'
import { readCaptureQuality, type CaptureQuality } from './captureQuality'
import { adminErrorMessage } from './errors'
import { formatDateTime, formatDuration } from './format'
import { ModelAssetsPanel, type QualityLoad } from './ModelAssetsPanel'
import { StorageSection } from './StorageSection'
import type { AdminFaceModel, AdminFaceModelAssets, AdminPage } from './types'

export const NO_MODELS = '이 사용자가 만든 모델이 없어요'
const PAGE_SIZE = 20

type ListLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AdminPage<AdminFaceModel> }

type AssetsLoad =
  | { status: 'loading'; faceModelId: string }
  | { status: 'error'; faceModelId: string; message: string }
  | { status: 'ready'; faceModelId: string; data: AdminFaceModelAssets }

/**
 * 관리자 사용자별 생성 모델·S3 조회(S15P31B204-655). 라우트 `/admin/users/[userId]`.
 * ADMIN 확인은 `/admin` 레이아웃(-654)이 맡는다. 여기서는 API가 403을 주면 문구만 보인다.
 *
 * 서명 URL(계약 7)은 이 화면의 메모리에만 둔다. 고른 모델도 주소창에 올리지 않는다.
 * 같은 모델을 다시 열 때 만료(`expiresAt`)가 지났거나 곧 지나면 새로 받는다.
 *
 * 세션 복구(AuthBootstrap)가 끝나기 전에 부르면 토큰 없이 401이 나므로, 로그인 상태가 정해진 뒤에 조회한다.
 */
export function UserModelsPage({ userId }: { userId: string }) {
  const auth = useAuthStore((s) => s.status)
  if (auth === 'loading') {
    return (
      <p className="sr-only" role="status">
        로그인 상태를 확인하는 중이에요
      </p>
    )
  }
  if (auth !== 'member') {
    return (
      <p className="type-kr-body-13-regular-lh16p9 px-(--space-16) py-(--space-32) text-center text-text-muted">
        로그인이 필요해요
      </p>
    )
  }
  return <UserModels userId={userId} />
}

function UserModels({ userId }: { userId: string }) {
  const [page, setPage] = useState(0)
  const [list, setList] = useState<ListLoad>({ status: 'loading' })
  const [listAttempt, setListAttempt] = useState(0)
  const [assets, setAssets] = useState<AssetsLoad | null>(null)
  const assetsCache = useRef(new Map<string, AdminFaceModelAssets>())
  const assetsRequest = useRef(0)
  // 사진 카메라 정보(작업 상세 input.quality). 서명 URL이 아니라 만료가 없어 작업마다 한 번만 받는다
  const [quality, setQuality] = useState<{ jobId: string; load: QualityLoad } | null>(null)
  const qualityCache = useRef(new Map<string, CaptureQuality>())
  const assetsSection = useRef<HTMLElement>(null)
  const [scrollRequest, setScrollRequest] = useState(0)

  // "보기"를 누르면 아래 모델 파일 칸으로 내려간다(표 아래라 눌러도 바뀐 게 안 보였다)
  useEffect(() => {
    if (scrollRequest === 0) return
    assetsSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [scrollRequest])

  useEffect(() => {
    let alive = true
    adminModelsApi
      .faceModels(userId, { page, size: PAGE_SIZE })
      .then((data) => alive && setList({ status: 'ready', data }))
      .catch(
        (error: unknown) =>
          alive &&
          setList({ status: 'error', message: adminErrorMessage(error, '모델 목록을', true) }),
      )
    return () => {
      alive = false
    }
  }, [userId, page, listAttempt])

  function goTo(next: number) {
    setList({ status: 'loading' })
    setPage(next)
  }

  function reloadList() {
    setList({ status: 'loading' })
    setListAttempt((n) => n + 1)
  }

  function loadQuality(jobId: string) {
    const cached = qualityCache.current.get(jobId)
    if (cached) {
      setQuality({ jobId, load: { status: 'ready', data: cached } })
      return
    }
    setQuality({ jobId, load: { status: 'loading' } })
    getReconstructionDetail(jobId)
      .then((detail) => {
        const data = readCaptureQuality(detail.input?.quality)
        qualityCache.current.set(jobId, data)
        setQuality((prev) =>
          prev?.jobId === jobId ? { jobId, load: { status: 'ready', data } } : prev,
        )
      })
      .catch(() =>
        setQuality((prev) => (prev?.jobId === jobId ? { jobId, load: { status: 'error' } } : prev)),
      )
  }

  function openModel(model: Pick<AdminFaceModel, 'faceModelId' | 'jobId'>) {
    const { faceModelId } = model
    setScrollRequest((n) => n + 1)
    if (model.jobId && (quality?.jobId !== model.jobId || quality.load.status === 'error'))
      loadQuality(model.jobId)
    const request = ++assetsRequest.current
    const cached = assetsCache.current.get(faceModelId)
    if (cached && assetsFresh(cached)) {
      setAssets({ status: 'ready', faceModelId, data: cached })
      return
    }
    assetsCache.current.delete(faceModelId)
    setAssets({ status: 'loading', faceModelId })
    adminModelsApi
      .assets(faceModelId)
      .then((data) => {
        assetsCache.current.set(faceModelId, data)
        if (assetsRequest.current === request) setAssets({ status: 'ready', faceModelId, data })
      })
      .catch((error: unknown) => {
        if (assetsRequest.current === request)
          setAssets({
            status: 'error',
            faceModelId,
            message: adminErrorMessage(error, '모델 파일을'),
          })
      })
  }

  const selectedId = assets?.faceModelId ?? null

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-(--space-40) px-(--space-16) py-(--space-32) md:px-(--space-32)">
      <header className="flex flex-col gap-(--space-4)">
        <p className="type-caption text-text-muted">관리자 · 사용자별 모델</p>
        <h1 className="type-kr-title-22-medium-ls-1-lh28p6 break-all text-text-ink">
          사용자{' '}
          <span {...PRIVATE_TEXT} className="font-mono">
            {userId}
          </span>
        </h1>
      </header>

      <section className="flex flex-col gap-(--space-16)" aria-labelledby="admin-models-title">
        <h2
          id="admin-models-title"
          className="type-kr-heading-15-medium-ls-0p5-lh19p5 text-text-ink"
        >
          생성 모델
        </h2>
        {list.status === 'loading' ? (
          <p className="type-caption text-text-muted" role="status">
            모델 목록을 불러오는 중이에요
          </p>
        ) : list.status === 'error' ? (
          <div className="flex items-center gap-(--space-12)">
            <p className="type-kr-body-13-regular-lh16p9 text-status-danger" role="alert">
              {list.message}
            </p>
            <button
              type="button"
              onClick={reloadList}
              className="type-label text-text-ink underline"
            >
              다시 시도
            </button>
          </div>
        ) : list.data.items.length === 0 ? (
          <p className="type-kr-body-13-regular-lh16p9 text-text-muted">{NO_MODELS}</p>
        ) : (
          <>
            <ModelTable models={list.data.items} selectedId={selectedId} onOpen={openModel} />
            <Pager
              page={list.data.page}
              totalPages={list.data.totalPages}
              totalElements={list.data.totalElements}
              onPage={goTo}
            />
          </>
        )}
      </section>

      {assets ? (
        <section
          ref={assetsSection}
          className="flex scroll-mt-(--space-16) flex-col gap-(--space-16)"
          aria-labelledby="admin-assets-title"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-(--space-8)">
            <h2
              id="admin-assets-title"
              className="type-kr-heading-15-medium-ls-0p5-lh19p5 text-text-ink"
            >
              모델 파일
            </h2>
            <p className="type-caption text-text-muted">
              <span {...PRIVATE_TEXT} className="font-mono">
                {assets.faceModelId}
              </span>
              {assets.status === 'ready'
                ? ` · 주소 만료 ${formatDateTime(assets.data.expiresAt)}`
                : null}
            </p>
          </div>
          {assets.status === 'loading' ? (
            <p className="type-caption text-text-muted" role="status">
              모델 파일을 불러오는 중이에요
            </p>
          ) : assets.status === 'error' ? (
            <div className="flex items-center gap-(--space-12)">
              <p className="type-kr-body-13-regular-lh16p9 text-status-danger" role="alert">
                {assets.message}
              </p>
              <button
                type="button"
                onClick={() =>
                  openModel({ faceModelId: assets.faceModelId, jobId: quality?.jobId ?? '' })
                }
                className="type-label text-text-ink underline"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <ModelAssetsPanel
              key={assets.data.expiresAt}
              assets={assets.data}
              quality={quality?.load ?? { status: 'error' }}
              // 다시 받은 자산은 캐시에만 둔다(패널을 다시 그리면 뷰어가 처음부터 불러온다)
              onAssetsRefreshed={(data) => assetsCache.current.set(data.faceModelId, data)}
            />
          )}
        </section>
      ) : null}

      <StorageSection userId={userId} />
    </div>
  )
}

function deletionLabel(model: AdminFaceModel): string {
  if (model.deletedAt) return `삭제됨 ${formatDateTime(model.deletedAt)}`
  if (model.deleteScheduledAt) return `삭제 예정 ${formatDateTime(model.deleteScheduledAt)}`
  return '—'
}

function ModelTable({
  models,
  selectedId,
  onOpen,
}: {
  models: AdminFaceModel[]
  selectedId: string | null
  onOpen: (model: AdminFaceModel) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left">
        <thead>
          <tr className="type-kr-caption-11-medium-lh14p3 border-b border-line-default text-text-muted">
            <th className="py-(--space-8) pr-(--space-16) font-medium">생성 시각</th>
            <th className="py-(--space-8) pr-(--space-16) font-medium">영상 길이</th>
            <th className="py-(--space-8) pr-(--space-16) font-medium">작업 상태</th>
            <th className="py-(--space-8) pr-(--space-16) font-medium">시안 수</th>
            <th className="py-(--space-8) pr-(--space-16) font-medium">삭제</th>
            <th className="py-(--space-8) font-medium">
              <span className="sr-only">보기</span>
            </th>
          </tr>
        </thead>
        <tbody className="type-kr-body-12-regular-lh15p6 text-text-body">
          {models.map((model) => {
            const selected = model.faceModelId === selectedId
            return (
              <tr
                key={model.faceModelId}
                data-face-model-id={model.faceModelId}
                data-selected={selected || undefined}
                className={cx('border-b border-line-default', selected && 'bg-bg-stone')}
              >
                <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                  {formatDateTime(model.createdAt)}
                </td>
                <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                  {formatDuration(model.videoDurationMs)}
                </td>
                <td className="py-(--space-8) pr-(--space-16) font-mono">{model.jobStatus}</td>
                <td className="py-(--space-8) pr-(--space-16) tabular-nums">
                  {model.simulationCount}개
                </td>
                <td
                  className={cx(
                    'py-(--space-8) pr-(--space-16) tabular-nums',
                    (model.deletedAt || model.deleteScheduledAt) && 'text-status-danger',
                  )}
                >
                  {deletionLabel(model)}
                </td>
                <td className="py-(--space-8)">
                  <button
                    type="button"
                    onClick={() => onOpen(model)}
                    aria-current={selected || undefined}
                    className="type-label min-h-11 text-text-ink underline"
                  >
                    {selected ? '보는 중' : '보기'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Pager({
  page,
  totalPages,
  totalElements,
  onPage,
}: {
  page: number
  totalPages: number
  totalElements: number
  onPage: (page: number) => void
}) {
  const last = Math.max(totalPages - 1, 0)
  return (
    <nav
      aria-label="모델 목록 페이지"
      className="type-caption flex items-center gap-(--space-12) text-text-muted"
    >
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 0}
        className="type-label min-h-11 text-text-ink disabled:opacity-40"
      >
        이전
      </button>
      <span className="tabular-nums">
        {page + 1} / {last + 1} · 전체 {totalElements}개
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= last}
        className="type-label min-h-11 text-text-ink disabled:opacity-40"
      >
        다음
      </button>
    </nav>
  )
}
