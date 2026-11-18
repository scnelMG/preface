'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'

/**
 * 모바일(≤760px) 조절 패널을 아래 시트로 쓴다. 접힘 = 손잡이·부위 탭·첫 슬라이더 묶음까지 보이는 높이,
 * 펼침 = 전체. 손잡이를 누르면 바뀌고, 끌면 손가락을 1:1로 따라온 뒤 놓는 속도까지 보고 정한다.
 * 데스크톱에서는 손잡이가 숨어 있어 아무 일도 하지 않는다(CSS가 transform을 쓰지 않는다).
 *
 * 시트 높이는 열림·접힘 모두 같고(접힘은 아래로 내려 위쪽만 보인다), 조절은 시트 안 스크롤 영역(`data-sheet-scroll`)에서
 * 넘긴다. 접힌 채로도 그 영역을 넘겨 다음 조절(코끝·콧볼 등)을 만진다(S15P31B204-573). 접힘 높이는 처음 잰 값을 지켜,
 * 부위·방식(직접 조절·상담)을 바꿔도 시트 높이가 달라지지 않는다. 화면 크기가 바뀔 때만 다시 잰다.
 */
const MOBILE = '(max-width: 760px)'
/** 손을 놓은 뒤 이 거리(px)만큼 더 미끄러진다고 보고 열림·접힘을 고른다 */
const PROJECTION_MS = 180
/** 이보다 빠르게(px/ms) 튕기면 거리와 관계없이 그 방향으로 연다·접는다 */
const FLICK_VELOCITY = 0.5
/** 이보다 덜 움직였으면 끌기가 아니라 누르기다 */
const TAP_SLOP = 6

