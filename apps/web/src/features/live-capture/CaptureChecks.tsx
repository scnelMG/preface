import { Button } from '@/shared/ui'
import type { CheckItem, CheckState } from './guideEngine'

const MARK: Record<CheckState, { mark: string; label: string }> = {
  ok: { mark: '✓', label: '통과' },
  bad: { mark: '✕', label: '고쳐야 함' },
  wait: { mark: '…', label: '확인 중' },
  skip: { mark: '-', label: '이 기기에서 확인 불가' },
}

/** 검사 모드: 촬영 전에 맞춰야 할 항목과 지금 상태. 고칠 것 하나는 가운데 큰 글자·음성이 맡는다 */
export function CaptureChecks({ checks }: { checks: readonly CheckItem[] }) {
  return (
    <ul className="pf-live-checks" aria-label="촬영 전 검사">
      {checks.map((check) => {
        const { mark, label } = MARK[check.state]
        return (
          <li key={check.key} data-state={check.state}>
            {check.label}{' '}
            <span role="img" aria-label={label}>
              {mark}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** 검사 통과 직후 잠깐: 검사 모드가 끝나고 촬영 모드로 넘어간다는 표시 */
export function CaptureCheckDone() {
  return (
    <p className="pf-live-check-done" role="status">
      검사 완료 ✓
    </p>
  )
}

/**
 * 분할 모델을 못 쓰는 기기(준비 실패·10초 넘게 안 됨): 앞머리·안경을 자동으로 못 재니 사용자가 직접 확인한다(-633).
 * 촬영을 막지는 않는다
 */
export function CaptureBangsConfirm({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="pf-live-bangs-confirm">
      <p>이마가 보이게 앞머리를 올리고, 안경을 벗었나요?</p>
      <Button variant="ink" trailingIcon={null} className="w-full" onClick={onConfirm}>
        네, 확인했어요
      </Button>
    </div>
  )
}
