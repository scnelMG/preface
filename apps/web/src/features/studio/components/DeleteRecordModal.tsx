'use client'

import { Button, Modal } from '@/shared/ui'
import { objectParticle } from '../heads'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * SCR-15 공통 확인 모달 · 기록 삭제(Figma 266:2167). 열고 닫는 상태와 삭제 호출은 부모가 쥔다.
 */
export function DeleteRecordModal({
  title,
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  /** 지울 시안 이름 */
  title: string
  open: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title="이 시안을 삭제할까요?">
      <p className="type-lead break-keep text-ink-2">
        ‘<span {...PRIVATE_TEXT}>{title}</span>’{objectParticle(title)} 삭제하면 되돌릴 수 없어요.
      </p>
      <div className="mt-(--space-24) grid grid-cols-2 gap-(--space-8)">
        <Button
          variant="secondary"
          trailingIcon={null}
          onClick={onCancel}
          disabled={busy}
          className="w-full"
        >
          취소
        </Button>
        <Button
          variant="danger"
          trailingIcon={null}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
          className="w-full"
        >
          {busy ? '삭제하는 중' : '삭제'}
        </Button>
      </div>
    </Modal>
  )
}
