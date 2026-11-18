'use client'

import type { MorphState } from '@/features/edit/types'
import { Icon } from '@/shared/ui'
import { formatFullDate, headTitle, type HeadOption } from '../heads'
import { useHandoff } from '@/shared/state/handoff'
import { HeadRing } from './HeadRing'
import { handoffCropWidth } from './ringMath'
import { HeadStage } from './HeadStage'
import { PRIVATE_TEXT } from '@/shared/analytics'

/** 이름 아래 작은 아이콘 버튼(이름 바꾸기·삭제). 모델은 ⋮ 메뉴 대신 바로 보이는 아이콘(2026-10-31 다시 결정) */
export const ICON_BUTTON =
  'inline-flex size-9 items-center justify-center rounded-full text-muted-soft transition-[color,background-color,scale] duration-(--pf-dur-ui) hover:bg-ink/5 hover:text-ink active:scale-[0.96]'

type OwnHeadOption = Extract<HeadOption, { kind: 'own' }>

export interface HeadPickerProps {
  options: readonly HeadOption[]
  selectedId: string
  onSelect: (id: string) => void
  /** 오른쪽 아래 주 버튼 */
  action: { label: string; onClick: () => void; busy?: boolean }
  /** 고른 내 모델의 마지막 시안 상태. 3D를 그 모습으로 그린다(-433) */
  stageMorphState?: MorphState | null
  /** 맨 아래 안내 문구 */
  note: string
  /** 내 모델 지우기 확인 창(API-HIS-03). 생략하면 버튼을 숨긴다. 기본 모델에는 버튼을 두지 않는다 */
  onDelete?: (option: OwnHeadOption) => void
  /** 내 모델 이름 바꾸기 창(API-HIS-08 가안). 생략하면 버튼을 숨긴다. 기본 모델에는 버튼을 두지 않는다 */
  onRename?: (option: OwnHeadOption) => void
}

