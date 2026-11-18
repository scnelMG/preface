'use client'

import { Icon, Segmented } from '@/shared/ui'
import type { StudioTab } from '../heads'

/**
 * 작업실 머리줄(디자인 시스템 v4, 2026-10-30 사용자 피드백).
 * 화면 제목 글자는 보이지 않게 두고(읽기 프로그램용 h1만), 가운데 `모델 | 시안` 탭으로 두 화면을 오간다.
 * `모델` 탭에서만 오른쪽에 "새 모델"을 둔다.
 */
export function StudioHeading({
  tab,
  onTabChange,
  onAdd,
}: {
  tab: StudioTab
  onTabChange: (tab: StudioTab) => void
  onAdd: () => void
}) {
  return (
    <div className="relative flex min-h-[48px] items-center justify-center pt-(--space-24) md:pt-(--space-32)">
      <h1 className="sr-only">내 작업실</h1>
      <Segmented
        label="작업실 보기"
        value={tab}
        onChange={onTabChange}
        options={[
          { value: 'heads', label: '모델' },
          { value: 'records', label: '시안' },
        ]}
      />
      {tab === 'heads' ? (
        <button
          type="button"
          // 테두리 있는 알약: 누를 수 있는 기능임이 바로 보인다(2026-10-31 검토)
          className="btn-ghost absolute right-0 bottom-0 min-h-[40px] gap-(--space-6) px-(--space-14) max-sm:size-10 max-sm:px-0"
          onClick={onAdd}
          aria-label="새 모델"
        >
          <Icon name="Plus" size={16} />
          <span className="max-sm:sr-only">새 모델</span>
        </button>
      ) : null}
    </div>
  )
}
