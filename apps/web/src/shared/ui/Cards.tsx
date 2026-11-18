'use client'

import Link from 'next/link'
import { useRef, type PointerEvent, type ReactNode } from 'react'
import { Badge, type BadgeStatus } from './Badge'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import { ItemMenu } from './ItemMenu'

/**
 * Figma 카드 4종 — `v3/Card/RecordCard`, `v3/Card/ServiceChoice`, `v3/Card/ModelTile`, `v3/LabServiceRow`.
 * 머리 그림은 데이터(3D 렌더·공개 샘플)에서 오므로 image로 받는다. Figma 예시 그림은 저장소에 넣지 않는다.
 * 토큰이 아닌 색(#eeede7, #8e9284, #eee8f5 …)은 Figma에서도 변수로 묶여 있지 않다.
 */

/** "10. 21. 오후 04:01" — Figma RecordCard 날짜 모양 */
export function formatRecordDate(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Seoul',
  }).format(new Date(iso))
}

/** "10.31" — 앨범 카드 안 짧은 날짜(서울 시간) */
function formatAlbumDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Seoul',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('month')}.${get('day')}`
}

/**
 * 시안 카드 — 앨범형(2026-10-31). 세로 4:5 그림 한 장 안에 제목·모델 이름·날짜를 담고(아래 어둠 그라데이션 위 흰 글),
 * 오른쪽 위에 ⋮ 메뉴(이름 바꾸기·삭제)를 둔다. 그림을 누르면 시안을 연다.
 * 모양은 features/layout/refine.css의 `.pf-album*`. 메뉴는 링크 밖 형제라 링크 안에 버튼이 겹치지 않는다.
 *
 * `compareImage`(같은 구도의 원본)를 주면 전후 비교가 생긴다(2026-10-31):
 * - 마우스: 카드 위에서 좌우로 움직이면 세로선이 따라오고, 선 왼쪽은 원본·오른쪽은 시안으로 갈라 보인다(글자 표시 없음).
 * - 터치: 누르고 있는 동안 원본 전체가 보인다(놓으면 시안). 길게 누른 뒤에는 시안으로 넘어가지 않는다.
 * 비교 중 값(--cut)은 렌더 없이 카드 요소에 바로 쓴다(움직임마다 다시 그리지 않는다).
 */
export function RecordCard({
  href,
  category,
  title,
  updatedAt,
  image,
  compareImage,
  onRename,
  onDelete,
}: {
  href: string
  /** 제목 아래 작은 글자(예: 모델 이름 · 바뀐 부위) */
  category: string
  title: string
  /** ISO-8601 */
  updatedAt: string
  image?: ReactNode
  /** 같은 구도의 원본 그림. 주면 전후 비교가 생긴다 */
  compareImage?: ReactNode
  onRename?: () => void
  onDelete?: () => void
}) {
  const card = useRef<HTMLElement>(null)
  const hold = useRef<{ timer: number; held: boolean } | null>(null)

  const setCut = (percent: number | null) => {
    const element = card.current
    if (!element) return
    if (percent === null) {
      delete element.dataset.comparing
      element.style.removeProperty('--cut')
      return
    }
    element.dataset.comparing = ''
    element.style.setProperty('--cut', `${percent}%`)
  }
  const onMove = (event: PointerEvent<HTMLElement>) => {
    if (!compareImage || event.pointerType === 'touch') return
    const box = event.currentTarget.getBoundingClientRect()
    setCut(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)))
  }
  const endHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer)
    if (hold.current && !hold.current.held) hold.current = null
    setCut(null)
  }

  return (
    <article
      ref={card}
      className="pf-album"
      data-compare={compareImage ? '' : undefined}
      onPointerMove={onMove}
      onPointerLeave={() => setCut(null)}
      onPointerDown={(event) => {
        if (!compareImage || event.pointerType !== 'touch') return
        const timer = window.setTimeout(() => {
          if (hold.current) hold.current.held = true
          setCut(100)
        }, 220)
        hold.current = { timer, held: false }
      }}
      onPointerUp={endHold}
      onPointerCancel={endHold}
    >
      <Link
        href={href}
        aria-label={`${title} 시안 열기`}
        className="pf-album-link"
        onClickCapture={(event) => {
          // 길게 눌러 원본을 본 뒤에는 시안으로 넘어가지 않는다
          if (hold.current?.held) event.preventDefault()
          hold.current = null
        }}
        onContextMenu={(event) => {
          if (hold.current) event.preventDefault()
        }}
      >
        <span className="pf-album-media">{image}</span>
        {compareImage ? (
          <>
            <span className="pf-album-before" aria-hidden>
              {compareImage}
            </span>
            {/* 비교선만(글자 표시는 ⋮와 겹쳐 뺐다, 2026-10-31) */}
            <span className="pf-album-cut" aria-hidden />
          </>
        ) : null}
        <span className="pf-album-scrim" aria-hidden />
        <span className="pf-album-text">
          <h3>{title}</h3>
          <span className="pf-album-meta">
            <span className="truncate">{category}</span>
            <time dateTime={updatedAt}>{formatAlbumDate(updatedAt)}</time>
          </span>
        </span>
      </Link>
      {onRename || onDelete ? (
        <ItemMenu
          className="pf-album-menu"
          label={`${title} 메뉴`}
          actions={[
            ...(onRename ? [{ label: '이름 바꾸기', onSelect: onRename }] : []),
            ...(onDelete ? [{ label: '삭제', danger: true, onSelect: onDelete }] : []),
          ]}
        />
      ) : null}
    </article>
  )
}

