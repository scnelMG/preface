'use client'

import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { renameSimulation } from '@/features/edit/api'
import { TITLE_LIMIT_HINT, TITLE_MAX, validateTitle } from '@/features/edit/lab/simulationTitle'
import { PRIVATE_MEDIA, PRIVATE_TEXT } from '@/shared/analytics'
import { ApiError } from '@/shared/api/ApiError'
import { Button, Icon, RecordCard, toast } from '@/shared/ui'
import { deleteSimulation } from '../api'
import { changedPartsLabel, simulationHref, STUDIO_NEW_PATH } from '../heads'
import type { FaceModelSummary, SimulationSummary } from '../types'
import type { LoadState } from '../useStudioData'
import { useDraftImages, useOriginalImage } from '../useDraftImages'
import { DeleteRecordModal } from './DeleteRecordModal'
import { RenameHeadModal } from './RenameHeadModal'

/**
 * 작업실 `시안` 탭(Figma P3-45 최근 기록 + 기록 삭제 SCR-15, 2026-10-30 사용자 피드백으로 다시 정리).
 *
 * - 모델별 줄(2026-10-31): 왼쪽 큰 글자로 모델 이름·시안 수, 오른쪽에 맨 앞 `원본` 칸과 그 모델의 시안이 가로로 이어진다.
 *   줄이 모델 거르기를 대신한다(예전 거르기 칩은 뺐다).
 * - 시안 썸네일은 없다(명세서 HIS-06). 그래서 칸이 화면에 들어오면 그 시안의 모습을 브라우저에서 그린다(useDraftImages).
 *   그리기 전·실패하면 원본 3D 썸네일(HIS-01 `thumbnailUrl`)을 쓴다.
 * - 카드 위에서 좌우로 움직이면 원본과 갈라 보이고, 터치는 누르고 있는 동안 원본(RecordCard compareImage).
 * - 카드 ⋮ 메뉴로 이름 바꾸기(API-HIS-05)·삭제.
 */
