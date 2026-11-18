'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { PlusIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { PreviewLogin } from '../preview-login'
import { CarouselScene, DraftThumbnail } from './carousel-scene-loader'
import { PreviewNav } from '../preview-nav'
import { FaceViewer } from '@/features/viewer/FaceViewerLoader'
import { DEFAULT_LIGHTING } from '@/features/viewer/lighting'
import { useViewerFrame } from '../use-viewer-frame'
import { useLocalModels, workspaceLocalModel } from './use-local-models'
import { WORKSPACE_MODELS, modelPositionIndexes, wrapIndex } from './workspace-data'

function subscribeMotion(listener: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
const readMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function WorkspacePreview() {
  const router = useRouter()
  const { models: localModels } = useLocalModels()
  const models = useMemo(
    () => [...WORKSPACE_MODELS, ...localModels.map(workspaceLocalModel)],
    [localModels],
  )
  const focusNext = useRef<number | null>(null)
  const [turn, setTurn] = useState(0)
  const { slot, canvas, frame } = useViewerFrame()
  const [view] = useState({ preset: 'front' as const, nonce: 0 })
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => true)
  const selectedIndex = wrapIndex(turn, models.length)
  const displayTurn = turn
  const displayIndex = wrapIndex(displayTurn, models.length)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const selected = models[displayIndex]
  function selectModel(index: number) {
    setTurn(displayTurn + wrapIndex(index - displayIndex + 1, models.length) - 1)
  }
  function chooseWithKey(event: KeyboardEvent<HTMLButtonElement>) {
    let next = selectedIndex
    if (event.key === 'ArrowRight') next = wrapIndex(selectedIndex + 1, models.length)
    else if (event.key === 'ArrowLeft') next = wrapIndex(selectedIndex - 1, models.length)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = models.length - 1
    else if (event.key === 'Enter') {
      event.preventDefault()
      router.push(selected.href)
      return
    } else return
    event.preventDefault()
    focusNext.current = next
    selectModel(next)
  }
  return (
    <main className="preface-preview preface-workspace-preview">
      <PreviewNav workspace />
      <h1 className="pw-sr-only">내 작업실</h1>
      <div className="pw-workspace-heading">
        <button className="pw-add-model" onClick={() => router.push('/preview/new')}>
          <PlusIcon size={18} />새 모델
        </button>
      </div>
      <section className="pw-stage" aria-label="3D 모델 선택">
        <div className="pw-stage-canvas" aria-hidden="true">
          <CarouselScene
            turn={displayTurn}
            animate={!reduced}
            onSelect={selectModel}
            hideCenter
            models={models}
          />
        </div>
        <div className="pw-active-model" ref={slot}>
          <div className="pw-active-canvas" ref={canvas}>
            <FaceViewer
              key={selected.id}
              meshUrl={selected.sample.meshUrl}
              weights={selected.weights}
              view={view}
              layout="single"
              showing="after"
              rotationOnly
              lighting={DEFAULT_LIGHTING}
              viewportFrame={frame}
            />
          </div>
        </div>
        <button
          className="pw-side-model pw-side-model-left"
          aria-label="왼쪽 모델 선택"
          onClick={() => selectModel(wrapIndex(displayIndex - 1, models.length))}
        />
        <button
          className="pw-side-model pw-side-model-right"
          aria-label="오른쪽 모델 선택"
          onClick={() => selectModel(wrapIndex(displayIndex + 1, models.length))}
        />
        <p className="pw-viewer-hint">드래그로 회전</p>
        <button
          className="pw-edge-arrow pw-edge-prev"
          aria-label="이전 모델"
          onClick={() => selectModel(wrapIndex(displayIndex - 1, models.length))}
        >
          <CaretLeftIcon size={28} weight="light" />
        </button>
        <button
          className="pw-edge-arrow pw-edge-next"
          aria-label="다음 모델"
          onClick={() => selectModel(wrapIndex(displayIndex + 1, models.length))}
        >
          <CaretRightIcon size={28} weight="light" />
        </button>
      </section>
      <div className="pw-stage-identity">
        <h2 id="pw-selected-name">{selected.title}</h2>
        <time dateTime={selected.date.replaceAll('.', '-')}>{selected.date}</time>
      </div>
      <section className="pw-positions" aria-label="모델 선택 위치">
        {modelPositionIndexes(models.length, selectedIndex).map((index) => {
          const model = models[index]
          return (
            <button
              className="pw-position-item"
              key={model.id}
              ref={(node) => {
                items.current[index] = node
                if (node && focusNext.current === index) {
                  node.focus({ preventScroll: true })
                  focusNext.current = null
                }
              }}
              aria-label={`${model.title} 선택`}
              aria-pressed={index === selectedIndex}
              data-previewed={index === displayIndex ? 'true' : undefined}
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => selectModel(index)}
              onKeyDown={chooseWithKey}
            >
              <span aria-hidden="true" />
            </button>
          )
        })}
      </section>
      <span className="pw-sr-only" aria-live="polite">
        {models[selectedIndex].title} 선택됨
      </span>
      <section className="pw-selected" aria-labelledby="pw-selected-name">
        <div className="pw-selected-heading">
          <span className="pw-draft-count">저장한 시안 {selected.drafts.length}</span>
          <Link className="pw-edit-model" href={selected.href}>
            이어서 편집
          </Link>
        </div>
        <div className="pw-drafts">
          {selected.drafts.length ? (
            selected.drafts.map((draft) => (
              <Link key={draft.href} className="pw-draft-card" href={draft.href}>
                <div
                  className="pw-draft-preview"
                  role="img"
                  aria-label={`${draft.title} 3D 미리보기`}
                >
                  <DraftThumbnail model={{ ...selected, weights: draft.weights }} />
                </div>
                <div className="pw-draft-info">
                  <span>{draft.title}</span>
                  <small>{draft.change}</small>
                  <time dateTime={draft.date}>{draft.date.replaceAll('-', '.')} 저장</time>
                </div>
              </Link>
            ))
          ) : (
            <p className="pw-empty-drafts">
              아직 저장한 시안이 없어요. 모델을 열어 첫 편집을 시작하세요.
            </p>
          )}
        </div>
      </section>
      <PreviewLogin />
    </main>
  )
}
