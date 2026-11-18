'use client'

import { useEffect } from 'react'
import { Button, Icon } from '@/shared/ui'
import { failMessagesOf } from '../failMessages'
import { useReconstructionStore } from '../store'
import type { ReconstructionJob } from '../types'

/**
 * SCR-09 복원 실패·재촬영 안내(Figma Wireframe v3.2 267:2695 Desktop · 267:2757 Mobile). REQ-F-06, FN-CAP-03 수용 4.
 *
 * 대기 화면(`/reconstructions/[jobId]`)이 FAILED를 받으면 이 모양으로 바뀐다.
 * - 실패 코드마다 이유 + 고치는 방법 카드. 여러 개면 모두(`failMessagesOf`)
 * - 실패 원본 영상은 24시간 뒤 삭제된다(REQ-N-02, FN-HIS-04)
 * - [다시 촬영하기] → 새 모델 추가(`/studio/new`), [내 작업실로]
 *   Desktop은 오른쪽 정렬 한 줄(내 작업실로 · 다시 촬영하기), Mobile은 화면 아래 세로(다시 촬영하기 먼저)
 *
 * CANCELED(삭제·탈퇴·동의 철회)는 품질 문제가 아니라 사유 카드 없이 취소 안내만 둔다.
 *
 * 이 안내를 한 번 보면 확인한 것으로 남겨, 진행 팝업 자리의 실패 카드를 내리고 다시 띄우지 않는다(`acknowledgeFailure`).
 */
export function ReconstructionFailed({ job }: { job: ReconstructionJob }) {
  const canceled = job.status === 'CANCELED'
  const messages = canceled ? [] : failMessagesOf(job.failCodes)

  useEffect(() => useReconstructionStore.getState().acknowledgeFailure(job.jobId), [job.jobId])

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[640px] flex-col px-[5%] pt-(--space-40) pb-(--space-32) md:px-0 md:pt-24 md:pb-24">
      <span className="flex size-12 items-center justify-center rounded-full border border-hairline-strong text-ink">
        <Icon name="Info" size={22} />
      </span>
      <h1 className="pf-recon-title mt-(--space-24)">
        {canceled ? '3D 만들기가 취소됐어요' : '3D를 만들지 못했어요'}
      </h1>
      <p className="type-lead mt-(--space-8) text-ink-2">
        {canceled
          ? '새로 만들려면 다시 촬영해 주세요.'
          : '아래 내용을 확인하고 다시 촬영해 주세요.'}
      </p>

      {messages.length ? (
        <ul
          aria-label="실패 이유"
          className="mt-(--space-32) flex flex-col divide-y divide-hairline border-y border-hairline"
        >
          {messages.map((message) => (
            <li key={message.reason} className="flex flex-col gap-(--space-6) py-(--space-20)">
              <p className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
                {message.reason}
              </p>
              <p className="text-[14px] leading-[1.6] text-ink-2">{message.fix}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {canceled ? null : (
        <p className="type-caption mt-(--space-12) text-muted-soft">
          실패한 영상은 24시간 뒤 자동으로 삭제돼요.
        </p>
      )}

      <div className="mt-auto flex flex-col gap-(--space-8) pt-(--space-28) md:mt-0 md:flex-row-reverse md:justify-start">
        <Button variant="ink" href="/studio/new" className="w-full md:w-auto">
          다시 촬영하기
        </Button>
        <Button
          variant="secondary"
          layout="inline"
          href="/studio"
          trailingIcon={null}
          className="w-full md:w-auto"
        >
          내 작업실로
        </Button>
      </div>
    </div>
  )
}
