'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useControlSheet } from '@/app/preview/use-control-sheet'
import { ApiError } from '@/shared/api/ApiError'
import { Button, cx, Icon, toast, Tooltip } from '@/shared/ui'
import { PRIVATE_TEXT } from '@/shared/analytics'

/** 아래 시트로 동작하는 폭(md 미만) */
const PHONE = '(max-width: 767px)'

function subscribePhone(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(PHONE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** 휴대폰 폭인지. 서버 렌더와 matchMedia가 없는 곳에서는 아니라고 본다(조절을 막지 않는다) */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches,
    () => false,
  )
}

/**
 * 실험실 화면 뼈대. Figma Wireframe v3.2 `lab`(P3-61·P3-68·P3-64).
 *
 * - Desktop: 위 `lab-toolbar` + 아래 `lab-body` = 왼쪽 3D(`lab-stage`) · 오른쪽 `inspector`(365px).
 *   헤더(76px, shared/ui Header) 아래를 화면 높이만큼 채우고, inspector 안만 스크롤한다. * - Mobile(<768): toolbar → 3D, 조작 카드는 메인 체험하기와 같은 아래 시트(2026-11-01, -573).
 *   사이트 헤더는 숨긴다(SiteHeader `hidesHeaderOnPhone`). 뒤로 가기·저장은 툴바가 맡는다.
 *   접힘 = 손잡이·방식·부위 탭·첫 조절까지 올라와 있어 바로 만진다. 손잡이를 누르거나 끌어 펼친다(`useControlSheet`).
 *   조절은 탭 패널(`data-sheet-scroll`) 안에서 넘기고, 펼친 상담은 대화 공간을 더 넓게 쓴다.
 *   접힌 채로도 넘겨 다음 조절을 만진다. 상담은 입력창이 보이는 곳(접힘이면 접힌 높이 바닥)에 붙는다.
 *   여닫아도 페이지를 움직이지 않는다. 3D가 세로 밀기를 회전으로 받아, 페이지를 내리면 위 메뉴로 돌아갈 수 없다(-525).
 *   무대는 접힌 시트 위까지 늘어나 얼굴을 크게 돌려 본다.
 */
