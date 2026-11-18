'use client'

import { useHandoff } from '@/shared/state/handoff'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requireLogin } from '@/features/auth/useAuthGuard'
import { useAuthStore } from '@/features/auth/store'
import { ApiError } from '@/shared/api/ApiError'
import { ErrorCode } from '@/shared/api/errorCodes'
import { Button, toast } from '@/shared/ui'
import { createSimulation, deleteFaceModel, renameFaceModel } from '../api'
import {
  buildHeadOptions,
  initialHeadId,
  nextAfterDelete,
  labHref,
  simulationHref,
  STUDIO_NEW_PATH,
  studioHref,
  type HeadOption,
  type StudioTab,
} from '../heads'
import { SAMPLE_HEADS } from '../samples'
import { useRecentRecords, useStudioHeads } from '../useStudioData'
import { DeleteHeadModal } from './DeleteHeadModal'
import { HeadPicker } from './HeadPicker'
import { RecentRecords } from './RecentRecords'
import { RenameHeadModal } from './RenameHeadModal'
import { StudioHeading } from './StudioHeading'
import { ThumbnailCapture } from './ThumbnailCapture'

/**
 * 작업실 `/studio`. 게스트·회원이 같은 주소를 쓴다(Figma 헤더 `내 작업실`).
 * - 게스트(P3-36): 남성·여성 기본 모델 2종에서 고르고 체험 실험실로. 기록·머리 추가는 로그인 모달
 * - 회원(P3-42·45): 내 모델(맨 앞) + 기본 모델 + 머리 추가, 내 모델 이름 바꾸기(HIS-08 가안)·삭제(HIS-03),
 *   최근 기록 격자와 삭제(SCR-15)
 * - 모델 탭은 모델 고르기만 한다. 주 행동은 `시작하기` 하나(새 시안으로 편집실). 시안은 `시안` 탭(2026-10-30 사용자 피드백)
 *
 * 주소: `?faceModelId=<id>`(그 모델을 골라 둔다), `?tab=records`(최근 기록 탭). `heads.ts`의 studioHref.
 * useSearchParams()를 쓰므로 페이지가 <Suspense>로 감싼다(apps/web/AGENTS.md).
 */
export function StudioScreen() {
  const status = useAuthStore((s) => s.status)
  const searchParams = useSearchParams()
  const faceModelId = searchParams.get('faceModelId')
  const initialTab: StudioTab = searchParams.get('tab') === 'records' ? 'records' : 'heads'

  return (
    // 디자인 시스템 v4: 여백은 머리줄 로고와 같은 시작선(모바일 5%, 데스크톱 4%)
    <div className="w-full px-[5%] pb-(--space-40) md:px-[4%]">
      {status === 'member' ? (
        <MemberStudio initialTab={initialTab} faceModelId={faceModelId} />
      ) : status === 'loading' ? (
        <StudioSkeleton />
      ) : (
        <GuestStudio />
      )}
    </div>
  )
}

function StudioSkeleton() {
  return (
    // 회색 네모 대신 모델 자리 가운데 가는 고리 하나(2026-10-30)
    <div aria-busy="true" className="flex h-[420px] items-center justify-center md:h-[520px]">
      <span className="pf-loader" aria-hidden="true" />
      <span className="sr-only">작업실을 불러오는 중이에요</span>
    </div>
  )
}

/** P3-36 작업실 · 체험 · 기본 모델 고르기 */
function GuestStudio() {
  const router = useRouter()
  const options = useMemo(() => buildHeadOptions([], SAMPLE_HEADS), [])
  const [selectedId, setSelectedId] = useState(options[0].id)
  const selected = options.find((o) => o.id === selectedId) ?? options[0]

  return (
    <>
      <StudioHeading
        tab="heads"
        onTabChange={(next) => {
          if (next === 'records') requireLogin(studioHref({ tab: 'records' }))
        }}
        onAdd={() => requireLogin(STUDIO_NEW_PATH)}
      />
      <HeadPicker
        options={options}
        selectedId={selectedId}
        onSelect={setSelectedId}
        action={{
          label: '편집하기',
          onClick: () => {
            if (selected.kind === 'sample') router.push(labHref(selected.sample.key))
          },
        }}
        note="기본 모델 2종(남성·여성)으로 변화를 체험해 볼 수 있어요."
      />
    </>
  )
}