export function RecentRecords({
  state,
  items,
  faceModels,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  onRemoved,
  onRenamed,
}: {
  state: LoadState
  items: readonly SimulationSummary[]
  faceModels: readonly FaceModelSummary[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => Promise<void>
  onRetry: () => void
  /** 삭제됐거나 이미 없는 기록 */
  onRemoved: (simulationId: string) => void
  /** 이름을 바꾼 기록 */
  onRenamed: (simulationId: string, title: string) => void
}) {
  const [target, setTarget] = useState<SimulationSummary | null>(null)
  const [renameTarget, setRenameTarget] = useState<SimulationSummary | null>(null)
  const [deleting, setDeleting] = useState(false)

  const models = useMemo(
    () => new Map(faceModels.map((model) => [model.faceModelId, model])),
    [faceModels],
  )
  // 모델별 줄: 불러온 시안이 있는 머리만, 목록에 처음 나온 순서대로(최근 시안이 있는 머리가 위)
  const groups = useMemo(() => {
    const order: string[] = []
    const byModel = new Map<string, SimulationSummary[]>()
    for (const item of items) {
      if (!byModel.has(item.faceModelId)) {
        order.push(item.faceModelId)
        byModel.set(item.faceModelId, [])
      }
      byModel.get(item.faceModelId)!.push(item)
    }
    return order.map((id) => ({
      id,
      model: models.get(id) ?? null,
      title: models.get(id)?.title ?? '내 모델',
      items: byModel.get(id)!,
    }))
  }, [items, models])

  async function confirmDelete() {
    if (!target) return
    setDeleting(true)
    try {
      await deleteSimulation(target.simulationId)
      onRemoved(target.simulationId)
      setTarget(null)
      toast('시안을 삭제했어요.')
    } catch (error) {
      // 이미 지워졌거나 남의 것(404)이면 목록에서도 뺀다
      if (error instanceof ApiError && error.isNotFound) {
        onRemoved(target.simulationId)
        setTarget(null)
        toast('이미 삭제된 시안이에요.')
      } else {
        toast(error instanceof Error ? error.message : '시안을 삭제하지 못했어요.')
      }
    } finally {
      setDeleting(false)
    }
  }

  /** 실패를 던지면 이름 창 안에 문구가 보인다. 404는 목록에서 뺀다 */
  async function rename(title: string) {
    if (!renameTarget) return
    const { simulationId } = renameTarget
    try {
      const saved = await renameSimulation(simulationId, title)
      onRenamed(simulationId, saved.title ?? title)
      setRenameTarget(null)
      toast('이름을 바꿨어요')
    } catch (error) {
      if (error instanceof ApiError && error.isNotFound) {
        onRemoved(simulationId)
        setRenameTarget(null)
        toast('이미 삭제된 시안이에요.')
        return
      }
      throw error
    }
  }

  async function loadMore() {
    try {
      await onLoadMore()
    } catch (error) {
      toast(error instanceof Error ? error.message : '시안을 더 불러오지 못했어요.')
    }
  }

  return (
    <section aria-labelledby="recent-records-title" className="pt-(--space-20) pb-(--space-40)">
      <h2 id="recent-records-title" className="sr-only">
        저장한 시안 목록
      </h2>
      <div className="mt-(--space-16)">
        {state === 'loading' ? (
          <p role="status" className="type-caption text-muted-soft">
            시안을 불러오는 중이에요.
          </p>
        ) : state === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-(--space-12)">
            <p className="type-lead text-ink">시안을 불러오지 못했어요.</p>
            <Button variant="secondary" layout="inline" trailingIcon={null} onClick={onRetry}>
              다시 불러오기
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyRecords hasHead={faceModels.length > 0} />
        ) : (
          <div className="pf-board">
            {groups.map((group, row) => (
              <section
                key={group.id}
                className="pf-board-row"
                aria-labelledby={`board-${group.id}`}
              >
                <header className="pf-board-head">
                  <h3 id={`board-${group.id}`} {...PRIVATE_TEXT}>
                    {group.title}
                  </h3>
                  <p>시안 {group.items.length}개</p>
                </header>
                <ul className="pf-board-strip" aria-label={`${group.title} 시안`}>
                  <li className="pf-album-in" style={{ '--i': row * 2 } as CSSProperties}>
                    <OriginalTile
                      faceModelId={group.id}
                      thumbnailUrl={group.model?.thumbnailUrl ?? null}
                    />
                  </li>
                  {group.items.map((item, index) => (
                    <li
                      key={item.simulationId}
                      className="pf-album-in"
                      style={{ '--i': row * 2 + index + 1 } as CSSProperties}
                    >
                      <DraftCard
                        item={item}
                        modelTitle={group.title}
                        thumbnailUrl={group.model?.thumbnailUrl ?? null}
                        onRename={() => setRenameTarget(item)}
                        onDelete={() => setTarget(item)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {state === 'ready' && hasMore ? (
          <div className="mt-(--space-32) flex justify-center">
            <Button
              variant="secondary"
              layout="inline"
              trailingIcon={null}
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '불러오는 중' : '시안 더 보기'}
            </Button>
          </div>
        ) : null}
      </div>

      <DeleteRecordModal
        open={target !== null}
        title={target?.title ?? ''}
        busy={deleting}
        onCancel={() => setTarget(null)}
        onConfirm={confirmDelete}
      />
      <RenameHeadModal
        open={renameTarget !== null}
        currentTitle={renameTarget?.title ?? ''}
        heading="시안 이름 바꾸기"
        fieldLabel="시안 이름"
        maxLength={TITLE_MAX}
        validate={validateTitle}
        limitHint={TITLE_LIMIT_HINT}
        onClose={() => setRenameTarget(null)}
        onSave={rename}
      />
    </section>
  )
}

/** 시안 한 칸: 그 시안의 모습을 그려 넣고, 원본과 비교할 수 있게 한다 */
function DraftCard({
  item,
  modelTitle,
  thumbnailUrl,
  onRename,
  onDelete,
}: {
  item: SimulationSummary
  modelTitle: string
  thumbnailUrl: string | null
  onRename: () => void
  onDelete: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const images = useDraftImages(item.simulationId, item.faceModelId, item.updatedAt, box)
  const parts = changedPartsLabel(item.changedParts)
  return (
    <div ref={box} {...PRIVATE_TEXT}>
      <RecordCard
        href={simulationHref(item.simulationId)}
        category={[modelTitle, parts].filter(Boolean).join(' · ')}
        title={item.title}
        updatedAt={item.updatedAt}
        image={
          images.draft ? (
            <RenderImage url={images.draft} />
          ) : images.failed ? (
            <RecordImage url={thumbnailUrl} />
          ) : null
        }
        compareImage={
          images.draft && images.original ? <RenderImage url={images.original} /> : undefined
        }
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  )
}

/** 줄 맨 앞 `원본` 칸(누르지 않는다). 시안 칸과 같은 구도로 그린 원본 */
function OriginalTile({
  faceModelId,
  thumbnailUrl,
}: {
  faceModelId: string
  thumbnailUrl: string | null
}) {
  const box = useRef<HTMLElement>(null)
  const original = useOriginalImage(faceModelId, box)
  // 그리는 동안은 비워 두고, 그릴 수 없을 때만 썸네일(구도가 달라 바뀔 때 머리가 튀지 않게)
  return (
    <figure ref={box} className="pf-album pf-album-original">
      <span className="pf-album-link">
        <span className="pf-album-media">
          {original.url ? (
            <RenderImage url={original.url} />
          ) : original.failed ? (
            <RecordImage url={thumbnailUrl} />
          ) : null}
        </span>
      </span>
      <figcaption>원본</figcaption>
    </figure>
  )
}

/** 브라우저에서 그린 그림(카드와 같은 4:5, 꽉 채움). blob 주소라 next/image를 거치지 않는다 */
function RenderImage({ url }: { url: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...PRIVATE_MEDIA} src={url} alt="" decoding="async" className="pf-album-render" />
}

function RecordImage({ url }: { url: string | null }) {
  if (url) {
    // presigned URL(10분)이라 next/image 최적화를 거치지 않는다.
    // 기록이 많으면 화면 밖 칸까지 한꺼번에 받지 않게 보일 때 받는다(-923)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...PRIVATE_MEDIA}
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-contain"
      />
    )
  }
  return <Icon name="User" weight="light" size={56} className="text-faint" />
}

/**
 * 최근 기록이 없을 때. Figma에 빈 상태 화면이 없어 같은 톤으로 만들었다.
 * - 내 머리가 없으면: 기본 모델 편집은 시안으로 저장되지 않는다(-527). 그래서 내 머리 추가로 보낸다.
 * - 내 머리가 있으면: 머리를 골라 실험실에서 바꾸면 시안이 남는다고 알린다(머리 고르기는 바로 위 고리에 있다).
 */
function EmptyRecords({ hasHead }: { hasHead: boolean }) {
  return (
    <div className="hairline flex flex-col items-center gap-(--space-12) rounded-(--pf-radius-xl) bg-surface px-(--space-20) py-12 text-center">
      <Icon name="ClockCounterClockwise" weight="light" size={32} className="text-muted-soft" />
      {hasHead ? (
        <>
          <p className="text-[16px] font-medium text-ink">{EMPTY_WITH_HEAD_TITLE}</p>
          <p className="type-lead text-ink-2">{EMPTY_WITH_HEAD_LEAD}</p>
        </>
      ) : (
        <>
          <p className="text-[16px] font-medium text-ink">기본 모델 편집은 저장되지 않아요.</p>
          <p className="type-lead text-ink-2">내 머리를 추가하면 시안이 생겨요.</p>
          <Button variant="ink" layout="inline" href={STUDIO_NEW_PATH} className="mt-(--space-8)">
            내 머리 추가하기
          </Button>
        </>
      )}
    </div>
  )
}

export const EMPTY_WITH_HEAD_TITLE = '아직 저장한 시안이 없어요.'
export const EMPTY_WITH_HEAD_LEAD = '내 머리를 골라 실험실에서 바꿔 보면 시안으로 남아요.'