export function LabShell({
  toolbar,
  stage,
  inspector,
  expandSheet = false,
}: {
  toolbar: ReactNode
  stage: ReactNode
  inspector: ReactNode
  /** 휴대폰에서 시트를 펼친다(예: `원본 사진` 탭, S15P31B204-770). 접힌 채로는 첫 조절 높이만 보여 사진이 작다 */
  expandSheet?: boolean
}) {
  const { sheetRef, open, setOpen, handleProps } = useControlSheet({
    // 접힘 = 첫 조절까지(체험하기와 같다, -573). 상담으로 바꿔도 이 높이를 지킨다
    peekSelector: '.cc-group-body > :first-child',
    stageSelector: '.pf-lab-stage',
    mobileQuery: PHONE,
    // 여닫아도 페이지를 움직이지 않는다. 위 메뉴·툴바 뒤로 가기가 그대로 남는다
    reveal: 'none',
  })
  const isPhone = useIsPhone()
  const shellRef = useRef<HTMLDivElement>(null)

  // 사진 탭처럼 크게 봐야 하는 내용이면 휴대폰 시트를 펼친다
  useEffect(() => {
    if (expandSheet && isPhone) setOpen(true)
  }, [expandSheet, isPhone, setOpen])

  // 무대가 페이지 맨 위에서 얼마나 내려와 있는지. 접힌 동안 무대를 화면 아래(손잡이 위)까지 늘리는 데 쓴다(service.css)
  useEffect(() => {
    const shell = shellRef.current
    const stage = shell?.querySelector<HTMLElement>('.pf-lab-stage')
    if (!shell || !stage) return
    const measure = () => {
      const top = stage.getBoundingClientRect().top + window.scrollY
      shell.style.setProperty('--pf-lab-stage-top', `${Math.round(top)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    // 툴바가 두 줄로 바뀌는 등 위쪽 높이가 바뀌면 다시 잰다
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(shell)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])

  // 휴대폰 키보드: 화면(visual viewport)이 가려진 만큼 시트를 키보드 위로 올리고 높이를 줄인다.
  // 레이아웃 뷰포트는 키보드가 떠도 줄지 않아(iOS·Android 기본) 바닥에 붙은 시트가 키보드 뒤로 숨는다
  useEffect(() => {
    const sheet = sheetRef.current
    const viewport = window.visualViewport
    if (!isPhone || !sheet || !viewport) return
    const update = () => {
      const hidden = window.innerHeight - viewport.height - viewport.offsetTop
      sheet.style.setProperty('--pf-lab-kb', `${Math.max(0, Math.round(hidden))}px`)
      sheet.style.setProperty('--pf-lab-vvh', `${Math.round(viewport.height)}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      sheet.style.removeProperty('--pf-lab-kb')
      sheet.style.removeProperty('--pf-lab-vvh')
    }
  }, [isPhone, sheetRef])

  return (
    <div
      ref={shellRef}
      className="pf-lab-shell flex flex-col bg-bg-paper text-text-ink md:h-[calc(100dvh-76px)]"
    >
      {toolbar}
      <div className="pf-lab-body flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <div className="pf-lab-stage h-[65svh] min-h-0 md:h-auto md:min-w-0 md:flex-1">{stage}</div>
        <aside
          ref={sheetRef}
          id="pf-lab-controls"
          aria-label="변화 만들기"
          data-sheet={open ? 'open' : 'closed'}
          // 유리 카드의 빛 맺힘이 커서를 따라간다(service.css `.pf-lab-inspector::before`)
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`)
            event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`)
          }}
          className="pf-lab-inspector flex flex-col border-line-default bg-bg-paper md:min-h-0 md:w-[365px] md:shrink-0 md:border-l"
        >
          {/* 높이 32px. 접혀도 첫 조절까지 보여 `조절 열기` 글자는 두지 않는다(-573) */}
          <button
            type="button"
            className="pf-lab-sheet-handle mx-auto flex h-8 w-full shrink-0 touch-none items-center justify-center md:hidden"
            aria-controls="pf-lab-controls"
            aria-expanded={open}
            aria-label={open ? '조절 접기' : '조절 열기'}
            {...handleProps}
            // 키보드(Enter·Space)는 포인터 이벤트가 없어 여기서 바꾼다
            onClick={(event) => {
              if (event.detail === 0) setOpen((value) => !value)
            }}
          >
            <span aria-hidden="true" className="h-1 w-9 shrink-0 rounded-full bg-hairline-strong" />
          </button>
          {inspector}
        </aside>
      </div>
    </div>
  )
}

const TITLE_TEXT = 'text-[17px] leading-[1.3] font-semibold tracking-[-0.02em] text-ink'

/** 도구 줄에서 제목(시안 이름)을 바로 고치는 데 필요한 것 */
export interface TitleRename {
  /** 앞뒤 공백을 뺀 새 이름을 저장한다. 실패하면 던진다 */
  onSave: (title: string) => Promise<unknown>
  /** 규칙에 맞지 않으면 문구, 맞으면 null(작업실 이름 바꾸기와 같은 규칙) */
  validate: (title: string) => string | null
  maxLength: number
  /** 입력이 maxLength에 닿으면 칸 아래에 보이는 안내(-838). 없으면 띄우지 않는다 */
  limitHint?: string
  /** 처음 그릴 때부터 입력칸으로 연다(완료 알림의 `이름 바꾸기`로 돌아왔을 때, -844) */
  startEditing?: boolean
}