export function useControlSheet({
  peekSelector = '.pp-adjustment-row, .pp-upcoming-panel',
  stageSelector = '.pp-model',
  mobileQuery = MOBILE,
  reveal = 'stage',
  peekGap = 14,
}: {
  /** 접힘 높이를 정하는 첫 요소 */
  peekSelector?: string
  /** 펼칠 때 화면 위로 올릴 3D 무대(시트의 형제) */
  stageSelector?: string
  /** 시트로 동작하는 화면 폭 */
  mobileQuery?: string
  /**
   * 펼칠 때 페이지를 옮길지. `stage` = 3D 무대를 화면 맨 위로 올린다.
   * `none` = 여닫아도 페이지를 움직이지 않는다(실험실, S15P31B204-525).
   * 무대가 3D라 세로로 밀어도 페이지가 움직이지 않으므로, 위 메뉴를 화면 밖으로 밀어내면 돌아갈 길이 없다
   */
  reveal?: 'stage' | 'none'
  /**
   * 접힘 높이에 더하는 여백(px). 기본 14는 첫 조절 아래 숨 쉴 틈이다.
   * 실험실은 손잡이만 남기려고 0을 준다(접으면 조절이 비치지 않는다)
   */
  peekGap?: number
} = {}) {
  const sheetRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const drag = useRef<{
    startY: number
    startT: number
    base: number
    lastY: number
    lastT: number
    velocity: number
  } | null>(null)

  /** 접힘 높이 = 첫 조절 아래까지. 시트 크기가 바뀌면 다시 재고, 첫 조절이 늦게 그려지면(모델 읽기) 그때 한 번 잰다 */
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    let measured = false
    const measure = () => {
      const first = sheet.querySelector<HTMLElement>(peekSelector)
      // 지금 방식에 첫 조절이 없으면(상담·불러오는 중) 앞서 잰 높이를 그대로 둔다
      if (!first) return
      // 시트 기준 위치로 잰다(offsetTop은 가장 가까운 위치 지정 조상 기준이라 안쪽 감싸개가 있으면 짧아진다).
      // 안쪽 스크롤 영역을 넘긴 만큼 첫 조절이 올라가 있으니 되돌려 더한다
      const scroller = first.closest<HTMLElement>('[data-sheet-scroll]') ?? sheet
      const peek =
        first.getBoundingClientRect().bottom -
        sheet.getBoundingClientRect().top +
        scroller.scrollTop +
        peekGap
      const collapse = Math.max(0, Math.round(sheet.offsetHeight - peek))
      // 시트와 형제(무대)가 같이 읽게 부모에도 둔다. 무대는 접힌 시트 위까지 늘어난다(실험실)
      for (const node of [sheet, sheet.parentElement]) {
        node?.style.setProperty('--pp-sheet-peek', `${Math.round(peek)}px`)
        // 접혀서 화면 아래로 내려간 길이. 레이아웃에서 이만큼을 빼 쓰는 화면(메인)과, 접힌 채 끝까지 넘기는 스크롤 영역이 읽는다
        node?.style.setProperty('--pp-sheet-collapse', `${collapse}px`)
      }
      measured = true
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resize?.observe(sheet)
    // 첫 조절이 나중에 그려지면 그때 잰다. 한 번 잰 뒤에는 부위·방식을 바꿔도 높이를 지킨다
    const mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            if (!measured) measure()
          })
    mutation?.observe(sheet, { childList: true, subtree: true })
    return () => {
      resize?.disconnect()
      mutation?.disconnect()
    }
  }, [peekSelector, peekGap])

  // 펼치면 편집 중인 얼굴이 시트 위로 보이게 모델 자리를 화면 위쪽으로 올린다
  useEffect(() => {
    if (!open || reveal === 'none' || !window.matchMedia(mobileQuery).matches) return
    const model = sheetRef.current?.parentElement?.querySelector<HTMLElement>(stageSelector)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    model?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }, [open, stageSelector, mobileQuery, reveal])

  // 펼친 상태에서 Escape로 접는다
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const collapsedOffset = () => {
    const sheet = sheetRef.current
    if (!sheet) return 0
    const peek = parseFloat(getComputedStyle(sheet).getPropertyValue('--pp-sheet-peek')) || 0
    return Math.max(0, sheet.offsetHeight - peek)
  }

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!window.matchMedia(mobileQuery).matches || !sheetRef.current) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const now = performance.now()
      drag.current = {
        startY: event.clientY,
        startT: now,
        base: open ? 0 : collapsedOffset(),
        lastY: event.clientY,
        lastT: now,
        velocity: 0,
      }
      sheetRef.current.style.transition = 'none'
    },
    [open, mobileQuery],
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    const sheet = sheetRef.current
    if (!state || !sheet) return
    const now = performance.now()
    state.velocity = (event.clientY - state.lastY) / Math.max(1, now - state.lastT)
    state.lastY = event.clientY
    state.lastT = now
    const max = collapsedOffset()
    let offset = state.base + (event.clientY - state.startY)
    // 끝을 넘으면 점점 덜 따라온다(딱 멈추지 않게)
    if (offset < 0) offset = -rubberband(-offset)
    if (offset > max) offset = max + rubberband(offset - max)
    sheet.style.transform = `translateY(${offset}px)`
  }, [])

  const onPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current
    const sheet = sheetRef.current
    drag.current = null
    if (!state || !sheet) return
    sheet.style.transition = ''
    sheet.style.transform = ''
    const moved = event.clientY - state.startY
    if (Math.abs(moved) < TAP_SLOP) {
      setOpen((value) => !value)
      return
    }
    // 빠르게 튕겼으면 방향만 본다. 아니면 놓은 뒤 미끄러질 위치가 30%를 넘었는지 본다
    if (Math.abs(state.velocity) > FLICK_VELOCITY) {
      setOpen(state.velocity < 0)
      return
    }
    const max = collapsedOffset()
    const projected = state.base + moved + state.velocity * PROJECTION_MS
    setOpen(state.base === 0 ? projected < max * 0.3 : projected < max * 0.7)
  }, [])

  return {
    sheetRef,
    open,
    setOpen,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}

function rubberband(overshoot: number, dimension = 400, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * overshoot)
}
