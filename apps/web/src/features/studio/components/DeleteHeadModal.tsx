'use client'

import { Button, Modal } from '@/shared/ui'
import { objectParticle } from '../heads'
import { PRIVATE_TEXT } from '@/shared/analytics'

/**
 * 내 모델(3D) 삭제 확인(API-HIS-03, FN-HIS-03). Figma `Wireframe v3.2 최종`에 3D 삭제 화면이 없어
 * SCR-15 기록 삭제(Figma 266:2167, `DeleteRecordModal`)와 같은 모양으로 만들었다.
 * 열고 닫는 상태와 삭제 호출은 부모가 쥔다.
 */
export function DeleteHeadModal({
  title,
  simulationCount,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** 지울 모델 이름 */
  title: string
  /** 함께 지워지는 시안 수(HIS-01 `simulationCount`, 빈 시안 제외) */
  simulationCount: number
  open: boolean
  busy: boolean
  /** 마지막 시도가 실패했을 때 안내 문구. 있으면 확인 버튼이 `다시 시도`가 된다 */
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title="이 모델을 삭제할까요?">
      <div className="flex flex-col gap-(--space-8)">
        <p className="type-lead break-keep text-ink-2">
          ‘<span {...PRIVATE_TEXT}>{title}</span>’{objectParticle(title)} 삭제하면{' '}
          {simulationCount > 0
            ? `이 모델로 만든 시안 ${simulationCount}개도 함께 삭제돼요.`
            : '이 모델로 만든 시안도 함께 삭제돼요.'}{' '}
          작업실에서 바로 사라지고 되돌릴 수 없어요.
        </p>
        <p className="type-caption text-muted-soft">3D 파일은 30일 뒤 서버에서 영구 삭제돼요.</p>
        {error ? (
          <p role="alert" className="type-caption text-(--pf-danger)">
            {error}
          </p>
        ) : null}
      </div>
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
          {busy ? '삭제하는 중' : error ? '다시 시도' : '삭제'}
        </Button>
      </div>
    </Modal>
  )
}
