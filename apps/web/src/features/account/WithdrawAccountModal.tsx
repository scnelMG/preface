'use client'

import { useState } from 'react'
import type { Me } from '@/features/auth/types'
import { Button, Checkbox, Modal } from '@/shared/ui'
import { accountApi } from './api'
import { failureMessage } from './errors'

/**
 * SCR-14 회원 탈퇴 확인(Figma 266:2071 Desktop · 266:2448 Mobile).
 * `위 내용을 확인했어요`를 체크해야 `탈퇴하기`가 켜진다. 탈퇴는 유예 없는 하드 삭제다(FN-AUTH-04, API-AUTH-11).
 * 성공하면 부모가 세션을 정리하고 메인으로 보낸다.
 */
export function WithdrawAccountModal({
  open,
  onClose,
  onWithdrawn,
  dataSummary,
}: {
  open: boolean
  onClose: () => void
  onWithdrawn: () => void
  dataSummary: Me['dataSummary']
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (submitting) return
    setConfirmed(false)
    setError(null)
    onClose()
  }

  async function submit() {
    if (!confirmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await accountApi.withdraw()
      onWithdrawn()
    } catch (e) {
      setSubmitting(false)
      setError(failureMessage('탈퇴하지 못했어요.', e))
    }
  }

  const rows: [string, string | null][] = [
    ['내 모델', `${dataSummary.faceModelCount}개`],
    ['시안', `${dataSummary.simulationCount}개`],
    ['동의 기록·계정 정보', null],
  ]

  return (
    <Modal open={open} onClose={close} title="회원 탈퇴할까요?">
      <p className="type-kr-body-13-regular-lh16p9 break-keep text-text-paragraph">
        탈퇴하면 아래 데이터가 바로 삭제되고 되돌릴 수 없어요.
      </p>

      <ul
        aria-label="삭제되는 데이터"
        className="mt-(--space-16) flex flex-col divide-y divide-line-default rounded-8 border border-line-default bg-bg-surface px-(--space-16)"
      >
        {rows.map(([name, count]) => (
          <li
            key={name}
            className="flex items-center justify-between py-(--space-14) type-kr-body-13-regular-lh16p9"
          >
            <span className="text-text-ink">{name}</span>
            {count ? <span className="text-text-body">{count}</span> : null}
          </li>
        ))}
      </ul>

      <Checkbox
        className="mt-(--space-16) type-kr-body-13-regular-lh16p9 text-text-ink"
        checked={confirmed}
        disabled={submitting}
        onChange={(e) => setConfirmed(e.currentTarget.checked)}
      >
        위 내용을 확인했어요
      </Checkbox>

      {error ? (
        <p
          role="alert"
          className="mt-(--space-12) type-kr-body-12-regular-lh15p6 text-status-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-(--space-24) flex flex-col-reverse gap-(--space-8) md:flex-row">
        <Button
          variant="secondary"
          trailingIcon={null}
          className="w-full md:flex-1"
          onClick={close}
          disabled={submitting}
        >
          취소
        </Button>
        <Button
          variant="danger"
          trailingIcon={null}
          className="w-full md:flex-1"
          onClick={() => void submit()}
          disabled={!confirmed || submitting}
          aria-busy={submitting}
        >
          {submitting ? '탈퇴하는 중…' : error ? '다시 시도' : '탈퇴하기'}
        </Button>
      </div>
    </Modal>
  )
}
