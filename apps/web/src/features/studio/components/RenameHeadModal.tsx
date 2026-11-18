'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '@/shared/api/ApiError'
import { Button, Modal } from '@/shared/ui'
import { HEAD_TITLE_MAX, validateHeadTitle } from '../heads'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * 내 모델 이름 바꾸기(API-HIS-08 가안). Figma에 화면이 없어 예전 시안 저장 팝업(Figma P3-91, -844에서 걷음)의
 * 이름 입력과 3D 삭제 확인(`DeleteHeadModal`)의 버튼 줄을 합쳐 만들었다.
 * 열고 닫는 상태는 부모가 쥔다. `onSave`가 실패를 던지면 창 안에 문구를 보인다
 * (400 `COMMON_001`은 필드 사유 → 서버 문구 순).
 */
export function RenameHeadModal({
  open,
  currentTitle,
  onClose,
  onSave,
  heading = '모델 이름 바꾸기',
  fieldLabel = '모델 이름',
  maxLength = HEAD_TITLE_MAX,
  validate = validateHeadTitle,
  limitHint,
}: {
  open: boolean
  /** 지금 이름. 열 때마다 입력칸을 이 값으로 채운다 */
  currentTitle: string
  onClose: () => void
  /** 앞뒤 공백을 뺀 새 이름을 받는다 */
  onSave: (title: string) => Promise<void>
  /** 시안 이름 바꾸기에도 같은 창을 쓴다(2026-10-30). 생략하면 모델 이름 규칙 */
  heading?: string
  fieldLabel?: string
  maxLength?: number
  validate?: (title: string) => string | null
  /** 입력이 maxLength에 닿으면 글자 수 왼쪽에 보이는 안내(시안 이름, S15P31B204-838). 없으면 띄우지 않는다 */
  limitHint?: string
}) {
  const inputId = useId()
  const countId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(currentTitle)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 열 때마다 지금 이름으로 다시 채운다(닫혀 있는 동안 이름이 바뀌었을 수 있다)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTitle(currentTitle)
      setError(null)
    }
  }

  // Modal이 showModal()로 연 뒤(자식 effect가 먼저 돈다) 입력칸에 포커스를 두고 전체 선택한다
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open])

  const trimmed = title.trim()
  const canSave = !saving && trimmed.length > 0 && trimmed !== currentTitle

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    const invalid = validate(title)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
    } catch (cause) {
      const fields = cause instanceof ApiError ? cause.fieldErrors() : {}
      setError(
        fields.title ??
          (cause instanceof Error && cause.message ? cause.message : '이름을 바꾸지 못했어요.'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title={heading}>
      <form onSubmit={submit} className="flex flex-col">
        <label htmlFor={inputId} className="type-label text-ink-2">
          {fieldLabel}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          {...PRIVATE_TEXT}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setError(null)
          }}
          maxLength={maxLength}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${countId} ${errorId}` : countId}
          className="mt-(--space-8) h-12 w-full rounded-(--pf-radius-md) border border-hairline-strong bg-canvas px-(--space-16) text-[15px] text-ink transition-colors duration-(--pf-dur-ui) focus:border-ink focus:bg-surface focus:outline-none"
        />
        <div className="mt-(--space-8) flex items-start justify-between gap-(--space-12)">
          {error ? (
            <p id={errorId} role="alert" className="type-caption text-(--pf-danger)">
              {error}
            </p>
          ) : limitHint && title.length >= maxLength ? (
            <p className="type-caption text-muted-soft">{limitHint}</p>
          ) : (
            <span />
          )}
          <p id={countId} className="type-caption shrink-0 text-muted-soft tabular-nums">
            {title.length}/{maxLength}
          </p>
        </div>
        <div className="mt-(--space-24) grid grid-cols-2 gap-(--space-8)">
          <Button
            variant="secondary"
            trailingIcon={null}
            onClick={onClose}
            disabled={saving}
            className="w-full"
          >
            취소
          </Button>
          <Button
            type="submit"
            variant="ink"
            trailingIcon={null}
            disabled={!canSave}
            aria-busy={saving || undefined}
            className="w-full"
          >
            {saving ? '바꾸는 중' : '바꾸기'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
