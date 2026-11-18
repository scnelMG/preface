'use client'

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

/**
 * Figma `v3/Modal` — 머리말(Eyebrow·제목) + 닫기 + 내용. 뒤 배경은 어둡게 흐린다.
 *
 * 브라우저 내장 <dialog>의 showModal()을 쓴다. 그래서 따로 만들지 않아도
 * ① ESC로 닫히고 ② 바깥 요소가 비활성(inert)이라 Tab 포커스가 모달 안에 갇히고
 * ③ 열 때 포커스가 모달 안으로 들어가고 닫으면 원래 자리로 돌아간다.
 *
 * v4(2026-10-30): 흰 카드 · 반경 28 · 머리카락 선 · 옅은 그림자, 닫기는 40px 원 아이콘 버튼.
 * Desktop 폭 440·여백 28, Mobile 폭 360·여백 24. 뒤 배경 잉크 30% + 흐림 8px.
 *
 * 이슈 S15P31B204-273 완료 조건은 "모바일은 바텀시트"인데, Figma Wireframe v3.2 최종(P3-09 Mobile)은
 * 화면 가운데 카드다. 사용자 지시("v3.2 최종 기준")에 따라 가운데 카드로 둔다.
 *
 * placement="sheet": 휴대폰(md 미만)에서 화면 아래에 붙어 올라오는 시트로 연다. PC는 가운데 카드 그대로다.
 * dismissible={false}: 닫기(X)와 뒤 배경 누르기로 닫지 않는다. 안의 버튼으로만 넘어간다(Esc·안드로이드 뒤로 가기는 닫힌다).
 * 휴대폰 시트는 위 두 모서리만 16px로 둥글고 아래·양옆은 화면 끝에 붙는다(-883).
 * 둘 다 휴대폰 촬영 가이드의 "찍기 전에" 팝업이 쓴다(S15P31B204-566).
 */
export interface ModalProps {
  open: boolean
  onClose: () => void
  /** 제목 위 작은 문구. 서비스 화면에서는 쓰지 않는다(영문 장식 문구를 뺐다, S15P31B204-419) */
  eyebrow?: string
  title: ReactNode
  children?: ReactNode
  /** 닫기 버튼 이름 */
  closeLabel?: string
  className?: string
  /** 휴대폰에서 아래 시트로 열지. 기본은 가운데 카드 */
  placement?: 'center' | 'sheet'
  /** false면 닫기(X)를 숨기고 뒤 배경을 눌러도 닫지 않는다. 기본 true */
  dismissible?: boolean
}

export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  children,
  closeLabel = '닫기',
  className,
  placement = 'center',
  dismissible = true,
}: ModalProps) {
  const sheet = placement === 'sheet'
  const ref = useRef<HTMLDialogElement>(null)
  // 마지막으로 누른 곳이 뒤 배경(= dialog 자신)이었는지. 카드 안에서 누른 채 밖으로 끌어 놓아도 브라우저는
  // click을 배경에 준다(누른 곳·놓은 곳의 공통 조상). 그래서 누를 때부터 배경이었을 때만 닫는다(-435)
  const pressedOnBackdrop = useRef(false)
  const titleId = useId()

  // cacheComponents는 떠난 화면을 <Activity hidden>(display: none)으로 남긴다. 열린 dialog가 그대로 남으면
  // 보이지 않는데도 문서 나머지를 inert로 만들어 다음 화면이 눌리지 않는다(-391).
  // 그래서 숨을 때(정리 함수) 닫고, 다시 보이면 effect가 다시 돌아 연다. 숨기 전에 바로 닫히게 layout effect로 둔다
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
    return () => {
      if (dialog.open) dialog.close()
    }
  }, [open])

  // 모달이 열린 동안 뒤 화면이 스크롤되지 않게 한다
  useEffect(() => {
    if (!open) return
    const { overflow } = document.documentElement.style
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = overflow
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // 화면 CSS(service.css)가 휴대폰 시트 모서리를 맞출 때 쓰는 표시(-883)
      data-placement={placement}
      // ESC: 브라우저가 닫기 전에 cancel을 보낸다. 상태는 부모가 쥐고 있으므로 부모에게 맡긴다
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget
      }}
      // 뒤 배경(= dialog 자신)을 누르고 놓으면 닫는다. 카드 안을 누른 것은 target이 다르다
      onClick={(event) => {
        const fromBackdrop = pressedOnBackdrop.current
        pressedOnBackdrop.current = false
        if (dismissible && event.target === event.currentTarget && fromBackdrop) onClose()
      }}
      className={cx(
        // 브라우저 높이보다 길면 카드 안에서 스크롤한다(버튼이 화면 밖으로 잘리지 않게)
        'overflow-x-hidden overflow-y-auto border border-transparent bg-surface p-0 text-ink',
        'shadow-[0_1px_2px_oklch(0.2_0.01_286/0.04),0_24px_64px_oklch(0.2_0.01_286/0.14)]',
        sheet
          ? // 휴대폰: 화면 아래에 붙고 위 모서리만 둥글다. 홈 표시줄만큼 아래 여백을 둔다. PC는 가운데 카드
            'mx-0 mt-auto mb-0 max-h-[calc(100dvh-24px)] w-full max-w-full rounded-t-(--pf-radius-sheet) rounded-b-none pb-[env(safe-area-inset-bottom)] md:m-auto md:max-h-[calc(100dvh-40px)] md:w-[440px] md:max-w-[calc(100vw-32px)] md:rounded-(--pf-radius-xl) md:pb-0'
          : 'm-auto max-h-[calc(100dvh-40px)] w-[360px] max-w-[calc(100vw-32px)] rounded-(--pf-radius-xl) md:w-[440px]',
        // v4: 뒤 배경은 잉크 30% + 흐림 8px, 열릴 때 한 번 살짝 떠오른다(동작 줄이기면 시간이 0)
        'backdrop:bg-[oklch(0.2_0.008_286/0.3)] backdrop:backdrop-blur-[8px] open:animate-[pf-rise_var(--pf-dur-sheet)_var(--pf-ease-out)]',
        className,
      )}
    >
      <div className="flex flex-col p-(--space-24) md:p-(--space-28)">
        <header className="flex items-start justify-between gap-(--space-12)">
          <div className="flex flex-col gap-(--space-16)">
            {eyebrow ? (
              <p className="type-en-micro-8-medium-ls1p3-lh10p4 md:type-en-micro-8-medium-ls1p8-lh10p4 font-medium text-text-body">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id={titleId}
              className="pt-(--space-6) text-[20px] leading-[1.3] font-semibold tracking-[-0.02em] text-balance md:text-[22px]"
            >
              {title}
            </h2>
          </div>
          {dismissible ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="-mt-(--space-4) -mr-(--space-8) inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-soft transition-colors duration-(--pf-dur-ui) hover:bg-ink/5 hover:text-ink"
            >
              <Icon name="X" size={20} />
            </button>
          ) : null}
        </header>
        {children ? <div className="mt-(--space-16)">{children}</div> : null}
      </div>
    </dialog>
  )
}