type OwnHead = Extract<HeadOption, { kind: 'own' }>

/** P3-42 머리 선택 · P3-45 최근 기록 */
function MemberStudio({
  initialTab,
  faceModelId,
}: {
  initialTab: StudioTab
  faceModelId: string | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<StudioTab>(initialTab)
  const heads = useStudioHeads(faceModelId)
  const records = useRecentRecords()

  // 썸네일이 없는 내 모델을 하나씩 원본 정면으로 캡처해 올린다(-436). 한 번 시도한 머리는 이번 방문에서 다시 하지 않는다
  const [thumbnailTried, setThumbnailTried] = useState<ReadonlySet<string>>(() => new Set())
  const thumbnailTarget =
    heads.state === 'ready'
      ? (heads.faceModels.find(
          (model) => !model.thumbnailUrl && !thumbnailTried.has(model.faceModelId),
        )?.faceModelId ?? null)
      : null
  const { setThumbnail } = heads
  const onThumbnailDone = useCallback(
    (url: string | null) => {
      if (!thumbnailTarget) return
      if (url) setThumbnail(thumbnailTarget, url)
      setThumbnailTried((prev) => new Set(prev).add(thumbnailTarget))
    },
    [thumbnailTarget, setThumbnail],
  )

  const options = useMemo(
    () => buildHeadOptions(heads.faceModels, SAMPLE_HEADS),
    [heads.faceModels],
  )
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [previousFaceModelId, setPreviousFaceModelId] = useState(faceModelId)
  if (faceModelId !== previousFaceModelId) {
    setPreviousFaceModelId(faceModelId)
    if (faceModelId) {
      setChosenId(null)
      setTab(initialTab)
    }
  }
  const selectedId =
    chosenId && options.some((o) => o.id === chosenId)
      ? chosenId
      : initialHeadId(options, faceModelId)
  const selected = options.find((o) => o.id === selectedId) ?? null
  const [starting, setStarting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<OwnHead | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<OwnHead | null>(null)

  // 편집 화면으로 간 뒤 이 화면은 cacheComponents로 숨겨진 채 남는다. 숨을 때 진행 상태를 풀어야
  // 돌아왔을 때 버튼이 잠겨 있지 않다(-433, -391과 같은 종류)
  useEffect(() => () => setStarting(false), [])

  // 상세 조회에서 찾을 수 없었던 링크는 안내하고 주소에서 정리한다.
  const handledMissingId = useRef<string | null>(null)
  const { missingId } = heads
  useEffect(() => {
    if (!missingId || missingId !== faceModelId || missingId === handledMissingId.current) return
    handledMissingId.current = missingId
    toast('삭제된 모델이에요.')
    router.replace(studioHref({ tab }))
  }, [faceModelId, missingId, router, tab])

  function askDelete(option: OwnHead) {
    setDeleteError(null)
    setDeleteTarget(option)
  }

  /**
   * 삭제됐거나 이미 없는 3D: 목록·최근 기록을 다시 받는다. 선택은 맨 앞으로 돌리지 않고 지운 자리에 밀려 들어온
   * 모델(맨 끝이면 앞 모델)로 둔다 — 고리가 그 자리에 멈춰 있다(2026-11-13, -799)
   */
  function afterDeleted(deletedId: string, message: string) {
    // 방금 여기서 지운 모델은 '삭제된 모델' 안내를 또 띄우지 않는다
    handledMissingId.current = deletedId
    setChosenId(nextAfterDelete(options, deletedId))
    heads.remove(deletedId)
    // 3D와 함께 연결 시안도 지워졌다(FN-HIS-03 수용 1)
    records.retry()
    // 주소에 지운 머리가 남아 있으면 정리한다(남겨 두면 다시 그 모델을 고르려 한다)
    if (deletedId === faceModelId) router.replace(studioHref())
    setDeleteTarget(null)
    setRenameTarget(null)
    toast(message)
  }

  /**
   * 이름 바꾸기(API-HIS-08 가안). 성공하면 서버가 저장한 이름으로 카드·큰 제목을 바로 고친다.
   * 404(그사이 지워졌거나 남의 것)는 삭제와 같이 목록에서 빼고 다시 받는다.
   * 그 밖의 실패(400 등)는 던져서 창 안에 문구를 보이게 한다.
   */
  async function rename(title: string) {
    if (!renameTarget) return
    const { faceModelId: id } = renameTarget
    try {
      const saved = await renameFaceModel(id, title)
      heads.rename(id, saved.title)
      setRenameTarget(null)
      toast('이름을 바꿨어요')
    } catch (error) {
      if (error instanceof ApiError && error.isNotFound) {
        afterDeleted(id, '이미 삭제된 모델이에요.')
        return
      }
      throw error
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteFaceModel(deleteTarget.faceModelId)
      afterDeleted(deleteTarget.faceModelId, '모델을 삭제했어요.')
    } catch (error) {
      // 이미 지워졌거나 남의 것(404), 삭제 처리 중(HIS_002)이면 목록에서도 뺀다
      if (
        error instanceof ApiError &&
        (error.isNotFound || error.code === ErrorCode.RESOURCE_DELETING)
      ) {
        afterDeleted(deleteTarget.faceModelId, '이미 삭제된 모델이에요.')
      } else {
        setDeleteError(
          error instanceof Error && error.message ? error.message : '모델을 삭제하지 못했어요.',
        )
      }
    } finally {
      setDeleting(false)
    }
  }

  async function start(option: HeadOption) {
    if (option.kind === 'sample') {
      // 샘플은 서버 face_model이 아니라 시안을 만들지 않는다(명세서 "샘플 머리", 회원 저장 여부 미결)
      router.push(labHref(option.sample.key))
      return
    }
    setStarting(true)
    try {
      // API-EDIT-02 새 시안 → 편집 화면(-156)
      const created = await createSimulation(option.faceModelId)
      router.push(simulationHref(created.simulationId))
    } catch (error) {
      setStarting(false)
      // 떠오른 머리 그림은 그 자리에서 사라진다
      useHandoff.getState().cancel()
      toast(error instanceof Error ? error.message : '시안을 만들지 못했어요.')
    }
  }

  return (
    <>
      <StudioHeading tab={tab} onTabChange={setTab} onAdd={() => router.push(STUDIO_NEW_PATH)} />

      {/* 탭을 바꾸면 내용이 살짝 떠오르며 바뀐다(refine.css pf-tab-panel) */}
      <div hidden={tab !== 'heads'} className="pf-tab-panel">
        {heads.state === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-(--space-12) py-(--space-40)">
            <p className="type-kr-body-12-regular-lh15p6 text-text-ink">
              내 모델 목록을 불러오지 못했어요.
            </p>
            <Button variant="secondary" layout="inline" trailingIcon={null} onClick={heads.retry}>
              다시 불러오기
            </Button>
          </div>
        ) : heads.state === 'loading' || !selected ? (
          <StudioSkeleton />
        ) : (
          <HeadPicker
            options={options}
            selectedId={selected.id}
            onSelect={setChosenId}
            action={{ label: '편집하기', onClick: () => start(selected), busy: starting }}
            note={
              heads.faceModels.length > 0
                ? '내 모델은 직접 촬영한 영상으로 만든 3D예요. 기본 모델 2종은 체험용이에요.'
                : '기본 모델 2종(남성·여성)으로 변화를 체험해 볼 수 있어요.'
            }
            onDelete={askDelete}
            onRename={setRenameTarget}
          />
        )}
      </div>

      {thumbnailTarget ? (
        <ThumbnailCapture
          key={thumbnailTarget}
          faceModelId={thumbnailTarget}
          onDone={onThumbnailDone}
        />
      ) : null}

      <DeleteHeadModal
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? ''}
        simulationCount={deleteTarget?.simulationCount ?? 0}
        busy={deleting}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <RenameHeadModal
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ''}
        onClose={() => setRenameTarget(null)}
        onSave={rename}
      />

      <div hidden={tab !== 'records'} className="pf-tab-panel">
        <RecentRecords
          state={records.state}
          items={records.items}
          faceModels={heads.faceModels}
          hasMore={records.hasMore}
          loadingMore={records.loadingMore}
          onLoadMore={records.loadMore}
          onRetry={records.retry}
          onRemoved={records.remove}
          onRenamed={records.rename}
        />
      </div>
    </>
  )
}