/** 실제 모델 선택·시안·삭제·이름 변경 콜백을 그대로 사용하는 작업실 뷰. */
export function HeadPicker({
  options,
  selectedId,
  onSelect,
  action,
  stageMorphState,
  onDelete,
  onRename,
}: HeadPickerProps) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.id === selectedId),
  )
  const selected = options[index]
  if (!selected) return null
  const step = (delta: number) =>
    onSelect(options[(index + delta + options.length) % options.length].id)
  const neighbors = options.length > 1 ? [-1, 1] : []
  // 편집하기 버튼과 가운데 머리 누르기(-605)가 같이 쓴다. 불러오는 중이면 두 번 들어가지 않는다
  const open = () => {
    if (action.busy) return
    liftSelectedHead()
    action.onClick()
  }
  return (
    <div className="pf-workspace-models">
      <section
        className="pf-model-selector"
        aria-label="고른 모델"
        onKeyDown={(event) => {
          if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement
          )
            return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            step(event.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        {/* 고른 모델 뒤에만 번지는 은은한 빛(장식) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(38%_52%_at_50%_50%,var(--pf-stage-glow)_0%,transparent_72%)]"
        />
        {/* 머리 고리(2026-10-31): 3D 캔버스 하나에 모든 머리를 원 위에. WebGL이 없으면 예전 무대(가운데 + 양옆) */}
        <HeadRing
          options={options}
          index={index}
          onSelect={onSelect}
          onOpen={open}
          fallback={
            <>
              {neighbors.map((delta) => {
                const option = options[(index + delta + options.length) % options.length]
                return (
                  <button
                    key={delta}
                    className={`pf-neighbor pf-neighbor-${delta < 0 ? 'left' : 'right'}`}
                    onClick={() => onSelect(option.id)}
                    aria-label={`${headTitle(option)} 선택`}
                  >
                    <span aria-hidden="true">
                      <HeadStage key={option.id} option={option} angle="threeQuarter" />
                    </span>
                  </button>
                )
              })}
              {/* 머리를 바꾸면 가운데 자리에서 초점이 맞듯 선명해진다(refine.css pf-stage-enter) */}
              {/* 가운데 머리를 누르면 편집하기와 같다(-605). 키보드는 아래 편집하기 버튼을 쓴다 */}
              <div
                key={selected.id}
                className="pf-selected-stage pf-stage-enter cursor-pointer"
                onClick={open}
              >
                <HeadStage
                  key={selected.id}
                  option={selected}
                  morphState={stageMorphState}
                  angle="front"
                />
              </div>
            </>
          }
        />
        <button
          className="pf-model-prev rounded-full transition-colors duration-(--pf-dur-ui) hover:bg-ink/5"
          aria-label="이전 모델"
          onClick={() => step(-1)}
        >
          <Icon name="CaretLeft" size={20} />
        </button>
        <button
          className="pf-model-next rounded-full transition-colors duration-(--pf-dur-ui) hover:bg-ink/5"
          aria-label="다음 모델"
          onClick={() => step(1)}
        >
          <Icon name="CaretRight" size={20} />
        </button>
      </section>
      {/* 전환 바 → 이름(가운데) → 한 줄에 만든 날짜와 이름 바꾸기·삭제 아이콘 */}
      <div className="pf-model-identity flex flex-col items-center" {...PRIVATE_TEXT}>
        {/* 전환 바(2026-10-31): 이름 바로 위, 머리마다 한 칸. 지금 머리는 긴 잉크 막대, 누르면 그 머리로. 하나뿐이면 숨긴다 */}
        {options.length > 1 ? (
          <section className="pf-model-positions" aria-label="모델 고르기">
            {options.slice(0, 7).map((option) => (
              <button
                key={option.id}
                aria-label={`${headTitle(option)} 선택`}
                aria-pressed={option.id === selectedId}
                onClick={() => onSelect(option.id)}
              >
                <span />
                <span className="sr-only">{headTitle(option)}</span>
              </button>
            ))}
          </section>
        ) : null}
        {/* 기본 모델은 아래 작은 글자가 '기본 모델'이라 제목은 '남성'·'여성'만 둔다(2026-11-13, -797) */}
        <h2 className="type-headline text-center text-ink">
          {selected.kind === 'own' ? selected.title : selected.sample.shortTitle}
        </h2>
        {/* 기본 모델 2종은 늘 남는 체험용이라 이름 바꾸기·지우기를 두지 않는다(2026-11-13, -797).
            날짜 자리는 '기본 모델' */}
        <div className="flex min-h-9 items-center gap-(--space-2)">
          {selected.kind === 'own' ? (
            <time
              className="type-caption mr-(--space-4) text-muted-soft tabular-nums"
              dateTime={selected.createdAt}
            >
              {formatFullDate(selected.createdAt)}
            </time>
          ) : (
            <span className="type-caption text-muted-soft">기본 모델</span>
          )}
          {/* 연필·휴지통은 뜻이 분명해 설명 풍선 없이 둔다 */}
          {selected.kind === 'own' && onRename && (
            <button
              type="button"
              aria-label="이름 바꾸기"
              className={ICON_BUTTON}
              onClick={() => onRename(selected)}
            >
              <Icon name="PencilSimple" size={16} />
            </button>
          )}
          {selected.kind === 'own' && onDelete && (
            <button
              type="button"
              aria-label="이 모델 삭제"
              className={ICON_BUTTON}
              onClick={() => onDelete(selected)}
            >
              <Icon name="Trash" size={16} />
            </button>
          )}
        </div>
      </div>
      {/* 만드는 중·실패한 3D는 작업실 안에 따로 두지 않는다. 어느 화면에서나 같은 자리의 진행 팝업이
          진행과 실패를 함께 보여 준다(reconstruction/ProgressDock, 2026-11-01 사용자 결정) */}
      {/* 모델 탭은 모델 고르기만 한다. 행동은 하나(시작하기), 시안은 `시안` 탭에서 본다(2026-10-30) */}
      <div className="pf-model-actions">
        <button
          type="button"
          className="btn-primary min-w-[200px]"
          onClick={open}
          disabled={action.busy}
          aria-busy={action.busy}
        >
          {action.busy ? '불러오는 중…' : action.label}
        </button>
      </div>
    </div>
  )
}

/**
 * 편집하기를 누른 순간 고리 가운데 머리를 그림으로 떠서 이어주기를 시작한다(편집실 3D 자리로 날아간다).
 * 고리(WebGL)가 없거나 움직임 줄이기면 하지 않는다. 가운데 머리는 캔버스 가운데, 높이 전체·폭은 가운데 머리 폭만큼 자른다
 * (`handoffCropWidth`, 휴대폰에서 옆 머리까지 잘려 세 머리가 날아가던 것을 고쳤다, -158).
 */
function liftSelectedHead() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const canvas = document.querySelector<HTMLCanvasElement>('.pf-ring canvas')
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  const width = handoffCropWidth(rect.width, rect.height)
  const from = {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top,
    width,
    height: rect.height,
  }
  const ratio = canvas.width / rect.width
  const crop = document.createElement('canvas')
  crop.width = Math.round(width * ratio)
  crop.height = Math.round(rect.height * ratio)
  const context = crop.getContext('2d')
  if (!context) return
  context.drawImage(
    canvas,
    (from.left - rect.left) * ratio,
    0,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  )
  useHandoff.getState().start(crop.toDataURL('image/webp', 0.92), from)
}