/**
 * 누르면 그 자리에서 입력칸이 되는 제목(-812). Enter·칸 밖을 누르면 저장, Esc는 취소.
 * - 이름은 여기서만 고친다(-844, 시안 저장 이름 창을 걷음). 그래서 연필 아이콘을 늘 보이고, 마우스를 올리면
 *   옅은 바탕·글자 커서·`이름 바꾸기` 말풍선으로 고칠 수 있다는 것을 알린다. 제목 글자나 연필 어디를 눌러도 고치기 시작한다
 * - 규칙에 맞지 않으면 알림으로 이유를 보인다. Enter면 고치게 입력칸을 두고, 칸 밖을 누르면 원래 이름으로 돌린다
 * - 저장에 실패하면 알림으로 알리고 원래 이름으로 돌린다
 * - 한글 조합 중 Enter(조합 확정)는 저장으로 보지 않는다
 */
function EditableTitle({ title, rename }: { title: string; rename: TitleRename }) {
  const [draft, setDraft] = useState<string | null>(rename.startEditing ? title : null)
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // 저장·취소를 시작하면 끈다. 그 뒤 따라오는 blur가 한 번 더 저장하지 않게 한다
  const active = useRef(!!rename.startEditing)
  const editing = draft !== null

  useEffect(() => {
    if (!editing) return
    input.current?.focus()
    input.current?.select()
  }, [editing])

  const start = () => {
    active.current = true
    setDraft(title)
  }

  const cancel = () => {
    active.current = false
    setDraft(null)
  }

  const commit = async (value: string, keepOnInvalid: boolean) => {
    if (!active.current) return
    const next = value.trim()
    if (next === title) return cancel()
    const invalid = rename.validate(value)
    if (invalid) {
      toast(invalid)
      if (!keepOnInvalid) cancel()
      return
    }
    active.current = false
    setSaving(true)
    try {
      await rename.onSave(next)
    } catch (cause) {
      const fields = cause instanceof ApiError ? cause.fieldErrors() : {}
      toast(fields.title ?? (cause instanceof Error ? cause.message : '이름을 바꾸지 못했어요.'))
    } finally {
      setSaving(false)
      setDraft(null)
    }
  }

  if (editing) {
    const atLimit = rename.limitHint !== undefined && draft.length >= rename.maxLength
    // 입력칸은 한글 10글자 남짓이 들어가는 고정 폭이다(-844, 전에는 도구 줄을 가로질렀다). 글자 길이와 관계없이 같고,
    // 더 긴 이름(20자까지)은 칸 안에서 밀려 보인다. 11em = 제목 글자(17px) 10글자 + 좌우 여백. 좁은 화면에서는 줄 폭을 넘지 않는다
    return (
      <span className="relative -mx-(--space-6) inline-flex max-w-full min-w-0">
        <input
          {...PRIVATE_TEXT}
          ref={input}
          aria-label="시안 이름"
          aria-describedby={atLimit ? 'pf-lab-title-hint' : undefined}
          value={draft}
          maxLength={rename.maxLength}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void commit(event.currentTarget.value, true)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          onBlur={(event) => void commit(event.currentTarget.value, false)}
          className={cx(
            'w-[11em] max-w-full min-w-0 rounded-8 bg-ink/5 px-(--space-6) outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
            TITLE_TEXT,
          )}
        />
        {/* 한도 안내는 제목 아래(모델 이름 줄) 위에 덮어 띄운다. 도구 줄 높이가 바뀌지 않게 자리를 차지하지 않는다 */}
        {atLimit ? (
          <span
            id="pf-lab-title-hint"
            className="type-caption absolute top-full left-(--space-6) z-10 mt-(--space-5) bg-bg-paper pr-(--space-8) whitespace-nowrap text-muted-soft"
          >
            {rename.limitHint}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <Tooltip label="이름 바꾸기">
      {(describedBy) => (
        <button
          type="button"
          onClick={start}
          aria-describedby={describedBy}
          className="group -mx-(--space-6) inline-flex min-w-0 cursor-text items-center gap-(--space-6) rounded-8 px-(--space-6) text-left transition-colors duration-(--pf-dur-ui) hover:bg-ink/5"
        >
          <span {...PRIVATE_TEXT} className={cx('truncate', TITLE_TEXT)}>
            {title}
          </span>
          <Icon
            name="PencilSimple"
            size={15}
            className="shrink-0 text-muted-soft transition-colors duration-(--pf-dur-ui) group-hover:text-ink"
          />
          <span className="sr-only">시안 이름 바꾸기</span>
        </button>
      )}
    </Tooltip>
  )
}

/** Figma `lab-toolbar` — 뒤로 · 시안 이름(바로 고침)·모델 이름 · 저장 상태 · 되돌리기·앞으로·원본 보기·공유 · 완료(-844) */
export function LabToolbar({
  backHref,
  backLabel,
  title,
  titleAside,
  subtitle,
  rename,
  status,
  actions,
}: {
  backHref: string
  backLabel: string
  title: string
  /** 제목 바로 오른쪽에 붙는 작은 것(설문 참여 등). 도구(되돌리기·완료)와 떨어뜨려 둔다 */
  titleAside?: ReactNode
  /** 제목 아래 작은 설명(예: 시안을 만든 모델 이름). 없으면 제목만 보인다 */
  subtitle?: string
  /** 있으면 제목을 눌러 그 자리에서 이름을 고친다(-812). 기본 모델 체험처럼 이름이 없는 화면은 넘기지 않는다 */
  rename?: TitleRename
  /** 저장 상태 문구(`자동 저장됨` 등). Desktop에서만 보인다 */
  status?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="pf-lab-toolbar flex items-center gap-(--space-12) border-b border-line-default px-(--space-16) py-(--space-12) md:gap-(--space-18) md:px-(--space-24) md:py-(--space-14)">
      {/* 뒤로가기는 아이콘만(2026-10-30). 이름은 읽기 프로그램·툴팁에만 */}
      <Link
        href={backHref}
        className="-ml-(--space-8) inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-(--pf-dur-ui) hover:bg-ink/5"
      >
        <Icon name="ArrowLeft" size={20} />
        <span className="sr-only">{backLabel}</span>
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-(--space-5)">
        {/* 좁은 화면에서 제목이 최소 8글자 폭은 지키고, 모자라면 옆 칩(설문)이 다음 줄로 내려간다(2026-10-31) */}
        <div className="pf-lab-toolbar-title flex min-w-0 flex-wrap items-center gap-x-(--space-10) gap-y-(--space-4)">
          {rename ? (
            <EditableTitle title={title} rename={rename} />
          ) : (
            <p
              {...PRIVATE_TEXT}
              className={cx('max-w-full min-w-[min(100%,8em)] truncate', TITLE_TEXT)}
            >
              {title}
            </p>
          )}
          {titleAside}
        </div>
        {subtitle ? (
          <p className="pf-lab-toolbar-subtitle type-caption truncate text-muted-soft">
            {subtitle}
          </p>
        ) : null}
      </div>
      {status ? (
        <p
          aria-live="polite"
          className="pf-lab-toolbar-status type-caption hidden whitespace-nowrap text-muted-soft md:block"
        >
          {status}
        </p>
      ) : null}
      {actions ? (
        <div className="pf-lab-toolbar-actions flex shrink-0 items-center gap-(--space-4) md:gap-(--space-12)">
          {actions}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 툴바 아이콘 버튼. 앞으로 가기는 Figma 아이콘이 없어 되돌리기 아이콘을 좌우로 뒤집는다.
 * 말풍선은 아이콘만으로 뜻이 안 보이는 것(처음으로)에만 `hint`로 단다. 되돌리기·앞으로 가기는 아이콘이 곧 뜻(2026-10-31)
 */
export function ToolbarIconButton({
  icon,
  label,
  onClick,
  disabled,
  mirrored,
  hint = false,
}: {
  icon: 'ArrowCounterClockwise' | 'ClockCounterClockwise' | 'PaperPlaneTilt'
  label: string
  onClick: () => void
  disabled?: boolean
  mirrored?: boolean
  hint?: boolean
}) {
  const button = (describedBy?: string) => (
    <Button
      variant="icon"
      icon={icon}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={onClick}
      disabled={disabled}
      className={cx(mirrored && '-scale-x-100')}
    />
  )
  return hint ? <Tooltip label={label}>{button}</Tooltip> : button()
}
