'use client'

import type { ComponentType } from 'react'
import {
  ArrowsOutIcon,
  CheckIcon,
  HandPointingIcon,
  MouseLeftClickIcon,
  MouseRightClickIcon,
  MouseScrollIcon,
  type IconProps,
} from '@phosphor-icons/react'
import { cx } from '@/shared/ui'
import type { LookGesture } from './steps'

/**
 * 메인 튜토리얼 1단계의 조작 칩(2026-11-02). 직접 해 보면 칩이 하나씩 보라 체크로 바뀐다.
 * 마우스와 터치는 칩이 다르다. 서버 렌더링에서 깜빡이지 않게 둘 다 그리고 `(pointer: coarse)`로 하나만 보인다(ViewerHints와 같다).
 */
export function LookChips({ looked }: { looked: ReadonlySet<LookGesture> }) {
  return (
    <>
      <ChipList chips={MOUSE_CHIPS} looked={looked} className="flex pointer-coarse:hidden" />
      <ChipList chips={TOUCH_CHIPS} looked={looked} className="hidden pointer-coarse:flex" />
    </>
  )
}

type Chip = {
  gesture: LookGesture
  label: string
  Icon: ComponentType<IconProps> | null
}

const MOUSE_CHIPS: Chip[] = [
  { gesture: 'rotate', label: '끌어서 회전', Icon: MouseLeftClickIcon },
  { gesture: 'zoom', label: '휠로 확대', Icon: MouseScrollIcon },
  { gesture: 'pan', label: '오른쪽 끌어 이동', Icon: MouseRightClickIcon },
  { gesture: 'light', label: '구를 끌어 조명', Icon: null },
]
const TOUCH_CHIPS: Chip[] = [
  { gesture: 'rotate', label: '한 손가락 회전', Icon: HandPointingIcon },
  { gesture: 'zoom', label: '두 손가락 확대·이동', Icon: ArrowsOutIcon },
  { gesture: 'light', label: '구를 끌어 조명', Icon: null },
]

function ChipList({
  chips,
  looked,
  className,
}: {
  chips: Chip[]
  looked: ReadonlySet<LookGesture>
  className: string
}) {
  return (
    <ul aria-label="해 볼 조작" className={cx('flex-wrap gap-(--space-6)', className)}>
      {chips.map(({ gesture, label, Icon }) => {
        const done = looked.has(gesture)
        return (
          <li
            key={gesture}
            data-done={done}
            className={cx(
              'inline-flex h-8 items-center gap-(--space-6) rounded-full border px-(--space-10) type-caption whitespace-nowrap',
              'transition-[color,background-color,border-color] duration-(--pf-dur-ui) ease-(--pf-ease-out)',
              done ? 'border-transparent bg-accent-soft text-accent' : 'border-hairline text-ink-2',
            )}
          >
            {/* 아이콘 자리에서 체크가 살짝 커지며 바뀐다 */}
            <span aria-hidden="true" className="relative grid size-3.5 place-items-center">
              <span
                className={cx(
                  'col-start-1 row-start-1 grid place-items-center transition-[opacity,transform] duration-(--pf-dur-ui) ease-(--pf-ease-out)',
                  done ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
                )}
              >
                {Icon ? (
                  <Icon size={14} />
                ) : (
                  <span className="size-3 rounded-full bg-[radial-gradient(circle_at_32%_30%,var(--pf-surface)_0%,var(--pf-faint)_55%,var(--pf-muted)_100%)]" />
                )}
              </span>
              <CheckIcon
                size={13}
                weight="bold"
                className={cx(
                  'col-start-1 row-start-1 transition-[opacity,transform] duration-(--pf-dur-ui) ease-(--pf-ease-out)',
                  done ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
                )}
              />
            </span>
            {label}
            <span className="sr-only">{done ? ' (해 봤어요)' : ''}</span>
          </li>
        )
      })}
    </ul>
  )
}