/**
 * Figma `v3/Card/ServiceChoice` — 서비스 고르기 한 줄(아이콘·이름·부제·체험 배지·화살표).
 * Figma의 영문 부제는 서비스 화면에서 빼서(S15P31B204-419) subtitle은 선택이다.
 */
export function ServiceChoice({
  icon,
  title,
  subtitle,
  status,
  selected = false,
  href,
}: {
  icon: IconName
  title: ReactNode
  subtitle?: string
  status: BadgeStatus
  selected?: boolean
  href: string
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'group flex min-h-[64px] w-full items-center gap-(--space-12) rounded-(--pf-radius-md) px-(--space-12) py-(--space-12) transition-colors duration-150',
        // 2026-10-31: 테두리 없이. 고른 칸은 옅은 잉크 면 + 잉크로 채운 아이콘, 나머지는 흐린 아이콘
        selected
          ? 'bg-[color-mix(in_srgb,var(--pf-ink)_5%,transparent)]'
          : 'hover:bg-[color-mix(in_srgb,var(--pf-ink)_3%,transparent)]',
      )}
    >
      <span
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
          selected ? 'bg-text-ink text-text-on-dark' : 'text-muted group-hover:text-text-ink',
        )}
      >
        <Icon name={icon} weight="light" size={20} />
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-(--space-4) whitespace-nowrap">
        <span className="text-[14.5px] font-medium text-text-ink">{title}</span>
        {subtitle ? (
          <span className="type-en-micro-7-regular-ls0p7-lh12p6 text-text-sand">{subtitle}</span>
        ) : null}
      </span>
      <Badge status={status} />
      <Icon name="CaretRight" size={12} className="shrink-0" />
    </Link>
  )
}

/** Figma `v3/Card/ModelTile` — 모델 고르기 칸. Kind: Selected · Default · Add */
export function ModelTile({
  kind,
  index,
  title,
  subtitle,
  image,
  onClick,
}: {
  kind: 'selected' | 'default' | 'add'
  /** 왼쪽 위 번호(예: 01). Add에는 없다 */
  index?: string
  title: string
  subtitle: string
  image?: ReactNode
  onClick: () => void
}) {
  const isAdd = kind === 'add'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isAdd ? undefined : kind === 'selected'}
      className="flex w-full flex-col items-start gap-(--space-4) pb-(--space-8) text-left"
    >
      <span
        className={cx(
          'relative flex h-[100px] w-full items-center justify-center overflow-hidden rounded-7',
          isAdd && 'border border-dashed border-[#cccabe] text-[#8d8d85]',
          kind === 'default' && 'bg-[#efeee8] p-px',
          kind === 'selected' &&
            'border border-[#8b5fbe] bg-[#e8e5eb] p-px shadow-[0_0_0_1px_#8b5fbe]',
        )}
      >
        {isAdd ? <Icon name="Plus" size={28} /> : image}
        {index && !isAdd ? (
          <span className="type-en-micro-8-regular-ls1-lh10p4 absolute top-[9px] left-[9px] text-[#919489]">
            {index}
          </span>
        ) : null}
        {kind === 'selected' ? (
          <span className="absolute top-[7px] right-[9px] flex size-[15px] items-center justify-center rounded-full bg-brand-violet text-text-on-dark">
            <Icon name="Check" size={8} />
          </span>
        ) : null}
      </span>
      <span className="type-kr-body-12-medium-lh15p6 mt-[2px] text-text-ink">{title}</span>
      <span className="type-kr-caption-10-regular-lh13 text-[#73736e]">{subtitle}</span>
    </button>
  )
}

/** Figma `v3/LabServiceRow` — 실험실 왼쪽의 서비스 한 줄 */
export function LabServiceRow({
  icon,
  label,
  status,
  expanded,
  onClick,
}: {
  icon: IconName
  label: ReactNode
  status: BadgeStatus
  expanded?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="flex h-[46px] w-full items-center gap-(--space-8) py-[13px] text-left text-text-ink"
    >
      <Icon name={icon} size={17} className="shrink-0" />
      <span className="type-kr-caption-11-regular-lh14p3 flex-1">{label}</span>
      <Badge status={status} size="sm" />
      <Icon name="CaretRight" size={11} className="shrink-0" />
    </button>
  )
}
